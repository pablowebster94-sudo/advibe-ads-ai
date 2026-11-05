import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { leadsToCsv, listLeads } from "@/lib/meta/leadforms";
import type { DraftAdset } from "@/lib/meta/publish";

/** Descarga CSV de leads de un formulario que pertenece a un borrador de la organización. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ formId: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { formId } = await params;
  const draftId = req.nextUrl.searchParams.get("draft") || "";
  const d = await db.campaignDraft.findFirst({ where: { id: draftId, client: { orgId: s.orgId } } });
  // Solo formularios usados por un borrador de esta organización (evita leer formularios ajenos).
  const owns = d && ((d.adsets as unknown as DraftAdset[]) || []).some(
    (a) => a.leadForm?.metaFormId === formId || a.leadForm?.existingFormId === formId
  );
  if (!d || !owns || !d.adAccountId || !d.pageId) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  try {
    const leads = await listLeads(d.adAccountId, d.pageId, formId, 2000);
    return new NextResponse(leadsToCsv(leads), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="leads-${formId}.csv"`, "Cache-Control": "no-store" },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}
