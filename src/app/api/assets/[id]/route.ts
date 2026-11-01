import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { id } = await params;
  // separación de datos: el asset debe pertenecer a un cliente de la organización
  const a = await db.asset.findFirst({ where: { id, client: { orgId: s.orgId } } });
  if (!a) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const dl = req.nextUrl.searchParams.get("download");
  return new NextResponse(new Uint8Array(a.data), {
    headers: {
      "Content-Type": a.mimeType,
      "Cache-Control": "private, max-age=3600",
      ...(dl ? { "Content-Disposition": `attachment; filename="${a.name.replace(/[^\w.\-]/g, "_")}"` } : {}),
    },
  });
}
