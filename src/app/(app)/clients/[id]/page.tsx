import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { back, num, str, writer } from "@/lib/actions-util";
import { money } from "@/lib/format";
import { Empty, Notice, PageHeader, StatusBadge } from "@/components/ui";

const MAX_BYTES = 8 * 1024 * 1024;

async function own(orgId: string, id: string) {
  const c = await db.client.findFirst({ where: { id, orgId } });
  if (!c) throw new Error("Cliente no encontrado.");
  return c;
}

async function saveBrand(f: FormData) {
  "use server";
  const s = await writer();
  const id = str(f, "id");
  await own(s.orgId, id);
  const list = (k: string) => str(f, k).split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
  await db.client.update({
    where: { id },
    data: {
      name: str(f, "name") || undefined,
      industry: str(f, "industry") || null,
      website: str(f, "website") || null,
      description: str(f, "description") || null,
      voice: str(f, "voice") || null,
      goals: str(f, "goals") || null,
      fontHeading: str(f, "fontHeading") || null,
      fontBody: str(f, "fontBody") || null,
      brandColors: list("brandColors"),
      locations: list("locations"),
      whatsapp: str(f, "whatsapp").replace(/[^\d]/g, "") || null,
      monthlyBudget: num(f, "monthlyBudget"),
      currency: str(f, "currency") || "USD",
    },
  });
  await audit(s, "client.update", id);
  back(`/clients/${id}`, "ok", "Cliente actualizado.");
}

async function addProduct(f: FormData) {
  "use server";
  const s = await writer();
  const clientId = str(f, "id");
  await own(s.orgId, clientId);
  if (!str(f, "name")) back(`/clients/${clientId}`, "error", "El nombre es obligatorio.");
  await db.product.create({
    data: { clientId, kind: str(f, "kind") || "producto", name: str(f, "name"), description: str(f, "description") || null, price: num(f, "price"), offer: str(f, "offer") || null, url: str(f, "url") || null },
  });
  back(`/clients/${clientId}`, "ok", "Agregado.");
}

async function delProduct(f: FormData) {
  "use server";
  const s = await writer();
  const clientId = str(f, "id");
  await own(s.orgId, clientId);
  await db.product.deleteMany({ where: { id: str(f, "productId"), clientId } });
  back(`/clients/${clientId}`, "ok", "Eliminado.");
}

async function uploadAsset(f: FormData) {
  "use server";
  const s = await writer();
  const clientId = str(f, "id");
  await own(s.orgId, clientId);
  const file = f.get("file");
  if (!(file instanceof File) || !file.size) back(`/clients/${clientId}`, "error", "Selecciona un archivo.");
  const file2 = file as File;
  if (!/^image\/(png|jpeg|webp)$/.test(file2.type)) back(`/clients/${clientId}`, "error", "Solo PNG, JPG o WEBP.");
  if (file2.size > MAX_BYTES) back(`/clients/${clientId}`, "error", "Máximo 8 MB.");
  const kind = str(f, "kind") === "logo" ? "logo" : "original";
  const a = await db.asset.create({
    data: { clientId, kind, name: file2.name, mimeType: file2.type, data: Buffer.from(await file2.arrayBuffer()) },
  });
  if (kind === "logo") await db.client.update({ where: { id: clientId }, data: { logoAssetId: a.id } });
  await audit(s, "asset.upload", a.id, { kind, name: file2.name });
  back(`/clients/${clientId}`, "ok", "Recurso cargado.");
}

async function delAsset(f: FormData) {
  "use server";
  const s = await writer();
  const clientId = str(f, "id");
  await own(s.orgId, clientId);
  const assetId = str(f, "assetId");
  await db.asset.deleteMany({ where: { id: assetId, clientId } });
  await db.client.updateMany({ where: { id: clientId, logoAssetId: assetId }, data: { logoAssetId: null } });
  await audit(s, "asset.delete", assetId);
  back(`/clients/${clientId}`, "ok", "Recurso eliminado.");
}

