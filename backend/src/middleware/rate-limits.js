const { rateLimit } = require("express-rate-limit");

const apiLimit = rateLimit({ windowMs: 60000, limit: 120 });
const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 25 });
const previewLimit = rateLimit({ windowMs: 60000, limit: 15 });
const uploadLimit = rateLimit({ windowMs: 60000, limit: 10 });
const documentUpdateLimit = rateLimit({ windowMs: 60000, limit: 60 });

module.exports = { apiLimit, authLimit, previewLimit, uploadLimit, documentUpdateLimit };
