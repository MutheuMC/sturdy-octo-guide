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

async function storeValidatedFile(file) {
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
          windowsHide: true,
        });
      } catch {
        throw httpError(
          "File scanning failed or the document was flagged as unsafe",
          422,
        );
      }
    }

    return {
      storageKey,
      kind,
      originalName: path.basename(file.originalname),
      size: file.size,
    };
  } catch (error) {
    await unlink(storedPath);
    throw error;
  }
}

async function removeStoredFiles(document) {
  for (const key of [document.storageKey, document.previewKey]) {
    if (key) {
      await unlink(path.join(uploadDir, key)).catch((error) => {
        if (error.code !== "ENOENT") {
          console.error("Stored file cleanup failed", error.code);
        }
      });
    }
  }
}

async function createUploadedDocument({ file, name, ownerId, projectId }) {
  const stored = await storeValidatedFile(file);
  try {
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
          ...stored,
          projectId,
        },
      });
    });
  } catch (error) {
    await removeStoredFiles(stored);
    throw error;
  }
}

async function updateOwnedDocument({ id, ownerId, name, url, file }) {
  const stored = file ? await storeValidatedFile(file) : null;
  let previous;
  let updated;
  try {
    updated = await prisma.$transaction(async (transaction) => {
      // Serialize uploads, replacements, deletion, and preview publication for this owner.
      await transaction.$queryRaw`SELECT id FROM "User" WHERE id = ${ownerId} FOR UPDATE`;
      previous = await transaction.document.findFirst({
        where: { id, project: { ownerId } },
      });
      if (!previous) throw httpError("Document not found", 404);
      if (
        (previous.kind === "LINK") !== (url !== undefined) ||
        (previous.kind === "LINK" && stored)
      ) {
        throw httpError("Files and links must keep their document type", 400);
      }
      if (stored) {
        const usage = await transaction.document.aggregate({
          where: { project: { ownerId } },
          _sum: { size: true, previewSize: true },
        });
        if (
          (usage._sum.size || 0) + (usage._sum.previewSize || 0) -
            previous.size - previous.previewSize + stored.size > 1024 ** 3
        ) {
          throw httpError("Your 1 GB storage quota has been reached", 400);
        }
      }
      // Saving unchanged metadata should not invent a new edit date.
      if (
        !stored && name === previous.name &&
        (url === undefined || url === previous.url)
      ) return previous;
      return transaction.document.update({
        where: { id },
        data: {
          name,
          ...(url !== undefined ? { url } : {}),
          ...(stored ? {
            ...stored,
            previewStatus: "NONE",
            previewKey: null,
            previewSize: 0,
            previewError: null,
          } : {}),
          updatedAt: new Date(),
        },
      });
    });
  } catch (error) {
    if (stored) await removeStoredFiles(stored);
    throw error;
  }
  // Only remove the previous content after the replacement is committed.
  if (stored) await removeStoredFiles(previous);
  return updated;
}

async function deleteOwnedDocument(userId, id) {
  const deleted = await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const document = await transaction.document.findFirst({
      where: { id, project: { ownerId: userId } },
    });
    if (!document) throw httpError("Document not found", 404);
    return transaction.document.delete({ where: { id } });
  });
  await removeStoredFiles(deleted);
  return deleted;
}

module.exports = {
  createUploadedDocument,
  deleteOwnedDocument,
  updateOwnedDocument,
};
