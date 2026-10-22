const multer = require("multer");
const { Prisma } = require("@prisma/client");
const { z } = require("zod");

function errorHandler(error, _req, res, _next) {
  if (error instanceof z.ZodError) {
    return res.status(400).json({ error: error.issues[0].message });
  }

  if (error instanceof multer.MulterError) {
    return res.status(400).json({
      error:
        error.code === "LIMIT_FILE_SIZE"
          ? "Maximum file size is 50 MB"
          : "Invalid upload",
    });
  }

  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    return res.status(409).json({ error: "That email is already registered" });
  }

  if (error.status) {
    return res.status(error.status).json({ error: error.message });
  }

  if (/Office|archive|extension/.test(error.message)) {
    return res.status(400).json({ error: error.message });
  }

  console.error(error);
  res.status(500).json({ error: "Something went wrong. Please try again." });
}

module.exports = { errorHandler };
