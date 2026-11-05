import Link from "next/link";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { back, num, str, writer } from "@/lib/actions-util";
import { money } from "@/lib/format";
import { Empty, Notice, PageHeader, StatusBadge } from "@/components/ui";

async function create(f: FormData) {
  "use server";
  const s = await writer();
  const clientId = str(f, "clientId");
  const c = await db.client.findFirst({ where: { id: clientId, orgId: s.orgId }, include: { links: true } });
  if (!c) back("/campaigns", "error", "Elige un cliente.");
  const name = str(f, "name");
  if (!name) back("/campaigns", "error", "Pon un nombre a la campaña.");
  const link = c!.links.length === 1 ? c!.links[0] : null;
  const d = await db.campaignDraft.create({
    data: {
      clientId, name, objective: str(f, "destination") === "FORM" ? "OUTCOME_LEADS" : str(f, "objective") || "OUTCOME_ENGAGEMENT", destination: str(f, "destination") || "WHATSAPP",
      dailyBudget: num(f, "dailyBudget") ?? 5,
      adAccountId: link?.adAccountId, pageId: link?.pageId, igAccountId: link?.igAccountId, pixelId: link?.pixelId,
    },
  });
  await audit(s, "draft.create", d.id, { name });
  back(`/campaigns/${d.id}`, "ok", "Borrador creado.");
}

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<{ client?: string; ok?: string; error?: string }> }) {
  const s = await requireSession();
  const sp = await searchParams;
  const clients = await db.client.findMany({ where: { orgId: s.orgId }, orderBy: { name: "asc" } });
  const drafts = await db.campaignDraft.findMany({ where: { client: { orgId: s.orgId } }, orderBy: { updatedAt: "desc" }, include: { client: true } });
  return (
    <div className="space-y-6">
      <PageHeader title="Campaign Builder" subtitle="Crea, revisa y publica campañas por la Marketing API. Todo se crea en PAUSA; activar es una decisión tuya dentro de Meta." />
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      {sp.ok && <Notice kind="ok">{sp.ok}</Notice>}
      <form action={create} className="card grid gap-3 sm:grid-cols-6">
        <div className="sm:col-span-2"><label className="label">Cliente</label><select name="clientId" defaultValue={sp.client} className="input" required>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="sm:col-span-2"><label className="label">Nombre</label><input name="name" className="input" required /></div>
        <div><label className="label">Objetivo</label><select name="objective" className="input"><option value="OUTCOME_ENGAGEMENT">Interacción/mensajes</option><option value="OUTCOME_LEADS">Leads</option><option value="OUTCOME_SALES">Ventas</option><option value="OUTCOME_TRAFFIC">Tráfico</option><option value="OUTCOME_AWARENESS">Reconocimiento</option></select></div>
        <div><label className="label">Destino</label><select name="destination" className="input"><option value="WHATSAPP">WhatsApp</option><option value="MESSENGER">Messenger</option><option value="INSTAGRAM_DM">Instagram DM</option><option value="WEBSITE">Sitio web</option><option value="FORM">Formulario instantáneo</option></select></div>
        <div><label className="label">Presupuesto diario</label><input name="dailyBudget" type="number" step="0.01" min="1" defaultValue={5} className="input" /></div>
        <div className="flex items-end"><button className="btn w-full" disabled={clients.length === 0}>Crear borrador</button></div>
      </form>
      {drafts.length === 0 ? <Empty>Sin campañas. Crea un borrador arriba o parte de una estrategia.</Empty> : (
        <div className="card overflow-x-auto !p-0">
          <table className="w-full min-w-[620px]">
            <thead><tr><th className="th">Campaña</th><th className="th">Cliente</th><th className="th">Objetivo</th><th className="th">Presup./día</th><th className="th">Estado</th></tr></thead>
            <tbody className="divide-y divide-white/5">
              {drafts.map((d) => (
                <tr key={d.id}>
                  <td className="td"><Link href={`/campaigns/${d.id}`} className="font-medium text-brand-400 hover:underline">{d.name}</Link></td>
                  <td className="td">{d.client.name}</td>
                  <td className="td text-zinc-400">{d.objective.replace("OUTCOME_", "")} · {d.destination}</td>
                  <td className="td">{money(d.dailyBudget, d.client.currency)}</td>
                  <td className="td"><StatusBadge s={d.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
