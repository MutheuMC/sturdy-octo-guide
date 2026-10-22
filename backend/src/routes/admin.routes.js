const express = require("express");
const { listUsers } = require("../controllers/admin.controller");
const { requireAdmin } = require("../middleware/require-admin");

const adminRouter = express.Router();

adminRouter.get("/users", requireAdmin, listUsers);

module.exports = { adminRouter };
