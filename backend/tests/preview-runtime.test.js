const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { previewCommand, previewEnvironment, validatePreviewConfiguration } = require("../src/lib/preview-runtime");

const windows = {
  SystemRoot: "C:\\Windows",
  Path: "C:\\untrusted-bin",
  USERPROFILE: "C:\\Users\\pptinit",
  JWT_SECRET: "do-not-forward",
  DATABASE_URL: "do-not-forward",
  LIBREOFFICE_PATH: "C:\\Program Files\\LibreOffice\\program\\soffice.com",
  NODE_ENV: "production",
};

test("Windows production selects the native sandbox without a Linux shell", () => {
  assert.doesNotThrow(() => validatePreviewConfiguration(windows, "win32"));
  const command = previewCommand(windows.LIBREOFFICE_PATH, ["--headless"], "C:\\Preview jobs\\job", windows, "win32");
  assert.equal(command.executable, "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  assert.ok(command.args.includes("-File"));
  assert.ok(command.args.some((value) => value.endsWith("windows-preview.ps1")));
  assert.ok(!command.args.includes("-Command"));
  assert.equal(command.options.shell, undefined);
  assert.equal(command.options.windowsHide, true);
});

test("Windows configuration rejects stale shell wrappers and non-executable paths", () => {
  assert.throws(() => validatePreviewConfiguration({ ...windows, PREVIEW_SANDBOX_PATH: "/old/script.sh" }, "win32"), /Unset PREVIEW_SANDBOX_PATH/);
  for (const executable of ["soffice.com", "C:\\runtime\\soffice.cmd", "/usr/bin/soffice"]) {
    assert.throws(() => validatePreviewConfiguration({ ...windows, LIBREOFFICE_PATH: executable }, "win32"));
  }
});

test("the Windows launcher gets OS essentials, never application secrets or arbitrary PATH", () => {
  const env = previewEnvironment("D:\\Preview jobs\\job", { ...windows, SystemRoot: undefined, SYSTEMROOT: "C:\\Windows" }, "win32");
  assert.equal(env.SystemRoot, "C:\\Windows");
  assert.equal(env.TEMP, "D:\\Preview jobs\\job");
  assert.equal(env.Path, "C:\\Windows\\System32");
  assert.equal(env.JWT_SECRET, undefined);
  assert.equal(env.DATABASE_URL, undefined);
  assert.equal(env.PATH, undefined);
});

test("Linux production still requires and invokes the configured sandbox", () => {
  assert.throws(() => validatePreviewConfiguration({ NODE_ENV: "production", LIBREOFFICE_PATH: "/usr/bin/libreoffice" }, "linux"), /PREVIEW_SANDBOX_PATH/);
  const env = { PREVIEW_SANDBOX_PATH: "/app/preview-sandbox.sh", PATH: "/usr/bin", JWT_SECRET: "secret" };
  const command = previewCommand("/usr/bin/libreoffice", ["--headless", "/tmp/job/document.docx"], "/tmp/job", env, "linux");
  assert.equal(command.executable, env.PREVIEW_SANDBOX_PATH);
  assert.deepEqual(command.args, ["/usr/bin/libreoffice", "--headless", "/tmp/job/document.docx"]);
  assert.equal(command.options.env.JWT_SECRET, undefined);
  assert.equal(command.options.env.HOME, "/tmp/job");
});

test("PDF-only hosting does not require an Office converter on either OS", () => {
  for (const platform of ["win32", "linux"]) {
    assert.doesNotThrow(() => validatePreviewConfiguration({ NODE_ENV: "production" }, platform));
  }
});
