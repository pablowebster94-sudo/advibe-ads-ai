import { redirect } from "next/navigation";
import { canWrite, requireSession } from "./auth";

/** Sesión con permiso de escritura para server actions */
export async function writer() {
  const s = await requireSession();
  if (!canWrite(s.role)) throw new Error("Tu rol no permite modificar datos.");
  return s;
}

/** Redirige con mensaje (ok/error) para mostrarlo en la página */
export function back(path: string, kind: "ok" | "error", msg: string): never {
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${sep}${kind}=${encodeURIComponent(msg.slice(0, 300))}`);
}

export const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
export const num = (f: FormData, k: string) => {
  const v = str(f, k);
  return v === "" ? null : Number(v);
};
