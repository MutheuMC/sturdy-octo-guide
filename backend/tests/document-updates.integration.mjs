import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import jwt from "jsonwebtoken";
import config from "../src/config/index.js";
import database from "../src/lib/prisma.js";
import application from "../src/app.js";
import previews from "../src/services/preview.service.js";

const { prisma } = database;
const { uploadDir, origin, jwtSecret } = config;
const ids = [];
const keys = new Set();
const temporary = await mkdtemp(path.join(os.tmpdir(), "pptinit-updates-test-"));
const server = application.app.listen(0, "127.0.0.1");
await new Promise((resolve, reject) => {
  server.once("listening", resolve);
  server.once("error", reject);
});
const base = `http://127.0.0.1:${server.address().port}/api`;
let stopWorker;
const environment = { LIBREOFFICE_PATH: process.env.LIBREOFFICE_PATH, PREVIEW_SANDBOX_PATH: process.env.PREVIEW_SANDBOX_PATH };

async function client(role = "USER") {
  const user = await prisma.user.create({ data: {
    name: "Update integration", email: `updates-${randomUUID()}@example.test`, passwordHash: "unused", role,
  } });
  ids.push(user.id);
  const session = await prisma.session.create({ data: {
    userId: user.id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 600000),
  } });
  const token = jwt.sign({ sub: user.id, sid: session.id }, jwtSecret, { issuer: "folio", audience: "folio-web" });
  return { user, request: (route, method = "GET", body, requestOrigin = origin) => fetch(base + route, {
    method,
    headers: { Origin: requestOrigin, Cookie: `access=${token}`, ...(body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}) },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  }) };
}

async function documentResponse(response, status = 200) {
  const data = await response.json();
  assert.equal(response.status, status, JSON.stringify(data));
  if (data.document?.storageKey) keys.add(data.document.storageKey);
  return data.document;
}

function upload(name, bytes, filename = "replacement.pdf") {
  const body = new FormData();
  body.set("name", name);
  body.set("file", new Blob([bytes]), filename);
  return body;
}

async function until(check) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw Error("Timed out waiting for preview worker");
}

