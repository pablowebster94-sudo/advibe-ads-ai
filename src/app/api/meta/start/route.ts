import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getSession } from "@/lib/auth";
import { oauthUrl } from "@/lib/meta/connect";

export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.redirect(new URL("/login", process.env.APP_URL || "http://localhost:3000"));
  try {
    const state = randomBytes(16).toString("hex");
    const url = await oauthUrl(s.orgId, state);
    const res = NextResponse.redirect(url);
    res.cookies.set("aac_oauth_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });
    return res;
  } catch (e: any) {
    return NextResponse.redirect(new URL(`/connections?error=${encodeURIComponent(e.message)}`, process.env.APP_URL));
  }
}
