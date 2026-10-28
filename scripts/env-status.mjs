// Prints which .env.local keys are filled, never their values.
import { readFileSync } from "node:fs";

const text = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of text.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) console.log(`${m[1]}: ${m[2].trim() ? "set" : "empty"}`);
}
