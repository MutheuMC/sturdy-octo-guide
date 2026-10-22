const { getAccessibleProject } = require("../services/access.service");

async function authorizeProjectWrite(req, _res, next) {
  try {
    req.project = await getAccessibleProject(
      req.user,
      String(req.params.id),
      true,
    );
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = { authorizeProjectWrite };
