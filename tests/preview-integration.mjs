import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { readFile, rm, access } from "node:fs/promises";
import path from "node:path";
const db = new PrismaClient(),
  origin = "http://localhost:3000",
  ids = [],
  files = [];
function client() {
  const jar = new Map();
  return async (route, method = "GET", body) => {
    const headers = {
      Origin: origin,
      Cookie: [...jar].map(([k, v]) => k + "=" + v).join("; "),
    };
    if (body && !(body instanceof FormData))
      headers["Content-Type"] = "application/json";
    const res = await fetch(origin + "/api" + route, {
      method,
      headers,
      body:
        body instanceof FormData
          ? body
          : body
            ? JSON.stringify(body)
            : undefined,
    });
    for (const cookie of res.headers.getSetCookie()) {
      const pair = cookie.split(";")[0],
        index = pair.indexOf("=");
      jar.set(pair.slice(0, index), pair.slice(index + 1));
    }
    return res;
  };
}
const owner = client(),
  outsider = client(),
  admin = client();
async function signup(c, name) {
  const r = await c("/auth/signup", "POST", {
    name,
    email: `preview-${name}-${randomUUID()}@example.test`,
    password: "testpass8",
  });
  assert.equal(r.status, 201, await r.clone().text());
  const u = (await r.json()).user;
  ids.push(u.id);
  return u;
}
try {
  await signup(owner, "owner");
  await signup(outsider, "outsider");
  const manager = await signup(admin, "admin");
  await db.user.update({ where: { id: manager.id }, data: { role: "ADMIN" } });
  const created = await owner("/projects", "POST", {
    name: "Preview integration",
  });
  const project = (await created.json()).project;
  for (const [fixture, kind] of [
    ["document.pdf", "PDF"],
    ["two-slides.pptx", "PPTX"],
    ["document.docx", "DOCX"],
  ]) {
    const body = new FormData();
    body.set("name", kind + " preview test");
    body.set(
      "file",
      new Blob([
        await readFile(new URL("./fixtures/" + fixture, import.meta.url)),
      ]),
      fixture,
    );
    const response = await owner(
      "/projects/" + project.id + "/files",
      "POST",
      body,
    );
    assert.equal(response.status, 201, await response.clone().text());
    const doc = (await response.json()).document;
    files.push(doc.storageKey);
    assert.equal(
      (await outsider("/documents/" + doc.id + "/preview/status")).status,
      404,
    );
    assert.equal(
      (await outsider("/documents/" + doc.id + "/preview", "POST")).status,
      404,
    );
    assert.equal(
      (await outsider("/documents/" + doc.id + "/preview")).status,
      404,
    );
    if (kind !== "PDF") {
      assert.equal(
        (await owner("/documents/" + doc.id + "/preview")).status,
        409,
      );
      assert.equal(
        (await owner("/documents/" + doc.id + "/preview", "POST")).status,
        202,
      );
      let state;
      for (let i = 0; i < 70; i++) {
        const res = await owner("/documents/" + doc.id + "/preview/status");
        assert.equal(res.status, 200);
        state = await res.json();
        if (state.status === "READY" || state.status === "FAILED") break;
        await new Promise((resolve) => setTimeout(resolve, 1800));
      }
      assert.equal(state.status, "READY", JSON.stringify(state));
      const stored = await db.document.findUnique({ where: { id: doc.id } });
      assert.ok(stored.previewSize > 0);
      files.push(stored.previewKey);
    }
    const pdf = await owner("/documents/" + doc.id + "/preview");
    assert.equal(pdf.status, 200, await pdf.clone().text());
    assert.match(pdf.headers.get("content-type"), /application\/pdf/);
    assert.match(pdf.headers.get("content-disposition"), /^inline/);
    assert.match(pdf.headers.get("cache-control"), /no-store/);
    assert.equal(
      Buffer.from(await pdf.arrayBuffer())
        .subarray(0, 5)
        .toString(),
      "%PDF-",
    );
    assert.equal(
      (await admin("/documents/" + doc.id + "/preview")).status,
      200,
    );
    assert.equal(
      (await owner("/documents/" + doc.id + "/preview/status")).status,
      200,
    );
    assert.equal((await owner("/documents/" + doc.id, "DELETE")).status, 200);
    for (const key of files)
      await assert.rejects(
        access(path.resolve(process.env.UPLOAD_DIR || "./uploads", key)),
      );
    files.length = 0;
    console.log(
      "PASS: " +
        kind +
        " preview, ownership, admin viewing, private PDF headers, original and preview cleanup",
    );
  }

  const brokenForm = new FormData();
  brokenForm.set("name", "Damaged PowerPoint");
  brokenForm.set(
    "file",
    new Blob([
      await readFile(new URL("./fixtures/invalid.pptx", import.meta.url)),
    ]),
    "invalid.pptx",
  );
  const brokenResponse = await owner(
    "/projects/" + project.id + "/files",
    "POST",
    brokenForm,
  );
  assert.equal(brokenResponse.status, 201);
  const broken = (await brokenResponse.json()).document;
  files.push(broken.storageKey);
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.equal(
      (await owner("/documents/" + broken.id + "/preview", "POST")).status,
      202,
    );
    let state;
    for (let i = 0; i < 70; i++) {
      state = await (
        await owner("/documents/" + broken.id + "/preview/status")
      ).json();
      if (state.status === "FAILED") break;
      await new Promise((resolve) => setTimeout(resolve, 1800));
    }
    assert.equal(state.status, "FAILED");
    assert.ok(state.error);
    assert.equal(
      (await owner("/documents/" + broken.id + "/preview")).status,
      409,
    );
  }
  console.log(
    "PASS: conversion failure reports a safe error; retry requeues; no failed preview is served",
  );
} finally {
  const remaining = await db.document.findMany({
    where: { project: { ownerId: { in: ids } } },
  });
  for (const doc of remaining)
    for (const key of [doc.storageKey, doc.previewKey])
      if (key) files.push(key);
  await db.auditLog.deleteMany({ where: { actorId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
  for (const key of files)
    await rm(path.resolve(process.env.UPLOAD_DIR || "./uploads", key), {
      force: true,
    });
}
