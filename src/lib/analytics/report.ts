import { adPerformance } from "./insights";
import type { CampaignScope } from "./kpis";

function esc(v: unknown) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function reportCsv(accountIds: string[], from: Date, to: Date, scope?: CampaignScope) {
  const perf = await adPerformance(accountIds, from, to, scope);
  const head = ["anuncio", "estado", "gasto", "impresiones", "alcance_aprox", "clics", "ctr_%", "cpc", "cpm", "conversaciones", "leads", "compras", "cpa", "roas", "frecuencia"];
  const lines = [head.join(",")];
  for (const p of perf) {
    const t = p.t;
    lines.push(
      [p.name, p.status, t.spend.toFixed(2), t.impressions, t.reach, t.clicks, t.ctr?.toFixed(2), t.cpc?.toFixed(2), t.cpm?.toFixed(2), t.conversations, t.leads, t.purchases, t.cpa?.toFixed(2), t.roas?.toFixed(2), p.frequency.toFixed(2)]
        .map(esc)
        .join(",")
    );
  }
  return "﻿" + lines.join("\n");
}
