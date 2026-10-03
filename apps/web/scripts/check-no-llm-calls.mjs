import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../src", import.meta.url));
const BANNED = ["generativelanguage.googleapis.com", "openrouter.ai", "api.cloudflare.com", ":11434", "GEMINI_API_KEY", "OPENROUTER_API_KEY", "CLOUDFLARE_API_TOKEN"];
const hits = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx|js|jsx|mjs|json|css|html)$/.test(name)) {
      const text = readFileSync(p, "utf8");
      for (const b of BANNED) if (text.includes(b)) hits.push(`${relative(root, p)} contains ${b}`);
    }
  }
};
walk(root);
if (hits.length) {
  console.error("The web client must not call LLM providers or hold their keys (PLAN.md 3.3, 17).");
  for (const h of hits) console.error("  " + h);
  process.exit(1);
}
console.log("no provider hosts or keys in apps/web/src");
