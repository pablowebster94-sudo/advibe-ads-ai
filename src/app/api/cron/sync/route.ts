import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { syncAdAccount } from "@/lib/meta/sync";
import { evaluateRules } from "@/lib/automation/rules";

export const maxDuration = 300;

/** Tarea diaria: sincroniza (solo lectura) y evalúa reglas (solo crea alertas/propuestas; nunca ejecuta). */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const orgs = await db.organization.findMany({ select: { id: true } });
  const out: any[] = [];
  for (const o of orgs) {
    const accs = await db.metaAdAccount.findMany({ where: { connection: { orgId: o.id, status: "ACTIVE" } } });
    for (const a of accs) {
      try {
        out.push({ account: a.actId, ...(await syncAdAccount(a.id, 7)) });
      } catch (e: any) {
        out.push({ account: a.actId, error: e.message });
      }
    }
    try {
      out.push({ org: o.id, rules: await evaluateRules(o.id) });
    } catch (e: any) {
      out.push({ org: o.id, rulesError: e.message });
    }
  }
  return NextResponse.json({ ok: true, out });
}
