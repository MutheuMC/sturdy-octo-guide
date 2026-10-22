const path = require("node:path");
const { backendRoot } = require("./env");
const { validatePreviewConfiguration } = require("../lib/preview-runtime");

const jwtSecret = process.env.JWT_SECRET;
const production = process.env.NODE_ENV === "production";

if (!jwtSecret || jwtSecret.length < 32) {
  throw new Error("JWT_SECRET must contain at least 32 characters");
}

if (production && !process.env.CLAMSCAN_PATH) {
  throw new Error("Production uploads require CLAMSCAN_PATH");
}

validatePreviewConfiguration();

const configuredUploadDir = process.env.UPLOAD_DIR || "./uploads";
const uploadDir = path.isAbsolute(configuredUploadDir)
  ? configuredUploadDir
  : path.resolve(backendRoot, configuredUploadDir);
const previewTempDir = process.env.PREVIEW_TEMP_DIR
  ? path.resolve(backendRoot, process.env.PREVIEW_TEMP_DIR)
  : require("node:os").tmpdir();

const trustProxy = process.env.TRUST_PROXY
  ? process.env.TRUST_PROXY.split(",").map((value) => value.trim()).filter(Boolean)
  : false;
if (trustProxy && trustProxy.some((value) => /^(true|false|\d+|\*|0\.0\.0\.0\/0|::\/0)$/i.test(value))) {
  throw new Error("TRUST_PROXY must list trusted proxy IP addresses, subnets, or loopback; unrestricted trust is not supported");
}

const cookieOptions = {
  httpOnly: true,
  secure: production,
  sameSite: "lax",
  path: "/api",
};

module.exports = {
  cookieOptions,
  jwtSecret,
  origin: process.env.APP_ORIGIN || "http://localhost:3000",
  port: Number(process.env.PORT || 4000),
  production,
  backendRoot,
  uploadDir,
  previewTempDir,
  trustProxy,
};