async function linkAccount(f: FormData) {
  "use server";
  const s = await writer();
  const clientId = str(f, "id");
  await own(s.orgId, clientId);
  const adAccountId = str(f, "adAccountId");
  const acc = await db.metaAdAccount.findFirst({ where: { id: adAccountId, connection: { orgId: s.orgId } } });
  if (!acc) back(`/clients/${clientId}`, "error", "Cuenta no válida.");
  // solo se aceptan activos verificados por la API
  const pageId = str(f, "pageId") || null;
  const igAccountId = str(f, "igAccountId") || null;
  const pixelId = str(f, "pixelId") || null;
  const pages = ((acc!.pages as any[]) || []).map((p) => p.id);
  const igs = [...((acc!.igAccounts as any[]) || []).map((p) => p.id), ...((acc!.pages as any[]) || []).map((p) => p.igId).filter(Boolean)];
  const pixels = ((acc!.pixels as any[]) || []).map((p) => p.id);
  if (pageId && !pages.includes(pageId)) back(`/clients/${clientId}`, "error", "Esa página no está verificada para la cuenta.");
  if (igAccountId && !igs.includes(igAccountId)) back(`/clients/${clientId}`, "error", "Ese Instagram no está verificado para la cuenta.");
  if (pixelId && !pixels.includes(pixelId)) back(`/clients/${clientId}`, "error", "Ese pixel no está verificado para la cuenta.");
  await db.clientMetaLink.upsert({
    where: { clientId_adAccountId: { clientId, adAccountId } },
    update: { pageId, igAccountId, pixelId },
    create: { clientId, adAccountId, pageId, igAccountId, pixelId },
  });
  await audit(s, "client.link", clientId, { adAccountId, pageId, igAccountId, pixelId });
  back(`/clients/${clientId}`, "ok", "Cuenta vinculada.");
}

async function unlink(f: FormData) {
  "use server";
  const s = await writer();
  const clientId = str(f, "id");
  await own(s.orgId, clientId);
  await db.clientMetaLink.deleteMany({ where: { id: str(f, "linkId"), clientId } });
  back(`/clients/${clientId}`, "ok", "Vínculo eliminado.");
}

async function assignCampaigns(f: FormData) {
  "use server";
  const s = await writer();
  const clientId = str(f, "id");
  await own(s.orgId, clientId);
  const links = await db.clientMetaLink.findMany({ where: { clientId } });
  const accIds = links.map((l) => l.adAccountId);
  const picked = new Set(f.getAll("camp").map(String));
  const camps = await db.metaEntity.findMany({ where: { adAccountId: { in: accIds }, level: "campaign" } });
  let n = 0;
  for (const c of camps) {
    const on = picked.has(c.id);
    if (on && (c.clientId == null || c.clientId === clientId)) {
      if (c.clientId !== clientId) { await db.metaEntity.update({ where: { id: c.id }, data: { clientId } }); n++; }
    } else if (!on && c.clientId === clientId) {
      await db.metaEntity.update({ where: { id: c.id }, data: { clientId: null } });
    }
  }
  await audit(s, "client.assign_campaigns", clientId, { assigned: picked.size });
  back(`/clients/${clientId}`, "ok", "Campañas actualizadas.");
}

async function deleteClient(f: FormData) {
  "use server";
  const s = await writer();
  const id = str(f, "id");
  const c = await own(s.orgId, id);
  if (str(f, "confirm") !== c.name) back(`/clients/${id}`, "error", "Escribe el nombre exacto para confirmar.");
  await db.client.delete({ where: { id } });
  await audit(s, "client.delete", id, { name: c.name });
  back("/clients", "ok", "Cliente eliminado.");
}

