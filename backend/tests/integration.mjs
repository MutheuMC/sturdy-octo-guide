import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
const db = new PrismaClient();
const origin = process.env.APP_ORIGIN || "http://localhost:3000";
const tag = randomUUID().slice(0, 8),
  ids = [];
function client() {
  const jar = new Map();
  return {
    jar,
    async request(route, { method = "GET", body, originHeader = origin } = {}) {
      const headers = {
        Origin: originHeader,
        Cookie: [...jar].map(([k, v]) => k + "=" + v).join("; "),
      };
      if (body && !(body instanceof FormData))
        headers["Content-Type"] = "application/json";
      const response = await fetch(origin + "/api" + route, {
        method,
        headers,
        body:
          body instanceof FormData
            ? body
            : body
              ? JSON.stringify(body)
              : undefined,
      });
      for (const cookie of response.headers.getSetCookie()) {
        const [pair] = cookie.split(";");
        const i = pair.indexOf("=");
        jar.set(pair.slice(0, i), pair.slice(i + 1));
      }
      return response;
    },
  };
}
const a = client(),
  b = client(),
  admin = client();
async function register(c, label) {
  const r = await c.request("/auth/signup", {
    method: "POST",
    body: {
      name: label,
      email: `${label}-${tag}@example.test`,
      password: "Integration-only-password-983!",
    },
  });
  assert.equal(r.status, 201, await r.clone().text());
  const u = (await r.json()).user;
  ids.push(u.id);
  return u;
}
try {
  const alice = await register(a, "Alice");
  await register(b, "Bob");
  const manager = await register(admin, "Admin");
  await db.user.update({ where: { id: manager.id }, data: { role: "ADMIN" } });
  assert.equal((await b.request("/admin/users")).status, 403);
  assert.equal(
    (
      await a.request("/projects", {
        method: "POST",
        body: { name: "Blocked" },
        originHeader: "https://attacker.example",
      })
    ).status,
    403,
  );
  const r = await a.request("/projects", {
    method: "POST",
    body: { name: "Integration project" },
  });
  assert.equal(r.status, 201);
  const project = (await r.json()).project;
  assert.equal((await b.request("/projects/" + project.id)).status, 404);
  assert.equal(
    (
      await b.request("/projects/" + project.id + "/links", {
        method: "POST",
        body: { name: "Intrusion", url: "https://example.com" },
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await a.request("/projects/" + project.id + "/links", {
        method: "POST",
        body: { name: "Unsafe", url: "javascript:alert(1)" },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await a.request("/projects/" + project.id + "/links", {
        method: "POST",
        body: { name: "Reference", url: "https://example.com/slides" },
      })
    ).status,
    201,
  );
  let upload = new FormData();
  upload.set("name", "Spoof");
  upload.set("file", new Blob(["fake pptx"]), "fake.pptx");
  assert.equal(
    (
      await a.request("/projects/" + project.id + "/files", {
        method: "POST",
        body: upload,
      })
    ).status,
    400,
  );
  upload = new FormData();
  upload.set("name", "Test PDF");
  upload.set(
    "file",
    new Blob(["%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF"]),
    "test.pdf",
  );
  const uploaded = await a.request("/projects/" + project.id + "/files", {
    method: "POST",
    body: upload,
  });
  assert.equal(uploaded.status, 201, await uploaded.clone().text());
  const doc = (await uploaded.json()).document;
  assert.equal(
    (await b.request("/documents/" + doc.id + "/download")).status,
    404,
  );
  assert.equal(
    (await a.request("/documents/" + doc.id + "/download")).status,
    200,
  );
  assert.equal((await admin.request("/projects/" + project.id)).status, 200);
  assert.equal(
    (await admin.request("/documents/" + doc.id + "/download")).status,
    200,
  );
  assert.equal(
    (await admin.request("/documents/" + doc.id, { method: "DELETE" })).status,
    404,
  );
  assert.equal((await admin.request("/admin/users")).status, 200);
  assert.equal(await db.auditLog.count({ where: { actorId: manager.id } }), 1);
  const oldRefresh = a.jar.get("refresh");
  assert.equal(
    (await a.request("/auth/refresh", { method: "POST" })).status,
    200,
  );
  const newRefresh = a.jar.get("refresh");
  a.jar.set("refresh", oldRefresh);
  assert.equal(
    (await a.request("/auth/refresh", { method: "POST" })).status,
    401,
  );
  a.jar.set("refresh", newRefresh);
  assert.equal(
    (await a.request("/documents/" + doc.id, { method: "DELETE" })).status,
    200,
  );
  const oldAccess = a.jar.get("access");
  assert.equal(
    (await a.request("/auth/logout", { method: "POST" })).status,
    200,
  );
  a.jar.set("access", oldAccess);
  assert.equal((await a.request("/auth/me")).status, 401);
  console.log(
    "PASS: signup, owner isolation, CSRF, URL rejection, spoofed file rejection, PDF upload/download, admin read-only access, audit logging, refresh replay rejection, deletion, immediate logout revocation.",
  );
} finally {
  await db.auditLog.deleteMany({ where: { actorId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
}
