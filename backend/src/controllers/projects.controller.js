const { z } = require("zod");
const { prisma } = require("../lib/prisma");
const { getAccessibleProject } = require("../services/access.service");
const { linkSchema, title } = require("../validators/documents");

async function listProjects(req, res) {
  const ownerId =
    req.user.role === "ADMIN" && typeof req.query.ownerId === "string"
      ? req.query.ownerId
      : req.user.id;

  const projects = await prisma.project.findMany({
    where: { ownerId },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { documents: true } } },
  });
  const usage = await prisma.document.aggregate({
    where: { project: { ownerId } },
    _sum: { size: true, previewSize: true },
  });

  res.json({
    projects,
    usedBytes: (usage._sum.size || 0) + (usage._sum.previewSize || 0),
    quotaBytes: 1024 ** 3,
  });
}

async function createProject(req, res) {
  const input = z.object({ name: title }).strict().parse(req.body);
  const project = await prisma.project.create({
    data: { ...input, ownerId: req.user.id },
  });
  res.status(201).json({ project });
}

async function getProject(req, res) {
  const project = await getAccessibleProject(
    req.user,
    String(req.params.id),
  );
  const documents = await prisma.document.findMany({
    where: { projectId: project.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      kind: true,
      url: true,
      size: true,
      createdAt: true,
      updatedAt: true,
      originalName: true,
    },
  });

  res.json({ project, documents });
}

async function addLink(req, res) {
  const project = await getAccessibleProject(
    req.user,
    String(req.params.id),
    true,
  );
  const input = z
    .object({ name: title, url: linkSchema })
    .strict()
    .parse(req.body);
  const document = await prisma.document.create({
    data: { ...input, kind: "LINK", projectId: project.id },
  });

  res.status(201).json({ document });
}

module.exports = { addLink, createProject, getProject, listProjects };
