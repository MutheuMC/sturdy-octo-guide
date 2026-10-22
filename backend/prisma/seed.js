require("../src/config/env");

const { PrismaClient } = require("@prisma/client");
const argon2 = require("argon2");

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL?.toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password || password.length < 8) {
    throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD (8+ characters)");
  }

  await prisma.user.upsert({
    where: { email },
    create: {
      name: "Administrator",
      email,
      passwordHash: await argon2.hash(password),
      role: "ADMIN",
    },
    update: { role: "ADMIN" },
  });
  console.log("Admin account ready");
}

main().finally(() => prisma.$disconnect());
