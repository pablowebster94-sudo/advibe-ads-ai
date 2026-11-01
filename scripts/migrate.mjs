// Sincroniza el esquema con la base SOLO si hay DATABASE_URL real. Nunca usa --accept-data-loss.
import { spawnSync } from "node:child_process";
const url = process.env.DATABASE_URL || "";
if (!url || url.includes("placeholder")) {
  console.log("[migrate] DATABASE_URL no configurada: se omite prisma db push.");
  process.exit(0);
}
const r = spawnSync("npx", ["prisma", "db", "push", "--skip-generate"], { stdio: "inherit", shell: process.platform === "win32" });
if (r.status !== 0) {
  console.error("[migrate] prisma db push falló; el build continúa pero la base puede no estar actualizada.");
}
process.exit(0);
