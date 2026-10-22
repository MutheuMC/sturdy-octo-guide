const path = require("node:path");
const dotenv = require("dotenv");

const backendRoot = path.resolve(__dirname, "..", "..");

dotenv.config({
  path: path.join(backendRoot, ".env"),
  quiet: true,
});

module.exports = { backendRoot };
