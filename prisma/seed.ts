import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";
const prisma = new PrismaClient();
async function main() {
  const email = process.env.ADMIN_EMAIL?.toLowerCase(),
    password = process.env.ADMIN_PASSWORD;
  if (!email || !password || password.length < 8)
    throw Error("Set ADMIN_EMAIL and ADMIN_PASSWORD (8+ characters)");
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
