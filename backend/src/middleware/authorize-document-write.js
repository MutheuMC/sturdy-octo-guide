const { prisma } = require("../lib/prisma");
const { httpError } = require("../lib/http-error");

async function authorizeDocumentWrite(req, _res, next) {
  const document = await prisma.document.findFirst({
    where: { id: String(req.params.id), project: { ownerId: req.user.id } },
  });
  if (!document) throw httpError("Document not found", 404);
  req.document = document;
  next();
}

module.exports = { authorizeDocumentWrite };
