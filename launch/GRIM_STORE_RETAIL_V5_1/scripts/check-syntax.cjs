const fs = require("node:fs"),
  path = require("node:path"),
  { spawnSync } = require("node:child_process");
let count = 0;
function check(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) check(p);
    else if (/\.(js|cjs)$/.test(p)) {
      const r = spawnSync(process.execPath, ["--check", p], {
        encoding: "utf8",
      });
      if (r.status) {
        process.stderr.write(r.stderr);
        process.exitCode = 1;
      }
      count++;
    }
  }
}
for (const dir of ["src", "public", "api", "scripts"]) check(dir);
console.log(`Syntax checked ${count} JavaScript files.`);
