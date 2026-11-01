import Link from "next/link";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { back, str, writer } from "@/lib/actions-util";
import { delta, int, money, pct, ratio, dateISO } from "@/lib/format";
import { fetchRows, groupBy, orgAccountIds, periodFromDays, sumRows, totals } from "@/lib/analytics/kpis";
import { classify, adPerformance } from "@/lib/analytics/insights";
import { Bars } from "@/components/Spark";
import { Empty, Notice, PageHeader, Pending, Stat } from "@/components/ui";

async function resolve(f: FormData) {
  "use server";
  const s = await writer();
  await db.alert.updateMany({ where: { id: str(f, "id"), orgId: s.orgId }, data: { resolved: true } });
  back("/dashboard", "ok", "Alerta resuelta.");
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ days?: string; ok?: string }> }) {
  const s = await requireSession();
  const sp = await searchParams;
  const days = [7, 14, 30, 90].includes(Number(sp.days)) ? Number(sp.days) : 30;
  const accounts = await db.metaAdAccount.findMany({ where: { connection: { orgId: s.orgId } }, include: { links: { include: { client: true } } } });
  const ids = accounts.map((a) => a.id);
  const { cur, prev } = periodFromDays(days);
  const [curRows, prevRows] = await Promise.all([fetchRows(ids, cur), fetchRows(ids, prev)]);
  const T = totals(sumRows(curRows));
  const P = totals(sumRows(prevRows));
  const alerts = await db.alert.findMany({ where: { orgId: s.orgId, resolved: false }, orderBy: { createdAt: "desc" }, take: 12 });
  const pendingProposals = await db.automationProposal.count({ where: { status: "PENDING", adAccountId: { in: ids } } });

  const byDay = groupBy(curRows as any[], (r) => dateISO(r.date));
  const dayKeys = [...byDay.keys()].sort();

  const byAccount = groupBy(curRows as any[], (r) => r.adAccountId);
  const clientOfAccount = new Map<string, { id: string; name: string; currency: string }[]>();
  for (const a of accounts) clientOfAccount.set(a.id, a.links.map((l) => ({ id: l.client.id, name: l.client.name, currency: l.client.currency })));
  const byClient = new Map<string, { name: string; row: ReturnType<typeof sumRows> }>();
  for (const [accId, row] of byAccount) {
    const cl = clientOfAccount.get(accId) ?? [];
    // si una cuenta sirve a varios clientes no se puede atribuir por cliente sin datos de campaña: se marca como "Sin asignar"
    const key = cl.length === 1 ? cl[0].id : "unassigned";
    const name = cl.length === 1 ? cl[0].name : "Cuenta compartida / sin cliente";
    const e = byClient.get(key) ?? { name, row: sumRows([]) };
    e.row = sumRows([e.row, row]);
    byClient.set(key, e);
  }
  const perf = ids.length ? await adPerformance(ids, cur.from, cur.to) : [];
  const { winners, losers } = classify(perf);
  const hasData = curRows.length > 0;
  const currency = accounts[0]?.currency ?? "USD";
  const campNames = new Map((await db.metaEntity.findMany({ where: { adAccountId: { in: ids }, level: "campaign" } })).map((e) => [e.metaId, e.name]));
  const byCampaign = [...groupBy(curRows as any[], (r) => r.campaignId).entries()].map(([k, row]) => ({ id: k, name: campNames.get(k) ?? k, t: totals(row) })).sort((a, b) => b.t.spend - a.t.spend).slice(0, 8);

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" subtitle="Datos reales sincronizados desde Meta. Sin sincronizar no se muestran cifras.">
        {[7, 14, 30, 90].map((d) => (
          <Link key={d} href={`/dashboard?days=${d}`} className={d === days ? "btn" : "btn-ghost"}>{d} días</Link>
        ))}
      </PageHeader>

      {accounts.length === 0 ? (
        <Pending title="conectar Meta">No hay cuentas publicitarias conectadas. Ve a <Link href="/connections" className="underline">Conexiones Meta</Link> para conectar Imperio Barber Studio y AdVibe Agencia.</Pending>
      ) : !hasData ? (
        <Pending title="sincronizar resultados">Hay {accounts.length} cuenta(s) pero sin resultados en este período. Usa “Sincronizar” en <Link href="/connections" className="underline">Conexiones</Link>. Si la cuenta no tuvo gasto, aquí no habrá cifras.</Pending>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Inversión" value={money(T.spend, currency)} delta={delta(T.spend, P.spend)} />
            <Stat label="Impresiones" value={int(T.impressions)} delta={delta(T.impressions, P.impressions)} />
            <Stat label="Alcance (suma diaria)" value={int(T.reach)} delta={delta(T.reach, P.reach)} hint="Aproximado: suma de alcance diario" />
            <Stat label="Clics" value={int(T.clicks)} delta={delta(T.clicks, P.clicks)} />
            <Stat label="CTR" value={pct(T.ctr)} delta={T.ctr && P.ctr ? delta(T.ctr, P.ctr) : null} />
            <Stat label="CPC" value={money(T.cpc, currency)} delta={T.cpc && P.cpc ? delta(T.cpc, P.cpc) : null} />
            <Stat label="CPM" value={money(T.cpm, currency)} delta={T.cpm && P.cpm ? delta(T.cpm, P.cpm) : null} />
            <Stat label="Conversaciones" value={int(T.conversations)} delta={delta(T.conversations, P.conversations)} />
            <Stat label="Leads" value={int(T.leads)} delta={delta(T.leads, P.leads)} />
            <Stat label="Compras" value={int(T.purchases)} delta={delta(T.purchases, P.purchases)} />
            <Stat label="CPA" value={money(T.cpa, currency)} delta={T.cpa && P.cpa ? delta(T.cpa, P.cpa) : null} hint="Gasto / (conversaciones+leads+compras)" />
            <Stat label="ROAS" value={ratio(T.roas)} hint={T.roas ? undefined : "Sin valor de compra registrado"} />
          </div>
          <section className="card">
            <h2 className="mb-2 font-semibold text-white">Inversión diaria</h2>
            <Bars data={dayKeys.map((k) => byDay.get(k)!.spend)} labels={dayKeys} />
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="card overflow-x-auto">
              <h2 className="mb-2 font-semibold text-white">Por cliente</h2>
              <table className="w-full min-w-[420px]"><thead><tr><th className="th">Cliente</th><th className="th">Inversión</th><th className="th">Resultados</th><th className="th">CPA</th></tr></thead>
                <tbody className="divide-y divide-white/5">{[...byClient.values()].sort((a, b) => b.row.spend - a.row.spend).map((c) => { const t = totals(c.row); return <tr key={c.name}><td className="td">{c.name}</td><td className="td">{money(t.spend, currency)}</td><td className="td">{int(t.results)}</td><td className="td">{money(t.cpa, currency)}</td></tr>; })}</tbody></table>
            </section>
            <section className="card overflow-x-auto">
              <h2 className="mb-2 font-semibold text-white">Por cuenta publicitaria</h2>
              <table className="w-full min-w-[420px]"><thead><tr><th className="th">Cuenta</th><th className="th">Inversión</th><th className="th">CTR</th><th className="th">CPA</th></tr></thead>
                <tbody className="divide-y divide-white/5">{accounts.map((a) => { const t = totals(byAccount.get(a.id) ?? sumRows([])); return <tr key={a.id}><td className="td">{a.name}</td><td className="td">{money(t.spend, a.currency ?? "USD")}</td><td className="td">{pct(t.ctr)}</td><td className="td">{money(t.cpa, a.currency ?? "USD")}</td></tr>; })}</tbody></table>
            </section>
          </div>

          <section className="card overflow-x-auto">
            <h2 className="mb-2 font-semibold text-white">Top campañas por inversión</h2>
            <table className="w-full min-w-[560px]"><thead><tr><th className="th">Campaña</th><th className="th">Inversión</th><th className="th">CTR</th><th className="th">Resultados</th><th className="th">CPA</th></tr></thead>
              <tbody className="divide-y divide-white/5">{byCampaign.map((c) => <tr key={c.id}><td className="td">{c.name}</td><td className="td">{money(c.t.spend, currency)}</td><td className="td">{pct(c.t.ctr)}</td><td className="td">{int(c.t.results)}</td><td className="td">{money(c.t.cpa, currency)}</td></tr>)}</tbody></table>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="card"><h2 className="mb-2 font-semibold text-emerald-300">Anuncios ganadores</h2>
              {winners.length === 0 ? <p className="text-sm text-zinc-400">Aún no hay suficientes datos para declarar ganadores.</p> : <ul className="space-y-1 text-sm">{winners.slice(0, 5).map((w) => <li key={w.adId} className="flex justify-between gap-2"><span className="truncate">{w.name}</span><span className="text-zinc-400">CPA {money(w.t.cpa, currency)}</span></li>)}</ul>}</section>
            <section className="card"><h2 className="mb-2 font-semibold text-red-300">Anuncios perdedores</h2>
              {losers.length === 0 ? <p className="text-sm text-zinc-400">Ninguno detectado.</p> : <ul className="space-y-1 text-sm">{losers.slice(0, 5).map((w) => <li key={w.adId} className="flex justify-between gap-2"><span className="truncate">{w.name}</span><span className="text-zinc-400">CPA {money(w.t.cpa, currency)}</span></li>)}</ul>}</section>
          </div>
        </>
      )}

      <section className="card space-y-2">
        <div className="flex items-center justify-between"><h2 className="font-semibold text-white">Alertas y oportunidades</h2>
          {pendingProposals > 0 && <Link href="/automations" className="btn">{pendingProposals} propuesta(s) por aprobar</Link>}</div>
        {alerts.length === 0 ? <Empty>Sin alertas. Se generan al evaluar las reglas en Automatizaciones o con la tarea diaria.</Empty> : alerts.map((a) => (
          <div key={a.id} className="flex items-start justify-between gap-3 rounded-xl border border-white/5 p-3 text-sm">
            <div><span className={`badge ${a.kind === "opportunity" ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"}`}>{a.kind === "opportunity" ? "oportunidad" : "alerta"}</span> <span className="font-medium text-white">{a.title}</span><div className="text-xs text-zinc-400">{a.detail}</div></div>
            <form action={resolve}><input type="hidden" name="id" value={a.id} /><button className="btn-ghost !py-1 text-xs">Resolver</button></form>
          </div>
        ))}
      </section>
    </div>
  );
}
