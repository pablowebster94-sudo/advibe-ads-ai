import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { db } from "./db";

const COOKIE = "aac_session";

export type Session = { userId: string; orgId: string; email: string; role: string };

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET no configurada (mínimo 32 caracteres).");
  return new TextEncoder().encode(s);
}

export async function createSession(s: Session) {
  const token = await new SignJWT({ ...s })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret());
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function destroySession() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const t = jar.get(COOKIE)?.value;
  if (!t) return null;
  try {
    const { payload } = await jwtVerify(t, secret());
    return payload as unknown as Session;
  } catch {
    return null;
  }
}

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

/** Login. La primera vez, si no hay usuarios y coincide con ADMIN_EMAIL/ADMIN_PASSWORD, crea la organización y el owner. */
export async function login(email: string, password: string): Promise<Session | null> {
  email = email.trim().toLowerCase();
  let user = await db.user.findUnique({ where: { email } });
  if (!user) {
    const count = await db.user.count();
    const ae = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    const ap = process.env.ADMIN_PASSWORD;
    if (count === 0 && ae && ap && email === ae && password === ap) {
      const org = await db.organization.create({ data: { name: "AdVibe Agencia" } });
      user = await db.user.create({
        data: { orgId: org.id, email, name: "Admin", passwordHash: await bcrypt.hash(password, 12), role: "OWNER" },
      });
    } else {
      return null;
    }
  }
  if (!(await bcrypt.compare(password, user.passwordHash))) return null;
  return { userId: user.id, orgId: user.orgId, email: user.email, role: user.role };
}

export function canWrite(role: string) {
  return role === "OWNER" || role === "ADMIN" || role === "MEMBER";
}
export function canAdmin(role: string) {
  return role === "OWNER" || role === "ADMIN";
}
