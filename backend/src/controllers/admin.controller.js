const { z } = require("zod");
const { prisma } = require("../lib/prisma");

async function listUsers(req, res) {
  const query = z
    .object({
      search: z.string().max(100).default(""),
      page: z.coerce.number().int().min(1).default(1),
    })
    .parse(req.query);
  const where = {
    OR: [
      { name: { contains: query.search, mode: "insensitive" } },
      { email: { contains: query.search, mode: "insensitive" } },
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
}

module.exports = { listUsers };
