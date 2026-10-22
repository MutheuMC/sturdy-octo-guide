const argon2 = require("argon2");
const { cookieOptions } = require("../config");
const { prisma } = require("../lib/prisma");
const {
  hashToken,
  issueSession,
  publicUser,
} = require("../services/auth.service");
const { credentials } = require("../validators/auth");
const { title } = require("../validators/documents");

const signupInput = credentials.extend({ name: title });

async function signup(req, res) {
  const input = signupInput.parse(req.body);
  const user = await prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      passwordHash: await argon2.hash(input.password, {
        type: argon2.argon2id,
      }),
    },
  });

  await issueSession(res, user);
  res.status(201).json({ user: publicUser(user) });
}

async function login(req, res) {
  const parsed = credentials.safeParse(req.body);
  if (!parsed.success) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  const input = parsed.data;
  const user = await prisma.user.findUnique({
    where: { email: input.email },
  });

  if (!user || !(await argon2.verify(user.passwordHash, input.password))) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  await issueSession(res, user);
  res.json({ user: publicUser(user) });
}

async function refresh(req, res) {
  const raw = req.cookies.refresh;
  if (typeof raw !== "string") {
    return res.status(401).json({ error: "Please log in" });
  }

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(raw) },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date()) {
    return res.status(401).json({ error: "Session expired" });
  }

  const consumed = await prisma.session.deleteMany({
    where: { id: session.id },
  });
  if (!consumed.count) {
    return res.status(401).json({ error: "Session already used" });
  }

  await issueSession(res, session.user);
  res.json({ ok: true });
}

async function logout(req, res) {
  if (typeof req.cookies.refresh === "string") {
    await prisma.session.deleteMany({
      where: { tokenHash: hashToken(req.cookies.refresh) },
    });
  }

  res.clearCookie("access", cookieOptions);
  res.clearCookie("refresh", cookieOptions);
  res.json({ ok: true });
}

function me(req, res) {
  res.json({ user: req.user });
}

module.exports = { login, logout, me, refresh, signup };
