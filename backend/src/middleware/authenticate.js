const jwt = require("jsonwebtoken");
const { jwtSecret } = require("../config");
const { prisma } = require("../lib/prisma");

async function authenticate(req, res, next) {
  try {
    const payload = jwt.verify(req.cookies.access, jwtSecret, {
      algorithms: ["HS256"],
      issuer: "folio",
      audience: "folio-web",
    });

    if (
      typeof payload === "string" ||
      !payload.sub ||
      typeof payload.sid !== "string"
    ) {
      throw new Error();
    }

    const session = await prisma.session.findUnique({
      where: { id: payload.sid },
    });
    if (
      !session ||
      session.userId !== payload.sub ||
      session.expiresAt < new Date()
    ) {
      throw new Error();
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, name: true, email: true, role: true },
    });
    if (!user) throw new Error();

    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: "Please log in" });
  }
}

module.exports = { authenticate };
