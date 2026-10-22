const { test } = require("node:test");
const assert = require("node:assert/strict");
const { previewCommand, previewEnvironment, validatePreviewConfiguration } = require("../src/lib/preview-runtime");

test("production Office previews require and invoke the configured sandbox", () => {
  assert.throws(() => validatePreviewConfiguration({
    NODE_ENV: "production", LIBREOFFICE_PATH: "/usr/bin/libreoffice",
  }), /PREVIEW_SANDBOX_PATH/);
  const env = {
    NODE_ENV: "production",
    LIBREOFFICE_PATH: "/usr/bin/libreoffice",
    PREVIEW_SANDBOX_PATH: "/app/preview-sandbox.sh",
    PATH: "/usr/bin",
  };
  assert.doesNotThrow(() => validatePreviewConfiguration(env));
  const command = previewCommand(env.LIBREOFFICE_PATH, ["--headless", "/tmp/job/document.docx"], "/tmp/job", env);
  assert.equal(command.executable, env.PREVIEW_SANDBOX_PATH);
  assert.deepEqual(command.args, [env.LIBREOFFICE_PATH, "--headless", "/tmp/job/document.docx"]);
  assert.equal(command.options.shell, undefined);
  assert.equal(command.options.timeout, 90000);
});

test("conversion receives job paths and runtime settings without application secrets", () => {
  const env = previewEnvironment("/tmp/job", {
    PATH: "/usr/bin", LIBREOFFICE_RUNTIME_DIR: "/opt/libreoffice",
    JWT_SECRET: "secret", DATABASE_URL: "private", CLAMSCAN_PATH: "/usr/bin/clamscan",
  });
  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.HOME, "/tmp/job");
  assert.equal(env.TMPDIR, "/tmp/job");
  assert.equal(env.LIBREOFFICE_RUNTIME_DIR, "/opt/libreoffice");
  assert.equal(env.JWT_SECRET, undefined);
  assert.equal(env.DATABASE_URL, undefined);
  assert.equal(env.CLAMSCAN_PATH, undefined);
});

test("development conversion can run directly without a wrapper", () => {
  const env = { NODE_ENV: "development", LIBREOFFICE_PATH: "/usr/bin/libreoffice" };
  assert.doesNotThrow(() => validatePreviewConfiguration(env));
  const command = previewCommand(env.LIBREOFFICE_PATH, ["--headless"], "/tmp/job", env);
  assert.equal(command.executable, env.LIBREOFFICE_PATH);
  assert.deepEqual(command.args, ["--headless"]);
});

test("PDF-only production hosting does not require an Office converter", () => {
  assert.doesNotThrow(() => validatePreviewConfiguration({ NODE_ENV: "production" }));
});
