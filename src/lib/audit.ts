import { db } from "./db";
import type { Session } from "./auth";
import type { Prisma } from "@prisma/client";

export async function audit(s: Pick<Session, "orgId" | "email">, action: string, target?: string, detail?: Prisma.InputJsonValue) {
  try {
    await db.auditLog.create({ data: { orgId: s.orgId, userEmail: s.email, action, target, detail } });
  } catch (e) {
    console.error("audit failed", e);
  }
}
