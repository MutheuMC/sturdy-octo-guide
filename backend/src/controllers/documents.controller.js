const path = require("node:path");
const { z } = require("zod");
const { uploadDir } = require("../config");
const { prisma } = require("../lib/prisma");
const { httpError } = require("../lib/http-error");
const {
  getAccessibleDocument,
  getStoredDocument,
} = require("../services/access.service");
const {
  createUploadedDocument,
  deleteOwnedDocument,
  updateOwnedDocument,
} = require("../services/document.service");
const { linkSchema, title } = require("../validators/documents");

async function updateDocument(req, res) {
  const isLink = req.document.kind === "LINK";
  const schema = isLink
    ? z.object({ name: title, url: linkSchema }).strict()
    : z.object({ name: title }).strict();
  const input = schema.parse(req.body);
  if (isLink && req.file) {
    throw httpError("Links cannot contain uploaded files", 400);
  }
  const document = await updateOwnedDocument({
    id: req.document.id,
    ownerId: req.user.id,
    ...input,
    file: req.file,
  });
  res.json({ document });
}

async function uploadFile(req, res) {
  const name = title.parse(req.body.name);
  const file = req.file;
  if (!file) return res.status(400).json({ error: "Choose a file" });

  const document = await createUploadedDocument({
    file,
    name,
    ownerId: req.user.id,
    projectId: req.project.id,
  });
  res.status(201).json({ document });
}

async function downloadDocument(req, res) {
  const document = await getAccessibleDocument(
    req.user,
    String(req.params.id),
  );
  if (!document.storageKey) {
    return res.status(400).json({ error: "This document is a link" });
  }

  if (req.user.role === "ADMIN") {
    await prisma.auditLog.create({
      data: {
        actorId: req.user.id,
        action: "DOWNLOAD_DOCUMENT",
        resourceId: document.id,
      },
    });
  }

  res.setHeader("Cache-Control", "no-store");
  res.download(
    path.join(uploadDir, document.storageKey),
    document.originalName || document.name,
  );
}

async function getPreviewStatus(req, res) {
  const document = await getStoredDocument(
    req.user,
    String(req.params.id),
  );
  res.setHeader("Cache-Control", "no-store");
  res.json({
    status: document.kind === "PDF" ? "READY" : document.previewStatus,
    error: document.previewError,
    available: document.kind === "PDF" || !!process.env.LIBREOFFICE_PATH,
  });
}

async function requestPreview(req, res) {
  const document = await getStoredDocument(
    req.user,
    String(req.params.id),
  );
  if (document.kind === "PDF") return res.json({ status: "READY" });
  if (!process.env.LIBREOFFICE_PATH) {
    return res.status(503).json({
      error:
        "PowerPoint and Word previews require the server preview converter to be configured.",
    });
  }

  await prisma.document.updateMany({
    where: {
      id: document.id,
      storageKey: document.storageKey,
      previewStatus: { in: ["NONE", "FAILED"] },
    },
    data: { previewStatus: "QUEUED", previewError: null },
  });
  res.status(202).json({ status: "QUEUED" });
}

async function getPreview(req, res) {
  const document = await getStoredDocument(
    req.user,
    String(req.params.id),
  );
  const key =
    document.kind === "PDF"
      ? document.storageKey
      : document.previewStatus === "READY"
        ? document.previewKey
        : null;

  if (!key) throw httpError("The preview is not ready yet", 409);

  if (req.user.role === "ADMIN") {
    await prisma.auditLog.create({
      data: {
        actorId: req.user.id,
        action: "VIEW_DOCUMENT",
        resourceId: document.id,
      },
    });
  }

  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", 'inline; filename="preview.pdf"');
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; frame-ancestors 'self'; sandbox",
  );
  res.sendFile(path.join(uploadDir, key));
}

async function deleteDocument(req, res) {
  await deleteOwnedDocument(req.user.id, String(req.params.id));
  res.json({ ok: true });
}

module.exports = {
  updateDocument,
  deleteDocument,
  downloadDocument,
  getPreview,
  getPreviewStatus,
  requestPreview,
  uploadFile,
};
