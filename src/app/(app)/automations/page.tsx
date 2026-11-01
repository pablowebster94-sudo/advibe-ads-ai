import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { back, num, str, writer } from "@/lib/actions-util";
import { RULE_TYPES, RuleType, evaluateRules } from "@/lib/automation/rules";
import { decideProposal } from "@/lib/automation/execute";
import { Empty, Notice, PageHeader, StatusBadge } from "@/components/ui";

async function createRule(f: FormData) {
  "use server";
  const s = await writer();
  const type = str(f, "type") as RuleType;
  if (!(type in RULE_TYPES)) back("/automations", "error", "Tipo inválido.");
  const params = { days: num(f, "days") ?? 7, minSpend: num(f, "minSpend") ?? 10, targetCpa: num(f, "targetCpa") ?? undefined, cpaMultiplier: num(f, "cpaMultiplier") ?? 1.5, scalePct: num(f, "scalePct") ?? 20, maxDaily: num(f, "maxDaily") ?? undefined };
  const r = await db.automationRule.create({ data: { orgId: s.orgId, name: str(f, "name") || RULE_TYPES[type], type, action: str(f, "action") || "ALERT", params } });
  await audit(s, "rule.create", r.id, { type, params });
  back("/automations", "ok", "Regla creada.");
}

async function toggle(f: FormData) {
  "use server";
  const s = await writer();
  const r = await db.automationRule.findFirst({ where: { id: str(f, "id"), orgId: s.orgId } });
  if (r) await db.automationRule.update({ where: { id: r.id }, data: { enabled: !r.enabled } });
  back("/automations", "ok", "Regla actualizada.");
}

async function delRule(f: FormData) {
  "use server";
  const s = await writer();
  await db.automationRule.deleteMany({ where: { id: str(f, "id"), orgId: s.orgId } });
  back("/automations", "ok", "Regla eliminada.");
}

async function evaluate() {
  "use server";
  const s = await writer();
  let msg = "";
  let n = 0;
  try {
    n = (await evaluateRules(s.orgId)).created;
    await audit(s, "rules.evaluate", undefined, { created: n });
  } catch (e: any) {
    msg = e.message;
  }
  if (msg) back("/automations", "error", msg);
  back("/automations", "ok", `Evaluación completa (solo simulación): ${n} alerta(s)/propuesta(s) nuevas. Nada se ejecutó.`);
}

async function decide(f: FormData) {
  "use server";
  const s = await writer();
  const approve = f.get("decision") === "approve";
  let msg = "";
  try {
    await decideProposal(s, str(f, "id"), approve);
  } catch (e: any) {
    msg = e.message;
  }
  if (msg) back("/automations", "error", msg);
  back("/automations", "ok", approve ? "Aprobada y ejecutada en Meta." : "Propuesta rechazada.");
}

export default async function AutomationsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const s = await requireSession();
  const sp = await searchParams;
  const rules = await db.automationRule.findMany({ where: { orgId: s.orgId }, orderBy: { createdAt: "desc" } });
  const accs = await db.metaAdAccount.findMany({ where: { connection: { orgId: s.orgId } }, select: { id: true } });
  const proposals = await db.automationProposal.findMany({ where: { adAccountId: { in: accs.map((a) => a.id) } }, orderBy: { createdAt: "desc" }, take: 40 });
  return (
    <div className="space-y-6">
      <PageHeader title="Automatizaciones" subtitle="Las reglas solo detectan y proponen. Cualquier cambio que afecte el gasto muestra su simulación y requiere tu aprobación. Nunca se activa un anuncio automáticamente.">
        <form action={evaluate}><button className="btn">Evaluar reglas ahora (simulación)</button></form>
      </PageHeader>
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      {sp.ok && <Notice kind="ok">{sp.ok}</Notice>}

      <section className="space-y-3">
        <h2 className="font-semibold text-white">Propuestas</h2>
        {proposals.length === 0 ? <Empty>Sin propuestas. Aparecen al evaluar reglas con datos sincronizados.</Empty> : proposals.map((p) => (
          <div key={p.id} className="card space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><span className="font-medium text-white">{p.action === "PAUSE" ? "Pausar" : "Cambiar presupuesto diario"}: {p.entityName}</span> <StatusBadge s={p.status} /></div>
              <div className="text-xs text-zinc-500">{p.createdAt.toLocaleString("es")}</div>
            </div>
            <div className="text-sm text-zinc-300">{p.reason}</div>
            <pre className="overflow-x-auto rounded-lg bg-black/30 p-2 text-xs text-zinc-400">Simulación: {JSON.stringify(p.simulation, null, 1)}</pre>
            {p.result && p.result !== "OK" && <div className="text-xs text-red-300">{p.result}</div>}
            {p.status === "PENDING" && (
              <form action={decide} className="flex gap-2">
                <input type="hidden" name="id" value={p.id} />
                <button name="decision" value="approve" className="btn">Aprobar y ejecutar</button>
                <button name="decision" value="reject" className="btn-ghost">Rechazar</button>
              </form>
            )}
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold text-white">Reglas</h2>
        <form action={createRule} className="card grid gap-3 sm:grid-cols-4">
          <div className="sm:col-span-2"><label className="label">Tipo</label><select name="type" className="input">{Object.entries(RULE_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <div className="sm:col-span-2"><label className="label">Nombre</label><input name="name" className="input" /></div>
          <div><label className="label">Ventana (días)</label><input name="days" type="number" min={1} max={30} defaultValue={7} className="input" /></div>
          <div><label className="label">Gasto mínimo</label><input name="minSpend" type="number" step="0.01" defaultValue={10} className="input" /></div>
          <div><label className="label">CPA objetivo</label><input name="targetCpa" type="number" step="0.01" className="input" /></div>
          <div><label className="label">Multiplicador CPA</label><input name="cpaMultiplier" type="number" step="0.1" defaultValue={1.5} className="input" /></div>
          <div><label className="label">% escalar</label><input name="scalePct" type="number" defaultValue={20} className="input" /></div>
          <div><label className="label">Tope diario</label><input name="maxDaily" type="number" step="0.01" className="input" /></div>
          <div className="sm:col-span-2"><label className="label">Acción</label><select name="action" className="input"><option value="ALERT">Solo alertar</option><option value="PROPOSE_PAUSE">Proponer pausar</option><option value="PROPOSE_BUDGET">Proponer cambio de presupuesto</option></select></div>
          <div><button className="btn">Crear regla</button></div>
        </form>
        {rules.map((r) => (
          <div key={r.id} className="card flex flex-wrap items-center justify-between gap-2 text-sm">
            <div><span className="font-medium text-white">{r.name}</span> <span className="text-xs text-zinc-400">{RULE_TYPES[r.type as RuleType]} · {r.action}</span> <StatusBadge s={r.enabled ? "ACTIVE" : "PAUSED"} />
              <div className="text-xs text-zinc-500">{JSON.stringify(r.params)}</div></div>
            <div className="flex gap-2">
              <form action={toggle}><input type="hidden" name="id" value={r.id} /><button className="btn-ghost">{r.enabled ? "Desactivar" : "Activar"}</button></form>
              <form action={delRule}><input type="hidden" name="id" value={r.id} /><button className="btn-danger">Eliminar</button></form>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