try {
  const owner = await client();
  const outsider = await client();
  const admin = await client("ADMIN");
  const created = await owner.request("/projects", "POST", { name: "Document updates" });
  assert.equal(created.status, 201);
  const { project } = await created.json();
  const link = await documentResponse(await owner.request(`/projects/${project.id}/links`, "POST", {
    name: "Original link", url: "https://example.com/original",
  }), 201);
  assert.equal(link.updatedAt, null);
  for (const actor of [outsider, admin]) {
    assert.equal((await actor.request(`/documents/${link.id}`, "PATCH", { name: "Forbidden", url: "https://example.com" })).status, 404);
  }
  assert.equal((await owner.request(`/documents/${link.id}`, "PATCH", { name: "Unsafe", url: "javascript:alert(1)" })).status, 400);
  assert.equal((await owner.request(`/documents/${link.id}`, "PATCH", { name: "CSRF", url: link.url }, "https://attacker.example")).status, 403);
  const changedLink = await documentResponse(await owner.request(`/documents/${link.id}`, "PATCH", { name: "Updated link", url: "https://example.com/new" }));
  assert.equal(changedLink.createdAt, link.createdAt);
  assert.equal(changedLink.url, "https://example.com/new");
  assert.ok(Date.parse(changedLink.updatedAt) >= Date.parse(link.createdAt));
  const noChange = await documentResponse(await owner.request(`/documents/${link.id}`, "PATCH", { name: changedLink.name, url: changedLink.url }));
  assert.equal(noChange.updatedAt, changedLink.updatedAt);

  const originalBytes = Buffer.from("%PDF-1.4\noriginal document contents\n%%EOF");
  const original = await documentResponse(await owner.request(`/projects/${project.id}/files`, "POST", upload("Original file", originalBytes)), 201);
  assert.equal((await outsider.request(`/documents/${original.id}`, "PATCH", upload("Forbidden", originalBytes))).status, 404);
  assert.equal((await admin.request(`/documents/${original.id}`, "PATCH", { name: "Forbidden" })).status, 404);
  const renamed = await documentResponse(await owner.request(`/documents/${original.id}`, "PATCH", { name: "Renamed file" }));
  assert.equal(renamed.storageKey, original.storageKey);
  assert.ok(renamed.updatedAt);
  assert.equal((await owner.request(`/documents/${original.id}`, "PATCH", { name: "Bad", url: "https://example.com" })).status, 400);
  assert.equal((await owner.request(`/documents/${link.id}`, "PATCH", upload("Cannot replace link", originalBytes))).status, 400);
  const beforeInvalid = await readdir(uploadDir);
  assert.equal((await owner.request(`/documents/${original.id}`, "PATCH", upload("Invalid file", "invalid PDF"))).status, 400);
  assert.deepEqual(await readdir(uploadDir), beforeInvalid);
  const unchanged = await prisma.document.findUniqueOrThrow({ where: { id: original.id } });
  assert.equal(unchanged.storageKey, original.storageKey);
  assert.equal(unchanged.updatedAt.toISOString(), renamed.updatedAt);
  assert.deepEqual(await readFile(path.join(uploadDir, original.storageKey)), originalBytes);

  // Fill the quota exactly: replacement must credit both the old file and preview.
  const previewKey = `${randomUUID()}.pdf`;
  keys.add(previewKey);
  await writeFile(path.join(uploadDir, previewKey), originalBytes);
  await prisma.document.update({ where: { id: original.id }, data: {
    previewKey, previewStatus: "READY", previewSize: originalBytes.length,
  } });
  const filler = await prisma.document.create({ data: {
    name: "Quota placeholder", kind: "PDF", storageKey: `${randomUUID()}.pdf`, projectId: project.id,
    size: 1024 ** 3 - originalBytes.length * 2,
  } });
  const replacementBytes = Buffer.from("%PDF-1.4\nnew\n%%EOF");
  const replacement = await documentResponse(await owner.request(`/documents/${original.id}`, "PATCH", upload("Replacement", replacementBytes)));
  assert.equal(replacement.id, original.id);
  assert.equal(replacement.createdAt, original.createdAt);
  assert.notEqual(replacement.storageKey, original.storageKey);
  assert.equal(replacement.previewStatus, "NONE");
  assert.equal(replacement.previewKey, null);
  assert.equal(replacement.previewSize, 0);
  await assert.rejects(access(path.join(uploadDir, original.storageKey)));
  await assert.rejects(access(path.join(uploadDir, previewKey)));
  const download = await owner.request(`/documents/${original.id}/download`);
  assert.equal(download.status, 200);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), replacementBytes);
  const beforeQuota = await readdir(uploadDir);
  assert.equal((await owner.request(`/documents/${original.id}`, "PATCH", upload("Too large", `%PDF-1.4\n${"x".repeat(200)}\n%%EOF`))).status, 400);
  assert.deepEqual(await readdir(uploadDir), beforeQuota);
  assert.equal((await prisma.document.findUniqueOrThrow({ where: { id: original.id } })).storageKey, replacement.storageKey);
  await prisma.document.delete({ where: { id: filler.id } });

  const listing = await owner.request(`/projects/${project.id}`);
  const listed = (await listing.json()).documents.find((doc) => doc.id === original.id);
  assert.equal(listed.updatedAt, replacement.updatedAt);

  // Hold an old Office conversion until after its source has been replaced.
  const office = await documentResponse(await owner.request(`/documents/${original.id}`, "PATCH", upload("Office file", await readFile(new URL("./fixtures/document.docx", import.meta.url)), "document.docx")));
  const converter = path.join(temporary, "converter.cjs");
  const started = path.join(temporary, "started");
  const release = path.join(temporary, "release");
  await writeFile(converter, `#!/usr/bin/env node
const fs = require('node:fs/promises');
(async () => {
  await fs.writeFile(${JSON.stringify(started)}, process.cwd());
  while (!(await fs.access(${JSON.stringify(release)}).then(() => true, () => false))) await new Promise(r => setTimeout(r, 20));
  const output = process.argv[process.argv.indexOf('--outdir') + 1];
  await fs.writeFile(require('node:path').join(output, 'document.pdf'), '%PDF-1.4\\nold conversion\\n%%EOF');
})().catch(() => process.exit(1));
`, { mode: 0o700 });
  process.env.LIBREOFFICE_PATH = converter;
  delete process.env.PREVIEW_SANDBOX_PATH;
  await prisma.document.update({ where: { id: office.id }, data: { previewStatus: "QUEUED" } });
  stopWorker = previews.startPreviewWorker({
    ...prisma,
    document: {
      findFirst: (args) => prisma.document.findFirst({ ...args, where: { ...args.where, id: office.id } }),
      updateMany: (args) => prisma.document.updateMany({ ...args, where: { ...args.where, id: office.id } }),
    },
    $transaction: prisma.$transaction.bind(prisma),
  }, uploadDir);
  await until(() => access(started).then(() => true, () => false));
  const latest = await documentResponse(await owner.request(`/documents/${office.id}`, "PATCH", upload("Latest file", replacementBytes)));
  await writeFile(release, "go");
  const work = await readFile(started, "utf8");
  await until(() => access(work).then(() => false, () => true));
  const final = await prisma.document.findUniqueOrThrow({ where: { id: office.id } });
  assert.equal(final.storageKey, latest.storageKey);
  assert.equal(final.previewStatus, "NONE");
  assert.equal(final.previewKey, null);
  assert.equal(final.previewError, null);
  assert.equal(final.updatedAt.toISOString(), latest.updatedAt);
  console.log("PASS: owner-only edits, link validation, timestamps, rename, replacement, failed-update preservation, quota credit, old file/preview cleanup, and replacement during conversion.");
} finally {
  stopWorker?.();
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const documents = await prisma.document.findMany({ where: { project: { ownerId: { in: ids } } } });
  for (const doc of documents) for (const key of [doc.storageKey, doc.previewKey]) if (key) keys.add(key);
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  for (const key of keys) await rm(path.join(uploadDir, key), { force: true });
  await rm(temporary, { recursive: true, force: true });
  await new Promise((resolve) => server.close(resolve));
  await prisma.$disconnect();
}
