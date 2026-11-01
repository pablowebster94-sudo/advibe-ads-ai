import Link from "next/link";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { back, num, str, writer } from "@/lib/actions-util";
import { buildStrategy, StrategyOutput } from "@/lib/ai/strategy";
import { Empty, Notice, PageHeader } from "@/components/ui";

export const maxDuration = 120;

const OBJECTIVES = [
  ["OUTCOME_ENGAGEMENT", "Interacción / mensajes"],
  ["OUTCOME_LEADS", "Clientes potenciales"],
  ["OUTCOME_SALES", "Ventas"],
  ["OUTCOME_TRAFFIC", "Tráfico"],
  ["OUTCOME_AWARENESS", "Reconocimiento"],
];

async function generate(f: FormData) {
  "use server";
  const s = await writer();
  const clientId = str(f, "clientId");
  let msg = "";
  try {
    await buildStrategy(s.orgId, clientId, str(f, "objective"), str(f, "brief"), num(f, "budget") ?? undefined);
    await audit(s, "strategy.generate", clientId);
  } catch (e: any) {
    msg = e.message;
  }
  if (msg) back(`/strategy?client=${clientId}`, "error", msg);
  back(`/strategy?client=${clientId}`, "ok", "Estrategia generada.");
}

async function toDraft(f: FormData) {
  "use server";
  const s = await writer();
  const st = await db.strategy.findFirst({ where: { id: str(f, "id"), client: { orgId: s.orgId } }, include: { client: true } });
  if (!st) back("/strategy", "error", "Estrategia no encontrada.");
  const c = st!.content as unknown as StrategyOutput;
  const budget = num(f, "budget") ?? 5;
  const adsets = (c.structure?.adsets || []).map((a) => ({
    name: a.name,
    dailyBudget: Number(((budget * (a.dailyBudgetPct || 100 / c.structure.adsets.length)) / 100).toFixed(2)),
    targeting: { countries: [], ageMin: Number(a.age?.match(/\d+/)?.[0]) || 18, ageMax: Number(a.age?.match(/\d+/g)?.[1]) || 65, interests: [] },
    notes: { audience: a.audience, geo: a.geo, interestTerms: a.interests, exclusions: a.exclusions, placements: a.placements },
    ads: [],
  }));
  const d = await db.campaignDraft.create({
    data: { clientId: st!.clientId, name: c.structure?.campaign || `${st!.client.name} · ${st!.objective}`, objective: st!.objective, dailyBudget: budget, adsets: adsets as any },
  });
  await audit(s, "draft.from_strategy", d.id);
  back(`/campaigns/${d.id}`, "ok", "Borrador creado. Valida intereses con Meta, elige cuenta y anuncios.");
}

export default async function StrategyPage({ searchParams }: { searchParams: Promise<{ client?: string; ok?: string; error?: string }> }) {
  const s = await requireSession();
  const sp = await searchParams;
  const clients = await db.client.findMany({ where: { orgId: s.orgId }, orderBy: { name: "asc" } });
  const client = clients.find((c) => c.id === sp.client) ?? null;
  const items = client ? await db.strategy.findMany({ where: { clientId: client.id }, orderBy: { createdAt: "desc" }, take: 10 }) : [];
  return (
    <div className="space-y-6">
      <PageHeader title="Estratega IA" subtitle="Propone estructura, presupuesto, segmentación y pruebas. Usa los datos reales sincronizados si existen; si no, lo indica. Los intereses se validan luego contra Meta." />
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      {sp.ok && <Notice kind="ok">{sp.ok}</Notice>}
      <form className="card flex flex-wrap items-end gap-3" method="get">
        <div className="min-w-[220px] flex-1"><label className="label">Cliente</label>
          <select name="client" defaultValue={client?.id ?? ""} className="input"><option value="">Selecciona…</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <button className="btn-ghost">Abrir</button>
      </form>
      {!client ? <Empty>Selecciona un cliente.</Empty> : (
        <>
          <form action={generate} className="card grid gap-3 sm:grid-cols-3">
            <input type="hidden" name="clientId" value={client.id} />
            <div><label className="label">Objetivo</label><select name="objective" className="input">{OBJECTIVES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
            <div><label className="label">Presupuesto total a repartir</label><input name="budget" type="number" step="0.01" className="input" /></div>
            <div className="sm:col-span-3"><label className="label">Brief (oferta, público, restricciones)</label><textarea name="brief" rows={3} className="input" required /></div>
            <div><button className="btn">Generar estrategia</button></div>
          </form>
          {items.length === 0 ? <Empty>Sin estrategias para este cliente.</Empty> : items.map((it) => {
            const c = it.content as unknown as StrategyOutput;
            return (
              <article key={it.id} className="card space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs text-zinc-400">{it.createdAt.toLocaleString("es")} · {it.provider} · {it.basedOnData ? "con datos reales de Meta" : "sin datos reales (basada en el brief)"}</div>
                  <form action={toDraft} className="flex items-center gap-2">
                    <input type="hidden" name="id" value={it.id} />
                    <input name="budget" type="number" step="0.01" min="1" placeholder="Presupuesto diario" className="input !w-40" required />
                    <button className="btn">Crear borrador</button>
                  </form>
                </div>
                <p className="text-sm text-white">{c.summary}</p>
                <div className="text-sm"><b className="text-zinc-300">Campaña:</b> {c.structure?.campaign}</div>
                <div className="grid gap-3 md:grid-cols-2">
                  {c.structure?.adsets?.map((a, i) => (
                    <div key={i} className="rounded-xl border border-white/5 p-3 text-sm">
                      <div className="font-medium text-white">{a.name} · {a.dailyBudgetPct}%</div>
                      <div className="text-zinc-400">{a.audience}</div>
                      <div className="mt-1 text-xs text-zinc-400">Geo: {a.geo} · Edad: {a.age}</div>
                      <div className="text-xs text-zinc-400">Intereses (a validar): {a.interests?.join(", ")}</div>
                      <div className="text-xs text-zinc-400">Exclusiones: {a.exclusions?.join(", ") || "—"} · {a.placements}</div>
                    </div>
                  ))}
                </div>
                <List title="Estrategia creativa" items={c.creativeStrategy} />
                <div>
                  <div className="text-sm font-medium text-zinc-300">Hipótesis y pruebas A/B</div>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-zinc-400">{c.hypotheses?.map((h, i) => <li key={i}>{h.hypothesis} — <i>{h.test}</i> (métrica: {h.metric})</li>)}</ul>
                </div>
                <List title="Riesgos" items={c.risks} />
                <List title="Datos que faltan" items={c.needsData} />
              </article>
            );
          })}
        </>
      )}
    </div>
  );
}

function List({ title, items }: { title: string; items?: string[] }) {
  if (!items?.length) return null;
  return (
    <div>
      <div className="text-sm font-medium text-zinc-300">{title}</div>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-zinc-400">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </div>
  );
}
