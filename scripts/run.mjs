// Dev helper: run a package.json script from the app folder, e.g. `node home-again/scripts/run.mjs test`.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const [script, ...rest] = process.argv.slice(2);
const allowed = new Set(["test", "typecheck", "build", "lint", "dev"]);
if (!allowed.has(script)) {
  console.error(`usage: node scripts/run.mjs <${[...allowed].join("|")}> [args]`);
  process.exit(2);
}
const cwd = fileURLToPath(new URL("..", import.meta.url));
const result = spawnSync("pnpm", ["run", "--silent", script, ...rest], { cwd, stdio: "inherit" });
process.exit(result.status ?? 1);
