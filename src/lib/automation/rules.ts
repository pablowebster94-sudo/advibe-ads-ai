import { db } from "../db";
import { adPerformance, classify, fatigue } from "../analytics/insights";
import { orgAccountIds } from "../analytics/kpis";

export const RULE_TYPES = {
  LOW_PERFORMANCE: "Bajo rendimiento: gasto sin resultados",
  HIGH_CPA: "CPA alto vs. objetivo",
  OPPORTUNITY: "Oportunidad: CPA muy bajo (escalar)",
  FATIGUE: "Fatiga creativa",
  BUDGET_SCALE: "Escalar presupuesto (con tope)",
} as const;
export type RuleType = keyof typeof RULE_TYPES;

export type RuleParams = {
  minSpend?: number; // gasto mínimo para evaluar
  targetCpa?: number; // CPA objetivo
  cpaMultiplier?: number; // ej. 1.5 => dispara si CPA > 1.5x objetivo
  days?: number;
  scalePct?: number; // % de aumento propuesto
  maxDaily?: number; // tope duro de presupuesto diario
};

/**
 * Evalúa reglas. NUNCA ejecuta: crea alertas o propuestas PENDING con simulación.
 * La ejecución exige aprobación humana (execute.ts).
 */
export async function evaluateRules(orgId: string) {
  const rules = await db.automationRule.findMany({ where: { orgId, enabled: true } });
  const accountIds = await orgAccountIds(orgId);
  let created = 0;
  if (!accountIds.length) return { created };

  for (const rule of rules) {
    const p = (rule.params || {}) as RuleParams;
    const days = p.days ?? 7;
    const to = new Date();
    to.setUTCHours(0, 0, 0, 0);
    const from = new Date(to.getTime() - (days - 1) * 86400000);
    const perf = await adPerformance(accountIds, from, to);
    const active = perf.filter((x) => !x.status || x.status === "ACTIVE");

    const propose = async (a: (typeof perf)[number], action: "PAUSE" | "SET_DAILY_BUDGET", reason: string, payload: object, simulation: object) => {
      const dup = await db.automationProposal.findFirst({ where: { entityId: a.adId, action, status: "PENDING" } });
      if (dup) return;
      await db.automationProposal.create({
        data: { ruleId: rule.id, adAccountId: a.adAccountId, entityLevel: "ad", entityId: a.adId, entityName: a.name, action, reason, payload, simulation },
      });
      created++;
    };
    const alert = async (a: (typeof perf)[number], kind: string, title: string, detail: string) => {
      const refKey = `${rule.type}:${a.adId}:${to.toISOString().slice(0, 10)}`;
      try {
        await db.alert.create({ data: { orgId, kind, title, detail, refKey } });
        created++;
      } catch {
        /* duplicado del día */
      }
    };

    if (rule.type === "LOW_PERFORMANCE") {
      const min = p.minSpend ?? 10;
      for (const a of active.filter((x) => x.t.spend >= min && x.t.results === 0)) {
        const reason = `Gastó ${a.t.spend.toFixed(2)} en ${days} días sin resultados.`;
        if (rule.action === "PROPOSE_PAUSE")
          await propose(a, "PAUSE", reason, {}, { effect: "El anuncio se pausaría.", savedPerDayApprox: a.t.spend / days });
        else await alert(a, "warning", `Sin resultados: ${a.name}`, reason);
      }
    } else if (rule.type === "HIGH_CPA") {
      const target = p.targetCpa;
      if (!target) continue;
      const mult = p.cpaMultiplier ?? 1.5;
      for (const a of active.filter((x) => x.t.spend >= (p.minSpend ?? 10) && x.t.cpa != null && x.t.cpa > target * mult)) {
        const reason = `CPA ${a.t.cpa!.toFixed(2)} supera ${mult}x el objetivo (${target}).`;
        if (rule.action === "PROPOSE_PAUSE") await propose(a, "PAUSE", reason, {}, { effect: "El anuncio se pausaría.", cpa: a.t.cpa });
        else await alert(a, "warning", `CPA alto: ${a.name}`, reason);
      }
    } else if (rule.type === "OPPORTUNITY" || rule.type === "BUDGET_SCALE") {
      const { winners } = classify(active, p.minSpend ?? 10);
      for (const a of winners) {
        const reason = `CPA ${a.t.cpa!.toFixed(2)} bien por debajo de la mediana: candidato a escalar.`;
        if (rule.type === "OPPORTUNITY" || rule.action === "ALERT") {
          await alert(a, "opportunity", `Oportunidad: ${a.name}`, reason);
        } else {
          const adset = await db.metaEntity.findFirst({ where: { adAccountId: a.adAccountId, level: "adset", metaId: a.adsetId } });
          if (!adset?.dailyBudget) continue; // presupuesto a nivel campaña/sin dato: no se propone
          const next = Math.min(adset.dailyBudget * (1 + (p.scalePct ?? 20) / 100), p.maxDaily ?? adset.dailyBudget * 1.5);
          if (next <= adset.dailyBudget) continue;
          await propose(
            { ...a, adId: adset.metaId, name: adset.name },
            "SET_DAILY_BUDGET",
            reason,
            { amount: Number(next.toFixed(2)), level: "adset" },
            { from: adset.dailyBudget, to: Number(next.toFixed(2)), extraSpendPerDay: Number((next - adset.dailyBudget).toFixed(2)), note: "Aumenta gasto: requiere aprobación explícita." }
          );
        }
      }
    } else if (rule.type === "FATIGUE") {
      for (const f of await fatigue(accountIds)) {
        await alert(f.ad, "warning", `Fatiga creativa: ${f.ad.name}`, `Frecuencia ${f.ad.frequency.toFixed(1)} y CTR ${f.ctrDrop!.toFixed(0)}% menor que la semana previa. Renueva la creatividad.`);
      }
    }
  }
  return { created };
}
