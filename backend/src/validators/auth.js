const { z } = require("zod");

const credentials = z
  .object({
    email: z
      .email()
      .max(254)
      .transform((value) => value.toLowerCase()),
    password: z.string().min(8).max(128),
  })
  .strict();

module.exports = { credentials };
