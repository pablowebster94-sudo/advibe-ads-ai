import Link from "next/link";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { back, str, num, writer } from "@/lib/actions-util";
import { Empty, Notice, PageHeader } from "@/components/ui";

async function createClient(f: FormData) {
  "use server";
  const s = await writer();
  const name = str(f, "name");
  if (!name) back("/clients", "error", "El nombre es obligatorio.");
  const c = await db.client.create({
    data: { orgId: s.orgId, name, industry: str(f, "industry") || null, website: str(f, "website") || null, monthlyBudget: num(f, "monthlyBudget") },
  });
  await audit(s, "client.create", c.id, { name });
  back(`/clients/${c.id}`, "ok", "Cliente creado. Completa su marca y recursos.");
}

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const s = await requireSession();
  const sp = await searchParams;
  const clients = await db.client.findMany({
    where: { orgId: s.orgId },
    orderBy: { name: "asc" },
    include: { _count: { select: { assets: true, creatives: true, drafts: true } }, links: true },
  });
  return (
    <div>
      <PageHeader title="Clientes" subtitle="Cada cliente tiene su marca, recursos, cuentas vinculadas y campañas separados." />
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      {sp.ok && <Notice kind="ok">{sp.ok}</Notice>}
      <form action={createClient} className="card mb-6 mt-4 grid gap-3 sm:grid-cols-4">
        <div className="sm:col-span-2">
          <label className="label">Nombre del cliente</label>
          <input name="name" className="input" required placeholder="Ej. Imperio Barber Studio" />
        </div>
        <div>
          <label className="label">Industria</label>
          <input name="industry" className="input" placeholder="Barbería" />
        </div>
        <div>
          <label className="label">Presupuesto mensual</label>
          <input name="monthlyBudget" type="number" step="0.01" min="0" className="input" />
        </div>
        <div className="sm:col-span-3">
          <label className="label">Sitio web</label>
          <input name="website" className="input" placeholder="https://" />
        </div>
        <div className="flex items-end">
          <button className="btn w-full">Crear cliente</button>
        </div>
      </form>
      {clients.length === 0 ? (
        <Empty>Aún no hay clientes. Crea el primero arriba.</Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {clients.map((c) => (
            <Link key={c.id} href={`/clients/${c.id}`} className="card block transition hover:border-brand-500/40">
              <div className="flex items-center gap-3">
                {c.logoAssetId ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/assets/${c.logoAssetId}`} alt="" className="h-10 w-10 rounded-lg bg-white/5 object-contain" />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-500/20 font-bold text-brand-400">{c.name[0]}</div>
                )}
                <div className="min-w-0">
                  <div className="truncate font-semibold text-white">{c.name}</div>
                  <div className="truncate text-xs text-zinc-400">{c.industry || "Sin industria"}</div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-zinc-400">
                <span>{c._count.assets} recursos</span>·<span>{c._count.creatives} creatividades</span>·<span>{c._count.drafts} campañas</span>·
                <span>{c.links.length} cuenta(s) Meta</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
