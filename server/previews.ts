import { PrismaClient } from "@prisma/client";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  mkdir,
  writeFile,
  copyFile,
  stat,
  open,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
const runFile = promisify(execFile);
const MAX_PREVIEW = 50 * 1024 * 1024;
export async function convertToPdf(
  input: string,
  work: string,
  executable: string,
) {
  const profile = path.join(work, "profile"),
    output = path.join(work, "output");
  await mkdir(profile, { recursive: true });
  await mkdir(output);
  // Never run document macros or update external links. Each job has a fresh profile.
  await writeFile(
    path.join(profile, "registrymodifications.xcu"),
    `<?xml version="1.0"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item><item oor:path="/org.openoffice.Office.Common/Load"><prop oor:name="UpdateDocMode" oor:op="fuse"><value>0</value></prop></item></oor:items>`,
  );
  await runFile(
    process.env.PREVIEW_SANDBOX_PATH || executable,
    [
      ...(process.env.PREVIEW_SANDBOX_PATH ? [executable] : []),
      `-env:UserInstallation=${pathToFileURL(profile).href}`,
      "--headless",
      "--nologo",
      "--nodefault",
      "--norestore",
      "--convert-to",
      "pdf",
      "--outdir",
      output,
      input,
    ],
    {
      cwd: work,
      timeout: 90000,
      maxBuffer: 1024 * 1024,
      killSignal: "SIGKILL",
      env: {
        PATH: process.env.PATH,
        HOME: work,
        TMPDIR: work,
        LANG: "en_US.UTF-8",
        SAL_USE_VCLPLUGIN: "svp",
        LIBREOFFICE_RUNTIME_DIR: process.env.LIBREOFFICE_RUNTIME_DIR,
      },
    },
  );
  const pdf = path.join(output, path.parse(input).name + ".pdf");
  const info = await stat(pdf);
  if (!info.size || info.size > MAX_PREVIEW)
    throw Error("Invalid preview size");
  const handle = await open(pdf, "r");
  try {
    const header = Buffer.alloc(5);
    await handle.read(header, 0, 5, 0);
    if (header.toString() !== "%PDF-") throw Error("Invalid conversion output");
  } finally {
    await handle.close();
  }
  return { pdf, size: info.size };
}
export function startPreviewWorker(db: PrismaClient, uploadDir: string) {
  let running = false;
  async function tick() {
    if (running || !process.env.LIBREOFFICE_PATH) return;
    running = true;
    let work: string | undefined, outputKey: string | undefined;
    let id: string | undefined;
    try {
      const doc = await db.document.findFirst({
        where: { previewStatus: "QUEUED" },
        orderBy: { createdAt: "asc" },
      });
      if (!doc?.storageKey) return;
      const claim = await db.document.updateMany({
        where: { id: doc.id, previewStatus: "QUEUED" },
        data: { previewStatus: "PROCESSING", previewError: null },
      });
      if (!claim.count) return;
      id = doc.id;
      work = await mkdtemp(path.join(os.tmpdir(), "pptinit-preview-"));
      const input = path.join(
        work,
        "document" + (doc.kind === "PPTX" ? ".pptx" : ".docx"),
      );
      await copyFile(path.join(uploadDir, doc.storageKey), input);
      const converted = await convertToPdf(
        input,
        work,
        process.env.LIBREOFFICE_PATH,
      );
      outputKey = randomUUID() + ".pdf";
      // Copy atomically within private storage, then publish only after quota checks.
      await copyFile(converted.pdf, path.join(uploadDir, outputKey));
      await db.$transaction(async (tx) => {
        const project = await tx.project.findUniqueOrThrow({
          where: { id: doc.projectId },
        });
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${project.ownerId} FOR UPDATE`;
        const usage = await tx.document.aggregate({
          where: { project: { ownerId: project.ownerId } },
          _sum: { size: true, previewSize: true },
        });
        if (
          (usage._sum.size || 0) +
            (usage._sum.previewSize || 0) +
            converted.size >
          1024 ** 3
        )
          throw Error("Storage quota exceeded");
        await tx.document.update({
          where: { id: doc.id },
          data: {
            previewKey: outputKey,
            previewSize: converted.size,
            previewStatus: "READY",
            previewError: null,
          },
        });
      });
      outputKey = undefined;
    } catch (e) {
      console.error("Preview conversion failed", id, (e as Error).message);
      if (id)
        await db.document
          .updateMany({
            where: { id },
            data: {
              previewStatus: "FAILED",
              previewError:
                "Could not create a preview. The document may be unsupported or damaged, conversion may have timed out, or storage may be full.",
            },
          })
          .catch(() => {});
    } finally {
      if (outputKey)
        await rm(path.join(uploadDir, outputKey), { force: true }).catch(
          () => {},
        );
      if (work)
        await rm(work, { recursive: true, force: true }).catch(() => {});
      running = false;
    }
  }
  // A single API process owns the worker. Recover jobs interrupted by a restart.
  db.document
    .updateMany({
      where: { previewStatus: "PROCESSING" },
      data: { previewStatus: "QUEUED" },
    })
    .then(() => tick())
    .catch((e) => console.error("Preview recovery failed", e.message));
  const timer = setInterval(() => void tick(), 1500);
  timer.unref();
  return () => clearInterval(timer);
}
