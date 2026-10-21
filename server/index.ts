import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import jwt from "jsonwebtoken";
import argon2 from "argon2";
import multer from "multer";
import { PrismaClient, Prisma } from "@prisma/client";
import { z } from "zod";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { title, linkSchema, validateOffice } from "./security";
const prisma = new PrismaClient();
const secret = process.env.JWT_SECRET;
if (!secret || secret.length < 32)
  throw new Error("JWT_SECRET must contain at least 32 characters");
const app = express(),
  origin = process.env.APP_ORIGIN || "http://localhost:3000";
const uploadDir = path.resolve(process.env.UPLOAD_DIR || "./uploads");
const production = process.env.NODE_ENV === "production";
if (production && !process.env.CLAMSCAN_PATH)
  throw new Error("Production uploads require CLAMSCAN_PATH");
const runFile = promisify(execFile);
const cookies = {
  httpOnly: true,
  secure: production,
  sameSite: "lax" as const,
  path: "/api",
};
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
type Identity = { id: string; role: string; name: string; email: string };
declare global {
  namespace Express {
    interface Request {
      user?: Identity;
    }
  }
}
app.disable("x-powered-by");
app.use(helmet());
app.use(express.json({ limit: "16kb" }));
app.use(cookieParser());
app.use("/api", rateLimit({ windowMs: 60000, limit: 120 }));
app.use("/api", (req, res, next) => {
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    req.headers.origin !== origin
  )
    return res.status(403).json({ error: "Invalid request origin" });
  next();
});
const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 25 });
async function issue(res: Response, user: Identity) {
  const refresh = randomBytes(48).toString("hex");
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: hash(refresh),
      expiresAt: new Date(Date.now() + 7 * 86400000),
    },
  });
  res.cookie("refresh", refresh, { ...cookies, maxAge: 7 * 86400000 });
  res.cookie(
    "access",
    jwt.sign({ sub: user.id, sid: session.id }, secret!, {
      expiresIn: "15m",
      issuer: "folio",
      audience: "folio-web",
    }),
    { ...cookies, maxAge: 15 * 60000 },
  );
}
const credentials = z
  .object({
    email: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    password: z.string().min(8).max(128),
  })
  .strict();
