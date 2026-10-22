require("../src/config/env");
const { access, mkdir, mkdtemp, rm, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");
const runFile = promisify(require("node:child_process").execFile);
const config = require("../src/config");

async function check() {
  for (const directory of [config.uploadDir, config.previewTempDir]) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = await mkdtemp(path.join(directory, "pptinit-check-"));
    try { await writeFile(path.join(temporary, "writable"), "ok", { mode: 0o600 }); }
    finally { await rm(temporary, { recursive: true, force: true }); }
  }
  if (process.env.LIBREOFFICE_PATH) {
    await access(process.env.LIBREOFFICE_PATH);
    if (process.platform === "win32") {
      const powershell = path.join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe");
      await runFile(powershell, ["-NoProfile", "-NonInteractive", "-File",
        path.resolve(__dirname, "windows-preview.ps1"), "-CheckOnly"],
      { timeout: 30000, windowsHide: true });
      console.log("Windows AppContainer launcher compiles; run npm run test:windows for actual conversion.");
    } else {
      if (process.env.PREVIEW_SANDBOX_PATH) await access(process.env.PREVIEW_SANDBOX_PATH);
    }
  }
  if (process.env.CLAMSCAN_PATH) {
    await runFile(process.env.CLAMSCAN_PATH, ["--version"], { timeout: 15000, windowsHide: true });
  }
  const { prisma } = require("../src/lib/prisma");
  try { await prisma.$queryRaw`SELECT 1`; }
  finally { await prisma.$disconnect(); }
  console.log("PASS: database, writable storage, configured converter, and scanner executable.");
}
check().catch((error) => { console.error(error.message); process.exitCode = 1; });
