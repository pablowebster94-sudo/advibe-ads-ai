import { db } from "../db";
import type { Session } from "../auth";
import { audit } from "../audit";
import { pauseEntity, setDailyBudget } from "../meta/actions";

/** Ejecuta una propuesta SOLO tras decisión humana explícita (botón Aprobar). */
export async function decideProposal(s: Session, id: string, approve: boolean) {
  const p = await db.automationProposal.findUniqueOrThrow({ where: { id } });
  const acc = await db.metaAdAccount.findFirst({ where: { id: p.adAccountId, connection: { orgId: s.orgId } } });
  if (!acc) throw new Error("Propuesta fuera de tu organización.");
  if (p.status !== "PENDING") throw new Error("La propuesta ya fue resuelta.");

  if (!approve) {
    await db.automationProposal.update({ where: { id }, data: { status: "REJECTED", decidedBy: s.email, decidedAt: new Date() } });
    await audit(s, "proposal.reject", id, { entity: p.entityName });
    return;
  }
  try {
    if (p.action === "PAUSE") await pauseEntity(p.adAccountId, p.entityId);
    else if (p.action === "SET_DAILY_BUDGET") await setDailyBudget(p.adAccountId, p.entityId, (p.payload as any).amount);
    else throw new Error(`Acción no soportada: ${p.action}`);
    await db.automationProposal.update({ where: { id }, data: { status: "EXECUTED", decidedBy: s.email, decidedAt: new Date(), result: "OK" } });
    await audit(s, `proposal.execute.${p.action}`, p.entityId, { name: p.entityName, payload: p.payload as any });
  } catch (e: any) {
    await db.automationProposal.update({ where: { id }, data: { status: "FAILED", decidedBy: s.email, decidedAt: new Date(), result: e.message } });
    await audit(s, "proposal.failed", p.entityId, { error: e.message });
    throw e;
  }
}
