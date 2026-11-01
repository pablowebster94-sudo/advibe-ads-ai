import { db } from "../db";
import { generateText, parseJson } from "./providers";
import { adPerformance, classify } from "../analytics/insights";
import { clientScope } from "../analytics/kpis";

export const POLICY_NOTE = `Cumple las políticas de publicidad de Meta vigentes: sin afirmaciones engañosas, sin atributos personales ("tú tienes..."), sin promesas garantizadas, sin antes/después irreales; categorías especiales (crédito, empleo, vivienda, temas sociales/política) requieren declaración y restricciones de segmentación. No inventes datos de rendimiento.`;

export type StrategyOutput = {
  summary: string;
  objective: string;
  structure: { campaign: string; adsets: { name: string; audience: string; dailyBudgetPct: number; geo: string; age: string; interests: string[]; exclusions: string[]; placements: string }[] };
  creativeStrategy: string[];
  hypotheses: { hypothesis: string; test: string; metric: string }[];
  risks: string[];
  needsData: string[];
};

/** Estrategia basada en datos reales de la cuenta si existen; si no, lo declara explícitamente. */
export async function buildStrategy(orgId: string, clientId: string, objective: string, brief: string, totalBudget?: number) {
  const client = await db.client.findFirstOrThrow({ where: { id: clientId, orgId }, include: { products: true } });
  const { accountIds, scope } = await clientScope(orgId, clientId);
  let dataBlock = "SIN DATOS REALES DE META para este cliente (no hay cuenta vinculada/sincronizada). No inventes métricas; basa la estrategia en el brief y marca las suposiciones en needsData.";
  let basedOnData = false;
  if (accountIds.length) {
    const to = new Date();
    to.setUTCHours(0, 0, 0, 0);
    const perf = await adPerformance(accountIds, new Date(to.getTime() - 29 * 86400000), to, scope);
    if (perf.length) {
      basedOnData = true;
      const c = classify(perf);
      dataBlock = `DATOS REALES (30 días): ${perf.length} anuncios. Mediana CPA ${c.medianCpa?.toFixed(2) ?? "n/d"}. Mejores: ${c.winners
        .slice(0, 5)
        .map((w) => `${w.name} (CPA ${w.t.cpa?.toFixed(2)}, CTR ${w.t.ctr?.toFixed(2)}%)`)
        .join("; ") || "ninguno"}. Peores: ${c.losers
        .slice(0, 5)
        .map((w) => `${w.name} (CPA ${w.t.cpa?.toFixed(2)})`)
        .join("; ") || "ninguno"}.`;
    }
  }
  const sys = `Eres estratega senior de Meta Ads para una agencia. ${POLICY_NOTE} Responde SOLO JSON con las claves: summary, objective, structure{campaign, adsets[{name,audience,dailyBudgetPct,geo,age,interests[],exclusions[],placements}]}, creativeStrategy[], hypotheses[{hypothesis,test,metric}], risks[], needsData[]. Los intereses deben ser términos de búsqueda reales que luego se validarán contra la API de Meta; no inventes IDs.`;
  const user = `Cliente: ${client.name} (${client.industry ?? "s/d"}). Descripción: ${client.description ?? ""}. Ubicaciones: ${client.locations.join(", ") || "s/d"}. Metas: ${client.goals ?? "s/d"}. Presupuesto mensual: ${client.monthlyBudget ?? "s/d"} ${client.currency}. Productos/servicios: ${client.products.map((p) => `${p.name}${p.offer ? ` (${p.offer})` : ""}`).join(", ") || "s/d"}.\nObjetivo pedido: ${objective}. Presupuesto a repartir: ${totalBudget ?? "s/d"}.\nBrief: ${brief}\n${dataBlock}`;
  const { text, provider } = await generateText(orgId, sys, user, true);
  const content = parseJson<StrategyOutput>(text);
  const row = await db.strategy.create({ data: { clientId, objective, brief, content: content as any, basedOnData, provider } });
  return row;
}
