const { execFile } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const {
  copyFile,
  mkdir,
  mkdtemp,
  open,
  rm,
  stat,
  writeFile,
} = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { promisify } = require("node:util");

const runFile = promisify(execFile);
const MAX_PREVIEW = 50 * 1024 * 1024;

async function convertToPdf(input, work, executable) {
  const profile = path.join(work, "profile");
  const output = path.join(work, "output");

  await mkdir(profile, { recursive: true });
  await mkdir(output);
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
  if (!info.size || info.size > MAX_PREVIEW) {
    throw new Error("Invalid preview size");
  }

  const handle = await open(pdf, "r");
  try {
    const header = Buffer.alloc(5);
    await handle.read(header, 0, 5, 0);
    if (header.toString() !== "%PDF-") {
      throw new Error("Invalid conversion output");
    }
  } finally {
    await handle.close();
  }

  return { pdf, size: info.size };
}

function startPreviewWorker(database, uploadDir) {
  let running = false;

  async function tick() {
    if (running || !process.env.LIBREOFFICE_PATH) return;
    running = true;

    let work;
    let outputKey;
    let id;

    try {
      const document = await database.document.findFirst({
        where: { previewStatus: "QUEUED" },
        orderBy: { createdAt: "asc" },
      });
      if (!document?.storageKey) return;

      const claim = await database.document.updateMany({
        where: { id: document.id, previewStatus: "QUEUED" },
        data: { previewStatus: "PROCESSING", previewError: null },
      });
      if (!claim.count) return;

      id = document.id;
      work = await mkdtemp(path.join(os.tmpdir(), "pptinit-preview-"));
      const input = path.join(
        work,
        "document" + (document.kind === "PPTX" ? ".pptx" : ".docx"),
      );
      await copyFile(path.join(uploadDir, document.storageKey), input);

      const converted = await convertToPdf(
        input,
        work,
        process.env.LIBREOFFICE_PATH,
      );
      outputKey = randomUUID() + ".pdf";
      await copyFile(converted.pdf, path.join(uploadDir, outputKey));

      await database.$transaction(async (transaction) => {
        const project = await transaction.project.findUniqueOrThrow({
          where: { id: document.projectId },
        });
        await transaction.$queryRaw`SELECT id FROM "User" WHERE id = ${project.ownerId} FOR UPDATE`;
        const usage = await transaction.document.aggregate({
          where: { project: { ownerId: project.ownerId } },
          _sum: { size: true, previewSize: true },
        });
        if (
          (usage._sum.size || 0) +
            (usage._sum.previewSize || 0) +
            converted.size >
          1024 ** 3
        ) {
          throw new Error("Storage quota exceeded");
        }
        await transaction.document.update({
          where: { id: document.id },
          data: {
            previewKey: outputKey,
            previewSize: converted.size,
            previewStatus: "READY",
            previewError: null,
          },
        });
      });
      outputKey = undefined;
    } catch (error) {
      console.error("Preview conversion failed", id, error.message);
      if (id) {
        await database.document
          .updateMany({
            where: { id },
            data: {
              previewStatus: "FAILED",
              previewError:
                "Could not create a preview. The document may be unsupported or damaged, conversion may have timed out, or storage may be full.",
            },
          })
          .catch(() => {});
      }
    } finally {
      if (outputKey) {
        await rm(path.join(uploadDir, outputKey), { force: true }).catch(
          () => {},
        );
      }
      if (work) {
        await rm(work, { recursive: true, force: true }).catch(() => {});
      }
      running = false;
    }
  }

  database.document
    .updateMany({
      where: { previewStatus: "PROCESSING" },
      data: { previewStatus: "QUEUED" },
    })
    .then(() => tick())
    .catch((error) =>
      console.error("Preview recovery failed", error.message),
    );

  const timer = setInterval(() => void tick(), 1500);
  timer.unref();
  return () => clearInterval(timer);
}

module.exports = { convertToPdf, startPreviewWorker };
