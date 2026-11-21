// TEMPORAL: solo para rama de preview. Restablece la clave del admin a ADMIN_PASSWORD. Se borra después de usarse.
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ap = process.env.ADMIN_PASSWORD;
  const ae = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!ap || !ae || req.nextUrl.searchParams.get("token") !== ap) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }
  const user = await db.user.findUnique({ where: { email: ae } });
  if (!user) return NextResponse.json({ ok: false, users: await db.user.count() });
  await db.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(ap, 12) } });
  return NextResponse.json({ ok: true, reset: ae });
}