export default async function ClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const s = await requireSession();
  const { id } = await params;
  const sp = await searchParams;
  const c = await db.client.findFirst({
    where: { id, orgId: s.orgId },
    include: {
      products: { orderBy: { createdAt: "desc" } },
      assets: { where: { kind: { in: ["logo", "original"] } }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, kind: true } },
      links: { include: { adAccount: true } },
      drafts: { orderBy: { createdAt: "desc" }, take: 10 },
      creatives: { orderBy: { createdAt: "desc" }, take: 8 },
    },
  });
  if (!c) notFound();
  const accounts = await db.metaAdAccount.findMany({ where: { connection: { orgId: s.orgId } }, orderBy: { name: "asc" } });
  const linkedIds = c.links.map((l) => l.adAccountId);
  const campaigns = linkedIds.length ? await db.metaEntity.findMany({ where: { adAccountId: { in: linkedIds }, level: "campaign" }, include: { adAccount: true }, orderBy: { name: "asc" } }) : [];
  const otherClients = new Map((await db.client.findMany({ where: { orgId: s.orgId }, select: { id: true, name: true } })).map((x) => [x.id, x.name]));

  return (
    <div className="space-y-6">
      <PageHeader title={c.name} subtitle={c.industry || "Cliente"}>
        <Link href={`/creative?client=${c.id}`} className="btn-ghost">Creative Studio</Link>
        <Link href={`/strategy?client=${c.id}`} className="btn-ghost">Estrategia</Link>
        <Link href={`/campaigns?client=${c.id}`} className="btn-ghost">Campañas</Link>
      </PageHeader>
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      {sp.ok && <Notice kind="ok">{sp.ok}</Notice>}

      <form action={saveBrand} className="card grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="id" value={c.id} />
        <h2 className="sm:col-span-2 font-semibold text-white">Marca y objetivos</h2>
        <div><label className="label">Nombre</label><input name="name" defaultValue={c.name} className="input" required /></div>
        <div><label className="label">Industria</label><input name="industry" defaultValue={c.industry ?? ""} className="input" /></div>
        <div><label className="label">Sitio web</label><input name="website" defaultValue={c.website ?? ""} className="input" /></div>
        <div><label className="label">WhatsApp (solo dígitos con país)</label><input name="whatsapp" defaultValue={c.whatsapp ?? ""} className="input" placeholder="593999999999" /></div>
        <div><label className="label">Colores de marca (HEX, separados por coma)</label><input name="brandColors" defaultValue={c.brandColors.join(", ")} className="input" placeholder="#111111, #d4af37" /></div>
        <div><label className="label">Ubicaciones</label><input name="locations" defaultValue={c.locations.join(", ")} className="input" placeholder="Cuenca, Gualaceo" /></div>
        <div><label className="label">Tipografía títulos</label><input name="fontHeading" defaultValue={c.fontHeading ?? ""} className="input" /></div>
        <div><label className="label">Tipografía texto</label><input name="fontBody" defaultValue={c.fontBody ?? ""} className="input" /></div>
        <div><label className="label">Presupuesto mensual</label><input name="monthlyBudget" type="number" step="0.01" defaultValue={c.monthlyBudget ?? ""} className="input" /></div>
        <div><label className="label">Moneda</label><input name="currency" defaultValue={c.currency} className="input" maxLength={3} /></div>
        <div className="sm:col-span-2"><label className="label">Descripción del negocio</label><textarea name="description" defaultValue={c.description ?? ""} rows={2} className="input" /></div>
        <div><label className="label">Voz / tono</label><textarea name="voice" defaultValue={c.voice ?? ""} rows={2} className="input" /></div>
        <div><label className="label">Objetivos comerciales</label><textarea name="goals" defaultValue={c.goals ?? ""} rows={2} className="input" /></div>
        <div className="sm:col-span-2"><button className="btn">Guardar</button></div>
      </form>

      <section className="card space-y-3">
        <h2 className="font-semibold text-white">Biblioteca de recursos</h2>
        <form action={uploadAsset} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="id" value={c.id} />
          <div><label className="label">Tipo</label>
            <select name="kind" className="input"><option value="original">Foto original</option><option value="logo">Logotipo</option></select></div>
          <div className="min-w-0 flex-1"><label className="label">Imagen (PNG/JPG/WEBP, máx. 8 MB)</label><input type="file" name="file" accept="image/png,image/jpeg,image/webp" className="input" required /></div>
          <button className="btn">Subir</button>
        </form>
        {c.assets.length === 0 ? (
          <Empty>Sin recursos. Sube el logotipo y fotos originales de productos.</Empty>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {c.assets.map((a) => (
              <div key={a.id} className="rounded-xl border border-white/5 p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/assets/${a.id}`} alt={a.name} className="aspect-square w-full rounded-lg bg-white/5 object-contain" />
                <div className="mt-1 truncate text-xs text-zinc-400">{a.kind === "logo" ? "Logo · " : ""}{a.name}</div>
                <form action={delAsset}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="assetId" value={a.id} />
                  <button className="mt-1 text-xs text-red-300 hover:underline">Eliminar</button></form>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold text-white">Productos, servicios y ofertas</h2>
        <form action={addProduct} className="grid gap-3 sm:grid-cols-6">
          <input type="hidden" name="id" value={c.id} />
          <div><label className="label">Tipo</label><select name="kind" className="input"><option>producto</option><option>servicio</option><option>oferta</option></select></div>
          <div className="sm:col-span-2"><label className="label">Nombre</label><input name="name" className="input" required /></div>
          <div><label className="label">Precio</label><input name="price" type="number" step="0.01" className="input" /></div>
          <div className="sm:col-span-2"><label className="label">Oferta</label><input name="offer" className="input" placeholder="2x1 hasta el domingo" /></div>
          <div className="sm:col-span-3"><label className="label">Descripción</label><input name="description" className="input" /></div>
          <div className="sm:col-span-2"><label className="label">URL</label><input name="url" className="input" /></div>
          <div className="flex items-end"><button className="btn w-full">Agregar</button></div>
        </form>
        {c.products.length === 0 ? <Empty>Sin productos ni ofertas registrados.</Empty> : (
          <ul className="divide-y divide-white/5">
            {c.products.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="min-w-0"><span className="badge bg-white/10 text-zinc-300">{p.kind}</span> <span className="font-medium text-white">{p.name}</span>
                  <span className="text-zinc-400"> {p.price != null ? money(p.price, c.currency) : ""} {p.offer ? `· ${p.offer}` : ""}</span></div>
                <form action={delProduct}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="productId" value={p.id} /><button className="text-xs text-red-300 hover:underline">Quitar</button></form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold text-white">Cuentas de Meta vinculadas</h2>
        <p className="text-sm text-zinc-400">Solo se pueden elegir páginas, Instagram y pixel que Meta confirmó como disponibles para la cuenta (Conexiones → Verificar activos).</p>
        {accounts.length === 0 ? (
          <Empty>No hay cuentas publicitarias. <Link href="/connections" className="text-brand-400 underline">Conecta Meta</Link> primero.</Empty>
        ) : (
          <form action={linkAccount} className="grid gap-3 sm:grid-cols-5">
            <input type="hidden" name="id" value={c.id} />
            <div className="sm:col-span-2"><label className="label">Cuenta publicitaria</label>
              <select name="adAccountId" className="input" required>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.actId}){a.assetsCheckedAt ? "" : " · sin verificar"}</option>)}</select></div>
            <div><label className="label">Página (ID)</label><input name="pageId" className="input" placeholder="ID verificado" /></div>
            <div><label className="label">Instagram (ID)</label><input name="igAccountId" className="input" /></div>
            <div><label className="label">Pixel (ID)</label><input name="pixelId" className="input" /></div>
            <div className="sm:col-span-5 text-xs text-zinc-500">Los IDs disponibles se listan en la página de Conexiones.</div>
            <div><button className="btn">Vincular</button></div>
          </form>
        )}
        {c.links.map((l) => (
          <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/5 p-3 text-sm">
            <div><span className="font-medium text-white">{l.adAccount.name}</span> <span className="text-zinc-400">página {l.pageId ?? "—"} · IG {l.igAccountId ?? "—"} · pixel {l.pixelId ?? "—"}</span></div>
            <form action={unlink}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="linkId" value={l.id} /><button className="text-xs text-red-300 hover:underline">Desvincular</button></form>
          </div>
        ))}
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold text-white">Campañas de este cliente</h2>
        <p className="text-sm text-zinc-400">Si varios clientes usan la misma cuenta publicitaria, marca aquí cuáles campañas son de este cliente. Con eso Analítica, informes y Dashboard separan los resultados por cliente. Las campañas sin asignar no se atribuyen a nadie.</p>
        {c.links.length === 0 ? <Empty>Primero vincula una cuenta publicitaria.</Empty> : campaigns.length === 0 ? <Empty>No hay campañas sincronizadas. Sincroniza la cuenta en Conexiones.</Empty> : (
          <form action={assignCampaigns} className="space-y-2">
            <input type="hidden" name="id" value={c.id} />
            <ul className="divide-y divide-white/5">
              {campaigns.map((k) => {
                const other = k.clientId && k.clientId !== c.id ? otherClients.get(k.clientId) : null;
                return (
                  <li key={k.id} className="flex items-center gap-3 py-2 text-sm">
                    <input type="checkbox" name="camp" value={k.id} defaultChecked={k.clientId === c.id} disabled={!!other} />
                    <span className="min-w-0 flex-1 truncate text-white">{k.name}</span>
                    <span className="text-xs text-zinc-500">{k.adAccount.name}{other ? ` · asignada a ${other}` : ""}</span>
                  </li>
                );
              })}
            </ul>
            <button className="btn">Guardar campañas</button>
          </form>
        )}
      </section>

      <section className="card space-y-2">
        <h2 className="font-semibold text-white">Historial de campañas</h2>
        {c.drafts.length === 0 ? <Empty>Sin campañas todavía.</Empty> : c.drafts.map((d) => (
          <div key={d.id} className="flex items-center justify-between text-sm">
            <Link href={`/campaigns/${d.id}`} className="text-brand-400 hover:underline">{d.name}</Link>
            <StatusBadge s={d.status} />
          </div>
        ))}
        <p className="text-xs text-zinc-500">Los resultados reales por campaña están en Analítica una vez sincronizada la cuenta.</p>
      </section>

      <form action={deleteClient} className="card flex flex-wrap items-end gap-3 border-red-500/20">
        <input type="hidden" name="id" value={c.id} />
        <div className="min-w-0 flex-1"><label className="label">Eliminar cliente (borra sus recursos y borradores). Escribe: {c.name}</label><input name="confirm" className="input" /></div>
        <button className="btn-danger">Eliminar</button>
      </form>
    </div>
  );
}
