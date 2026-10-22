const { origin } = require("../config");

function protectOrigin(req, res, next) {
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    req.headers.origin !== origin
  ) {
    return res.status(403).json({ error: "Invalid request origin" });
  }
  next();
}

module.exports = { protectOrigin };
