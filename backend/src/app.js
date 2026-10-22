const cookieParser = require("cookie-parser");
const express = require("express");
const helmet = require("helmet");
const { trustProxy } = require("./config");
const { authenticate } = require("./middleware/authenticate");
const { errorHandler } = require("./middleware/error-handler");
const { protectOrigin } = require("./middleware/origin-protection");
const { apiLimit } = require("./middleware/rate-limits");
const { adminRouter } = require("./routes/admin.routes");
const {
  authenticatedAuthRouter,
  publicAuthRouter,
} = require("./routes/auth.routes");
const { documentsRouter } = require("./routes/documents.routes");
const { projectsRouter } = require("./routes/projects.routes");

const app = express();

app.disable("x-powered-by");
app.set("trust proxy", trustProxy);
app.use(helmet());
app.use(express.json({ limit: "16kb" }));
app.use(cookieParser());
app.use("/api", apiLimit);
app.use("/api", protectOrigin);

app.use("/api/auth", publicAuthRouter);
app.use("/api", authenticate);
app.use("/api/auth", authenticatedAuthRouter);
app.use("/api/projects", projectsRouter);
app.use("/api/documents", documentsRouter);
app.use("/api/admin", adminRouter);

app.use(errorHandler);

module.exports = { app };
