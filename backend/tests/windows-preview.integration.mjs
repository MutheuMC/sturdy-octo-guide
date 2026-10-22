// Run on the Windows deployment host under the intended Windows service account.
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import config from "../src/config/index.js";
import previews from "../src/services/preview.service.js";

if (process.platform !== "win32") throw Error("Run this smoke test on Windows Server");
if (!process.env.LIBREOFFICE_PATH) throw Error("Configure LIBREOFFICE_PATH in backend/.env first");
await mkdir(config.previewTempDir, { recursive: true });
for (const fixture of ["document.docx", "two-slides.pptx"]) {
  const work = await mkdtemp(path.join(config.previewTempDir, "pptinit-windows-test-"));
  try {
    const input = path.join(work, fixture);
    await copyFile(new URL(`./fixtures/${fixture}`, import.meta.url), input);
    const result = await previews.convertToPdf(input, work, process.env.LIBREOFFICE_PATH);
    assert.equal((await readFile(result.pdf)).subarray(0, 5).toString(), "%PDF-");
    assert.ok(result.size > 0);
    console.log(`PASS: sandboxed ${fixture} conversion (${result.size} bytes)`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
console.log("Windows preview smoke test passed. Next run test:integration, test:updates and test:previews against the staged app.");
