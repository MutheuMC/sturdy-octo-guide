const { readdirSync, statSync } = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const backendRoot = path.resolve(__dirname, "..");
const roots = ["src", "tests", "prisma"].map((root) =>
  path.join(backendRoot, root),
);
const files = [];

function collect(directory) {
  for (const entry of readdirSync(directory)) {
    const target = path.join(directory, entry);
    if (statSync(target).isDirectory()) collect(target);
    else if (/\.(?:js|mjs)$/.test(entry)) files.push(target);
  }
}

for (const root of roots) collect(root);

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log(`Checked ${files.length} backend JavaScript files.`);
