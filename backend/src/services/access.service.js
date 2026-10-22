const { prisma } = require("../lib/prisma");
const { httpError } = require("../lib/http-error");

async function getAccessibleProject(user, id, write = false) {
  const project = await prisma.project.findFirst({
    where: {
      id,
      ...(user.role === "ADMIN" && !write ? {} : { ownerId: user.id }),
    },
  });

  if (!project) throw httpError("Project not found", 404);
  return project;
}

async function getAccessibleDocument(user, id) {
  const document = await prisma.document.findUnique({
    where: { id },
    include: { project: true },
  });

  if (
    !document ||
    (document.project.ownerId !== user.id && user.role !== "ADMIN")
  ) {
    throw httpError("Document not found", 404);
  }

  return document;
}

async function getStoredDocument(user, id) {
  const document = await getAccessibleDocument(user, id);
  if (!document.storageKey) {
    throw httpError("External links open at their original location", 400);
  }
  return document;
}

module.exports = {
  getAccessibleDocument,
  getAccessibleProject,
  getStoredDocument,
};