app.post("/api/auth/signup", authLimit, async (req, res) => {
  const input = credentials.extend({ name: title }).parse(req.body);
  const user = await prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      passwordHash: await argon2.hash(input.password, {
        type: argon2.argon2id,
      }),
    },
  });
  await issue(res, user);
  res.status(201).json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  });
});
app.post("/api/auth/login", authLimit, async (req, res) => {
  const input = credentials.parse(req.body),
    user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user || !(await argon2.verify(user.passwordHash, input.password)))
    return res.status(401).json({ error: "Email or password is incorrect" });
  await issue(res, user);
  res.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
});
app.post("/api/auth/refresh", authLimit, async (req, res) => {
  const raw = req.cookies.refresh;
  if (typeof raw !== "string")
    return res.status(401).json({ error: "Please log in" });
  const session = await prisma.session.findUnique({
    where: { tokenHash: hash(raw) },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date())
    return res.status(401).json({ error: "Session expired" });
  const consumed = await prisma.session.deleteMany({
    where: { id: session.id },
  });
  if (!consumed.count)
    return res.status(401).json({ error: "Session already used" });
  await issue(res, session.user);
  res.json({ ok: true });
});
app.post("/api/auth/logout", async (req, res) => {
  if (typeof req.cookies.refresh === "string")
    await prisma.session.deleteMany({
      where: { tokenHash: hash(req.cookies.refresh) },
    });
  res.clearCookie("access", cookies);
  res.clearCookie("refresh", cookies);
  res.json({ ok: true });
});
app.use("/api", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const payload = jwt.verify(req.cookies.access, secret!, {
      algorithms: ["HS256"],
      issuer: "folio",
      audience: "folio-web",
    });
    if (
      typeof payload === "string" ||
      !payload.sub ||
      typeof payload.sid !== "string"
    )
      throw Error();
    const session = await prisma.session.findUnique({
      where: { id: payload.sid },
    });
    if (
      !session ||
      session.userId !== payload.sub ||
      session.expiresAt < new Date()
    )
      throw Error();
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, name: true, email: true, role: true },
    });
    if (!user) throw Error();
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: "Please log in" });
  }
});
app.get("/api/auth/me", (req, res) => res.json({ user: req.user }));
async function projectAccess(req: Request, id: string, write = false) {
  const project = await prisma.project.findFirst({
    where: {
      id,
      ...(req.user!.role === "ADMIN" && !write
        ? {}
        : { ownerId: req.user!.id }),
    },
  });
  if (!project)
    throw Object.assign(new Error("Project not found"), { status: 404 });
  return project;
}
app.get("/api/projects", async (req, res) => {
  const ownerId =
    req.user!.role === "ADMIN" && typeof req.query.ownerId === "string"
      ? req.query.ownerId
      : req.user!.id;
  const projects = await prisma.project.findMany({
    where: { ownerId },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { documents: true } } },
  });
  const usage = await prisma.document.aggregate({
    where: { project: { ownerId } },
    _sum: { size: true },
  });
  res.json({
    projects,
    usedBytes: usage._sum.size || 0,
    quotaBytes: 1024 ** 3,
  });
});
app.post("/api/projects", async (req, res) => {
  const input = z.object({ name: title }).strict().parse(req.body);
  const project = await prisma.project.create({
    data: { ...input, ownerId: req.user!.id },
  });
  res.status(201).json({ project });
});
app.get("/api/projects/:id", async (req, res) => {
  const project = await projectAccess(req, String(req.params.id));
  const documents = await prisma.document.findMany({
    where: { projectId: project.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      kind: true,
      url: true,
      size: true,
      createdAt: true,
      originalName: true,
    },
  });
  res.json({ project, documents });
});
app.post("/api/projects/:id/links", async (req, res) => {
  const project = await projectAccess(req, String(req.params.id), true);
  const input = z
    .object({ name: title, url: linkSchema })
    .strict()
    .parse(req.body);
  const document = await prisma.document.create({
    data: { ...input, kind: "LINK", projectId: project.id },
  });
  res.status(201).json({ document });
});
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 1, fields: 1, fieldSize: 1024 },
});
app.post(
  "/api/projects/:id/files",
  rateLimit({ windowMs: 60000, limit: 10 }),
  async (req, res, next) => {
    try {
      await projectAccess(req, String(req.params.id), true);
      next();
    } catch (e) {
      next(e);
    }
  },
  upload.single("file"),
  async (req, res) => {
    const name = title.parse(req.body.name),
      file = req.file;
    if (!file) return res.status(400).json({ error: "Choose a file" });
    const ext = path.extname(file.originalname).toLowerCase(),
      kind = (
        { ".pptx": "PPTX", ".pdf": "PDF", ".docx": "DOCX" } as Record<
          string,
          string
        >
      )[ext];
    if (!kind)
      return res
        .status(400)
        .json({ error: "Only PPTX, PDF, and DOCX files are supported" });
    if (kind === "PDF") {
      if (
        file.buffer.subarray(0, 5).toString() !== "%PDF-" ||
        !file.buffer.subarray(-2048).includes(Buffer.from("%%EOF"))
      )
        return res.status(400).json({ error: "Invalid PDF file" });
    } else await validateOffice(file.buffer, kind);
    // Private storage; no inline preview or execution of user documents.
    const storageKey = randomUUID() + ext;
    await mkdir(uploadDir, { recursive: true });
    await writeFile(path.join(uploadDir, storageKey), file.buffer, {
      flag: "wx",
      mode: 0o600,
    });
    try {
      if (process.env.CLAMSCAN_PATH) {
        try {
          await runFile(
            process.env.CLAMSCAN_PATH,
            ["--no-summary", path.join(uploadDir, storageKey)],
            { timeout: 60000, maxBuffer: 4096 },
          );
        } catch {
          throw Object.assign(
            new Error(
              "File scanning failed or the document was flagged as unsafe",
            ),
            { status: 422 },
          );
        }
      }
      const document = await prisma.$transaction(async (tx) => {
        // Lock the account to serialize simultaneous quota checks.
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${req.user!.id} FOR UPDATE`;
        const usage = await tx.document.aggregate({
          where: { project: { ownerId: req.user!.id } },
          _sum: { size: true },
        });
        if ((usage._sum.size || 0) + file.size > 1024 ** 3)
          throw Object.assign(
            new Error("Your 1 GB storage quota has been reached"),
            { status: 400 },
          );
        return tx.document.create({
          data: {
            name,
            kind,
            storageKey,
            originalName: path.basename(file.originalname),
            size: file.size,
            projectId: String(req.params.id),
          },
        });
      });
      res.status(201).json({ document });
    } catch (e) {
      await unlink(path.join(uploadDir, storageKey));
      throw e;
    }
  },
);
app.get("/api/documents/:id/download", async (req, res) => {
  const doc = await prisma.document.findUnique({
    where: { id: String(req.params.id) },
    include: { project: true },
  });
  if (
    !doc ||
    (doc.project.ownerId !== req.user!.id && req.user!.role !== "ADMIN")
  )
    return res.status(404).json({ error: "Document not found" });
  if (!doc.storageKey)
    return res.status(400).json({ error: "This document is a link" });
  if (req.user!.role === "ADMIN")
    await prisma.auditLog.create({
      data: {
        actorId: req.user!.id,
        action: "DOWNLOAD_DOCUMENT",
        resourceId: doc.id,
      },
    });
  res.setHeader("Cache-Control", "no-store");
  res.download(
    path.join(uploadDir, doc.storageKey),
    doc.originalName || doc.name,
  );
});
app.delete("/api/documents/:id", async (req, res) => {
  const doc = await prisma.document.findUnique({
    where: { id: String(req.params.id) },
    include: { project: true },
  });
  if (!doc || doc.project.ownerId !== req.user!.id)
    return res.status(404).json({ error: "Document not found" });
  await prisma.document.delete({ where: { id: doc.id } });
  if (doc.storageKey)
    await unlink(path.join(uploadDir, doc.storageKey)).catch(() => {});
  res.json({ ok: true });
});
app.get("/api/admin/users", async (req, res) => {
  if (req.user!.role !== "ADMIN")
    return res.status(403).json({ error: "Admin access required" });
  const query = z
    .object({
      search: z.string().max(100).default(""),
      page: z.coerce.number().int().min(1).default(1),
    })
    .parse(req.query);
  const where = {
    OR: [
      { name: { contains: query.search, mode: "insensitive" as const } },
      { email: { contains: query.search, mode: "insensitive" as const } },
    ],
  };
  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip: (query.page - 1) * 24,
      take: 24,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        _count: { select: { projects: true } },
      },
    }),
    prisma.user.count({ where }),
  ]);
  res.json({ users, total, page: query.page });
});
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof z.ZodError)
    return res.status(400).json({ error: err.issues[0].message });
  if (err instanceof multer.MulterError)
    return res.status(400).json({
      error:
        err.code === "LIMIT_FILE_SIZE"
          ? "Maximum file size is 50 MB"
          : "Invalid upload",
    });
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  )
    return res.status(409).json({ error: "That email is already registered" });
  const e = err as Error & { status?: number };
  if (e.status) return res.status(e.status).json({ error: e.message });
  if (/Office|archive|extension/.test(e.message))
    return res.status(400).json({ error: e.message });
  console.error(e);
  res.status(500).json({ error: "Something went wrong. Please try again." });
});
app.listen(Number(process.env.PORT || 4000), "127.0.0.1", () =>
  console.log("pptinit API listening on port " + (process.env.PORT || 4000)),
);
