const express = require("express");
const {
  login,
  logout,
  me,
  refresh,
  signup,
} = require("../controllers/auth.controller");
const { authLimit } = require("../middleware/rate-limits");

const publicAuthRouter = express.Router();
const authenticatedAuthRouter = express.Router();

publicAuthRouter.post("/signup", authLimit, signup);
publicAuthRouter.post("/login", authLimit, login);
publicAuthRouter.post("/refresh", authLimit, refresh);
publicAuthRouter.post("/logout", logout);
authenticatedAuthRouter.get("/me", me);

module.exports = { authenticatedAuthRouter, publicAuthRouter };
