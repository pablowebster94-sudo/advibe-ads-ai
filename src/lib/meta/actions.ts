import { db } from "../db";
import { credsFor } from "./connect";
import { gpost } from "./graph";

/**
 * Acciones que afectan gasto. SOLO se invocan desde la aprobación humana de una propuesta.
 * Nunca se expone una acción de "activar"; pausar y reducir presupuesto son las únicas.
 * Aumentar presupuesto también requiere aprobación explícita (ver executeProposal).
 */
export async function pauseEntity(adAccountId: string, metaId: string) {
  const acc = await db.metaAdAccount.findUniqueOrThrow({ where: { id: adAccountId } });
  const { creds } = await credsFor(acc.connectionId);
  return gpost(metaId, creds, { status: "PAUSED" });
}

export async function setDailyBudget(adAccountId: string, metaId: string, amount: number) {
  const acc = await db.metaAdAccount.findUniqueOrThrow({ where: { id: adAccountId } });
  const { creds } = await credsFor(acc.connectionId);
  return gpost(metaId, creds, { daily_budget: Math.round(amount * 100) });
}
