const { app } = require("./app");
const { port, uploadDir, previewTempDir } = require("./config");
const { prisma } = require("./lib/prisma");
const { startPreviewWorker } = require("./services/preview.service");

function startServer() {
  const server = app.listen(port, "127.0.0.1", () => {
    console.log("pptinit API listening on port " + port);
  });
  const stopPreviewWorker = startPreviewWorker(prisma, uploadDir, previewTempDir);
  return { server, stopPreviewWorker };
}

if (require.main === module) startServer();

module.exports = { startServer };
