import Link from "next/link";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { delta, int, money, pct, nf2, ratio } from "@/lib/format";
import { orgAccountIds, clientScope, periodFromDays, CampaignScope } from "@/lib/analytics/kpis";
import { adPerformance, classify, fatigue } from "@/lib/analytics/insights";
import { Empty, PageHeader, Pending } from "@/components/ui";

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ days?: string; client?: string }> }) {
  const s = await requireSession();
  const sp = await searchParams;
  const days = [7, 14, 30, 90].includes(Number(sp.days)) ? Number(sp.days) : 30;
  const clients = await db.client.findMany({ where: { orgId: s.orgId }, orderBy: { name: "asc" } });
  const clientId = clients.find((c) => c.id === sp.client)?.id;
  let ids: string[];
  let scope: CampaignScope | undefined;
  if (clientId) {
    const cs = await clientScope(s.orgId, clientId);
    ids = cs.accountIds;
    scope = cs.scope;
  } else ids = await orgAccountIds(s.orgId);
  const { cur, prev } = periodFromDays(days);
  const [perf, prevPerf, fat] = ids.length ? await Promise.all([adPerformance(ids, cur.from, cur.to, scope), adPerformance(ids, prev.from, prev.to, scope), fatigue(ids, scope)]) : [[], [], []];
  const prevMap = new Map(prevPerf.map((p) => [p.adId, p]));
  const { winners, losers, noResults, medianCpa } = classify(perf);
  const winSet = new Set(winners.map((w) => w.adId));
  const loseSet = new Set(losers.map((w) => w.adId));
  const q = (o: Record<string, string | undefined>) => "?" + new URLSearchParams(Object.entries({ days: String(days), client: clientId, ...o }).filter(([, v]) => v) as [string, string][]).toString();

  const recs: string[] = [];
  for (const w of winners.slice(0, 3)) recs.push(`“${w.name}” tiene CPA ${nf2.format(w.t.cpa!)} (mediana ${nf2.format(medianCpa!)}). Valora escalarlo con aumentos graduales previa tu aprobación.`);
  for (const l of losers.slice(0, 3)) recs.push(`“${l.name}” tiene CPA ${nf2.format(l.t.cpa!)}, ≥1.5x la mediana. Considera pausarlo o cambiar la creatividad.`);
  for (const n of noResults.slice(0, 3)) recs.push(`“${n.name}” gastó ${nf2.format(n.t.spend)} sin resultados registrados. Revisa el seguimiento (pixel/mensajes) antes de decidir.`);
  for (const f of fat.slice(0, 3)) recs.push(`Fatiga en “${f.ad.name}”: frecuencia ${nf2.format(f.ad.frequency)} y CTR ${nf2.format(f.ctrDrop!)}% menor que la semana previa. Renueva la creatividad.`);

  return (
    <div className="space-y-6">
      <PageHeader title="Analítica y optimización" subtitle="Cifras reales de Meta por anuncio. Ganadores/perdedores se calculan contra la mediana de CPA de tu propia cuenta.">
        <a className="btn-ghost" href={`/api/reports${q({})}`}>Exportar CSV</a>
      </PageHeader>
      <div className="flex flex-wrap gap-2">
        {[7, 14, 30, 90].map((d) => <Link key={d} href={`/analytics${q({ days: String(d) })}`} className={d === days ? "btn" : "btn-ghost"}>{d} días</Link>)}
        <Link href={`/analytics${q({ client: undefined })}`} className={!clientId ? "btn" : "btn-ghost"}>Todos</Link>
        {clients.map((c) => <Link key={c.id} href={`/analytics${q({ client: c.id })}`} className={clientId === c.id ? "btn" : "btn-ghost"}>{c.name}</Link>)}
      </div>

      {ids.length === 0 ? <Pending title="cuentas sin vincular">{clientId ? "Este cliente no tiene cuenta publicitaria vinculada." : "No hay cuentas conectadas."} Conecta y sincroniza en Conexiones.</Pending> :
        perf.length === 0 ? <Empty>Sin datos en el período. Sincroniza la cuenta o amplía el rango.</Empty> : (
        <>
          <section className="card space-y-2">
            <h2 className="font-semibold text-white">Recomendaciones basadas en tus datos</h2>
            {recs.length === 0 ? <p className="text-sm text-zinc-400">Aún no hay señales claras (se requiere gasto mínimo y resultados).</p> : <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-300">{recs.map((r, i) => <li key={i}>{r}</li>)}</ul>}
          </section>
          <section className="card overflow-x-auto !p-0">
            <table className="w-full min-w-[980px]">
              <thead><tr>{["Anuncio", "Gasto", "Δ gasto", "Impr.", "Clics", "CTR", "CPC", "CPM", "Frec.", "Result.", "CPA", "ROAS", ""].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-white/5">
                {[...perf].sort((a, b) => b.t.spend - a.t.spend).map((p) => {
                  const pv = prevMap.get(p.adId);
                  const dl = pv ? delta(p.t.spend, pv.t.spend) : null;
                  return (
                    <tr key={p.adId}>
                      <td className="td max-w-[240px] truncate text-white">{p.name}</td>
                      <td className="td">{money(p.t.spend)}</td>
                      <td className={`td ${dl == null ? "text-zinc-500" : dl >= 0 ? "text-emerald-400" : "text-red-400"}`}>{dl == null ? "—" : `${dl.toFixed(0)}%`}</td>
                      <td className="td">{int(p.t.impressions)}</td><td className="td">{int(p.t.clicks)}</td><td className="td">{pct(p.t.ctr)}</td>
                      <td className="td">{money(p.t.cpc)}</td><td className="td">{money(p.t.cpm)}</td><td className="td">{nf2.format(p.frequency)}</td>
                      <td className="td">{int(p.t.results)}</td><td className="td">{money(p.t.cpa)}</td><td className="td">{ratio(p.t.roas)}</td>
                      <td className="td">{winSet.has(p.adId) && <span className="badge bg-emerald-500/15 text-emerald-300">ganador</span>}{loseSet.has(p.adId) && <span className="badge bg-red-500/15 text-red-300">perdedor</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
          <p className="text-xs text-zinc-500">Alcance y frecuencia por anuncio son promedios/sumas de datos diarios; Meta calcula el alcance único solo para el período completo.</p>
        </>
      )}
    </div>
  );
}
