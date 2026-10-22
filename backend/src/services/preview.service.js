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
const { previewCommand } = require("../lib/preview-runtime");

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

  const args = [
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
  ];
  if (process.platform === "win32") {
    await writeFile(path.join(work, "preview-job.json"), JSON.stringify({ executable, args, work }), { mode: 0o600 });
  }
  const command = previewCommand(executable, args, work);
  await runFile(command.executable, command.args, command.options);

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

function startPreviewWorker(database, uploadDir, tempDir = os.tmpdir()) {
  let running = false;

  async function tick() {
    if (running || !process.env.LIBREOFFICE_PATH) return;
    running = true;

    let work;
    let outputKey;
    let id;
    let sourceKey;

    try {
      const document = await database.document.findFirst({
        where: { previewStatus: "QUEUED" },
        orderBy: { createdAt: "asc" },
      });
      if (!document?.storageKey) return;

      const claim = await database.document.updateMany({
        where: {
          id: document.id,
          storageKey: document.storageKey,
          previewStatus: "QUEUED",
        },
        data: { previewStatus: "PROCESSING", previewError: null },
      });
      if (!claim.count) return;

      id = document.id;
      sourceKey = document.storageKey;
      await mkdir(tempDir, { recursive: true, mode: 0o700 });
      work = await mkdtemp(path.join(tempDir, "pptinit-preview-"));
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
        const published = await transaction.document.updateMany({
          // A conversion of replaced content must never publish over the new file.
          where: {
            id: document.id,
            storageKey: sourceKey,
            previewStatus: "PROCESSING",
          },
          data: {
            previewKey: outputKey,
            previewSize: converted.size,
            previewStatus: "READY",
            previewError: null,
          },
        });
        if (!published.count) {
          throw new Error("Preview source was replaced or deleted");
        }
      });
      outputKey = undefined;
    } catch (error) {
      console.error("Preview conversion failed", id, error.message);
      if (id) {
        await database.document
          .updateMany({
            where: { id, storageKey: sourceKey, previewStatus: "PROCESSING" },
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
