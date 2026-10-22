const path = require("node:path");
const { backendRoot } = require("./env");

const jwtSecret = process.env.JWT_SECRET;
const production = process.env.NODE_ENV === "production";

if (!jwtSecret || jwtSecret.length < 32) {
  throw new Error("JWT_SECRET must contain at least 32 characters");
}

if (production && !process.env.CLAMSCAN_PATH) {
  throw new Error("Production uploads require CLAMSCAN_PATH");
}

if (
  production &&
  process.env.LIBREOFFICE_PATH &&
  !process.env.PREVIEW_SANDBOX_PATH
) {
  throw new Error(
    "Production Office previews require PREVIEW_SANDBOX_PATH for isolated conversion",
  );
}

const configuredUploadDir = process.env.UPLOAD_DIR || "./uploads";
const uploadDir = path.isAbsolute(configuredUploadDir)
  ? configuredUploadDir
  : path.resolve(backendRoot, configuredUploadDir);

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
};
