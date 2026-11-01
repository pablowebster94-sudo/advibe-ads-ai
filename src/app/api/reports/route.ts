import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { orgAccountIds, periodFromDays } from "@/lib/analytics/kpis";
import { reportCsv } from "@/lib/analytics/report";

export async function GET(req: NextRequest) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const days = [7, 14, 30, 90].includes(Number(req.nextUrl.searchParams.get("days"))) ? Number(req.nextUrl.searchParams.get("days")) : 30;
  const cid = req.nextUrl.searchParams.get("client") || undefined;
  if (cid && !(await db.client.findFirst({ where: { id: cid, orgId: s.orgId } }))) return NextResponse.json({ error: "Cliente inválido" }, { status: 404 });
  const ids = await orgAccountIds(s.orgId, cid);
  const { cur } = periodFromDays(days);
  const csv = await reportCsv(ids, cur.from, cur.to);
  return new NextResponse(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="informe-${days}d.csv"` },
  });
}
