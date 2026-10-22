const express = require("express");
const {
  addLink,
  createProject,
  getProject,
  listProjects,
} = require("../controllers/projects.controller");
const { uploadFile } = require("../controllers/documents.controller");
const {
  authorizeProjectWrite,
} = require("../middleware/authorize-project-write");
const { uploadLimit } = require("../middleware/rate-limits");
const { upload } = require("../middleware/upload");

const projectsRouter = express.Router();

projectsRouter.get("/", listProjects);
projectsRouter.post("/", createProject);
projectsRouter.get("/:id", getProject);
projectsRouter.post("/:id/links", addLink);
projectsRouter.post(
  "/:id/files",
  uploadLimit,
  authorizeProjectWrite,
  upload.single("file"),
  uploadFile,
);

module.exports = { projectsRouter };
