const { createHash, randomBytes } = require("node:crypto");
const jwt = require("jsonwebtoken");
const { cookieOptions, jwtSecret } = require("../config");
const { prisma } = require("../lib/prisma");

function hashToken(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function issueSession(res, user) {
  const refresh = randomBytes(48).toString("hex");
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refresh),
      expiresAt: new Date(Date.now() + 7 * 86400000),
    },
  });

  res.cookie("refresh", refresh, {
    ...cookieOptions,
    maxAge: 7 * 86400000,
  });
  res.cookie(
    "access",
    jwt.sign({ sub: user.id, sid: session.id }, jwtSecret, {
      expiresIn: "15m",
      issuer: "folio",
      audience: "folio-web",
    }),
    { ...cookieOptions, maxAge: 15 * 60000 },
  );
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };
}

module.exports = { hashToken, issueSession, publicUser };
