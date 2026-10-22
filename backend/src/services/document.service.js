const { execFile } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { mkdir, unlink, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");
const { uploadDir } = require("../config");
const { prisma } = require("../lib/prisma");
const { httpError } = require("../lib/http-error");
const { validateOffice } = require("../validators/documents");

const runFile = promisify(execFile);
const kindsByExtension = {
  ".pptx": "PPTX",
  ".pdf": "PDF",
  ".docx": "DOCX",
};

async function validateUpload(file) {
  const extension = path.extname(file.originalname).toLowerCase();
  const kind = kindsByExtension[extension];

  if (!kind) {
    throw httpError("Only PPTX, PDF, and DOCX files are supported", 400);
  }

  if (kind === "PDF") {
    if (
      file.buffer.subarray(0, 5).toString() !== "%PDF-" ||
      !file.buffer.subarray(-2048).includes(Buffer.from("%%EOF"))
    ) {
      throw httpError("Invalid PDF file", 400);
    }
  } else {
    await validateOffice(file.buffer, kind);
  }

  return { extension, kind };
}

async function createUploadedDocument({ file, name, ownerId, projectId }) {
  const { extension, kind } = await validateUpload(file);
  const storageKey = randomUUID() + extension;
  const storedPath = path.join(uploadDir, storageKey);

  await mkdir(uploadDir, { recursive: true });
  await writeFile(storedPath, file.buffer, { flag: "wx", mode: 0o600 });

  try {
    if (process.env.CLAMSCAN_PATH) {
      try {
        await runFile(process.env.CLAMSCAN_PATH, ["--no-summary", storedPath], {
          timeout: 60000,
          maxBuffer: 4096,
        });
      } catch {
        throw httpError(
          "File scanning failed or the document was flagged as unsafe",
          422,
        );
      }
    }

    return await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM "User" WHERE id = ${ownerId} FOR UPDATE`;
      const usage = await transaction.document.aggregate({
        where: { project: { ownerId } },
        _sum: { size: true, previewSize: true },
      });

      if (
        (usage._sum.size || 0) +
          (usage._sum.previewSize || 0) +
          file.size >
        1024 ** 3
      ) {
        throw httpError("Your 1 GB storage quota has been reached", 400);
      }

      return transaction.document.create({
        data: {
          name,
          kind,
          storageKey,
          originalName: path.basename(file.originalname),
          size: file.size,
          projectId,
        },
      });
    });
  } catch (error) {
    await unlink(storedPath);
    throw error;
  }
}

async function deleteOwnedDocument(userId, id) {
  const document = await prisma.document.findUnique({
    where: { id },
    include: { project: true },
  });

  if (!document || document.project.ownerId !== userId) {
    throw httpError("Document not found", 404);
  }

  const deleted = await prisma.document.delete({ where: { id: document.id } });
  if (deleted.storageKey) {
    await unlink(path.join(uploadDir, deleted.storageKey)).catch(() => {});
  }
  if (deleted.previewKey) {
    await unlink(path.join(uploadDir, deleted.previewKey)).catch(() => {});
  }

  return deleted;
}

module.exports = { createUploadedDocument, deleteOwnedDocument };
