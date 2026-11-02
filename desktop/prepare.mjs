// Copies the built game page into the desktop app and makes the icon.
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const page = join(here, "..", "dist", "rad-survivors.html");
if (!existsSync(page)) throw new Error("Run `npm run build` in the repo root first.");
mkdirSync(join(here, "app"), { recursive: true });
copyFileSync(page, join(here, "app", "index.html"));
console.log("copied game page into desktop/app/index.html");
