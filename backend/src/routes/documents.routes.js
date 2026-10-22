const express = require("express");
const {
  deleteDocument,
  downloadDocument,
  getPreview,
  getPreviewStatus,
  requestPreview,
  updateDocument,
} = require("../controllers/documents.controller");
const { previewLimit, uploadLimit, documentUpdateLimit } = require("../middleware/rate-limits");
const { authorizeDocumentWrite } = require("../middleware/authorize-document-write");
const { upload } = require("../middleware/upload");

const documentsRouter = express.Router();

documentsRouter.patch(
  "/:id",
  documentUpdateLimit,
  authorizeDocumentWrite,
  (req, res, next) => req.is("multipart/form-data") ? uploadLimit(req, res, next) : next(),
  upload.single("file"),
  updateDocument,
);

documentsRouter.get("/:id/download", downloadDocument);
documentsRouter.get("/:id/preview/status", getPreviewStatus);
documentsRouter.post("/:id/preview", previewLimit, requestPreview);
documentsRouter.get("/:id/preview", getPreview);
documentsRouter.delete("/:id", deleteDocument);

module.exports = { documentsRouter };
