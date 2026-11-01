import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { exchangeCode, saveConnection } from "@/lib/meta/connect";

export async function GET(req: NextRequest) {
  const base = process.env.APP_URL || req.nextUrl.origin;
  const go = (q: string) => NextResponse.redirect(new URL(`/connections?${q}`, base));
  const s = await getSession();
  if (!s) return NextResponse.redirect(new URL("/login", base));
  const p = req.nextUrl.searchParams;
  if (p.get("error")) return go(`error=${encodeURIComponent(p.get("error_description") || "Autorización cancelada")}`);
  const state = p.get("state");
  if (!state || state !== req.cookies.get("aac_oauth_state")?.value) return go("error=Estado%20OAuth%20inv%C3%A1lido");
  const code = p.get("code");
  if (!code) return go("error=Falta%20c%C3%B3digo");
  try {
    const { token, expiresIn } = await exchangeCode(s.orgId, code);
    const conn = await saveConnection(s.orgId, "Meta (OAuth)", "oauth", token, expiresIn);
    await audit(s, "meta.connect.oauth", conn.id, { user: conn.metaUserName });
    const res = go("ok=Conexi%C3%B3n%20creada.%20Verifica%20los%20activos%20de%20cada%20cuenta.");
    res.cookies.delete("aac_oauth_state");
    return res;
  } catch (e: any) {
    return go(`error=${encodeURIComponent(e.message)}`);
  }
}
