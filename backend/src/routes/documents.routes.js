const express = require("express");
const {
  deleteDocument,
  downloadDocument,
  getPreview,
  getPreviewStatus,
  requestPreview,
} = require("../controllers/documents.controller");
const { previewLimit } = require("../middleware/rate-limits");

const documentsRouter = express.Router();

documentsRouter.get("/:id/download", downloadDocument);
documentsRouter.get("/:id/preview/status", getPreviewStatus);
documentsRouter.post("/:id/preview", previewLimit, requestPreview);
documentsRouter.get("/:id/preview", getPreview);
documentsRouter.delete("/:id", deleteDocument);

module.exports = { documentsRouter };
