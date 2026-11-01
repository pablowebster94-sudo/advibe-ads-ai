import Link from "next/link";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { back, str, writer } from "@/lib/actions-util";
import { composeCreative, FORMATS } from "@/lib/creative/compose";
import { backgroundPrompt, scenePrompt } from "@/lib/creative/prompts";
import { generateImage } from "@/lib/ai/providers";
import { generateCopy } from "@/lib/ai/copy";
import { Empty, Notice, PageHeader, Pending } from "@/components/ui";

export const maxDuration = 120;

const CTAS = ["LEARN_MORE", "SHOP_NOW", "CONTACT_US", "WHATSAPP_MESSAGE", "SEND_MESSAGE", "GET_QUOTE", "SIGN_UP", "BOOK_TRAVEL"];

async function create(f: FormData) {
  "use server";
  const s = await writer();
  const clientId = str(f, "clientId");
  const path = `/creative?client=${clientId}`;
  const client = await db.client.findFirst({ where: { id: clientId, orgId: s.orgId } });
  if (!client) back("/creative", "error", "Cliente no encontrado.");
  const mode = str(f, "mode") as "original" | "ai_scene" | "ai_background";
  const formats = f.getAll("formats").map(String).filter((x) => x in FORMATS);
  if (!formats.length) back(path, "error", "Elige al menos un formato.");
  const productAssetId = str(f, "productAssetId");
  const product = productAssetId ? await db.asset.findFirst({ where: { id: productAssetId, clientId } }) : null;
  if (!product) back(path, "error", "Elige la foto original del producto (súbela en el cliente).");
  const logo = client!.logoAssetId ? await db.asset.findFirst({ where: { id: client!.logoAssetId, clientId } }) : null;
  const colors = client!.brandColors;
  const palette = { primary: colors[0] || "#111827", secondary: colors[1] || colors[0] || "#374151", text: colors[2] || "#ffffff" };
  const title = str(f, "title");
  const price = str(f, "price");
  const cta = str(f, "ctaText");
  const badges = str(f, "badges").split(",").map((b) => b.trim()).filter(Boolean).slice(0, 2);
  const scene = str(f, "scene") || "estudio elegante, luz suave";
  const variations = Math.min(Math.max(Number(str(f, "variations")) || 1, 1), 3);
  const group = `g_${Date.now()}`;
  let error = "";
  let made = 0;
  try {
    for (let v = 0; v < variations; v++) {
      for (const fmt of formats) {
        let background: { data: Buffer; mime: string } | undefined;
        let fullScene = false;
        let usedPrompt = "";
        let provider: string | undefined;
        if (mode === "ai_background") {
          usedPrompt = backgroundPrompt({ scene, format: fmt, colors });
          const img = await generateImage(s.orgId, usedPrompt, [], fmt);
          background = { data: img.data, mime: img.mimeType };
          provider = img.provider;
        } else if (mode === "ai_scene") {
          usedPrompt = scenePrompt({ scene, format: fmt, brand: client!.name });
          const img = await generateImage(s.orgId, usedPrompt, [{ data: Buffer.from(product!.data), mimeType: product!.mimeType }], fmt);
          background = { data: img.data, mime: img.mimeType };
          fullScene = true;
          provider = img.provider;
        }
        const png = await composeCreative({
          format: fmt,
          product: { data: Buffer.from(product!.data), mime: product!.mimeType },
          background,
          fullScene,
          logo: logo ? { data: Buffer.from(logo.data), mime: logo.mimeType } : undefined,
          title,
          price,
          badges,
          cta,
          colors: palette,
        });
        const asset = await db.asset.create({
          data: { clientId, kind: "generated", name: `${title || "anuncio"}-${fmt.replace(":", "x")}.png`, mimeType: "image/png", data: new Uint8Array(png) },
        });
        await db.creative.create({
          data: {
            clientId, title: title || "Sin título", format: fmt, mode, assetId: asset.id, sourceAssetId: product!.id,
            headline: title || null, price: price || null, badges, cta: str(f, "adCta") || null,
            prompt: usedPrompt || null, provider, variantGroup: group,
            // el modo original no altera el producto; la IA de escena exige revisión humana
            reviewed: mode !== "ai_scene",
          },
        });
        made++;
      }
    }
    await audit(s, "creative.generate", clientId, { mode, formats, variations, made });
  } catch (e: any) {
    error = e.message;
  }
  if (error) back(path, "error", made ? `Se crearon ${made}; luego falló: ${error}` : error);
  back(path, "ok", `${made} creatividad(es) generada(s).`);
}

async function review(f: FormData) {
  "use server";
  const s = await writer();
  const id = str(f, "id");
  const c = await db.creative.findFirst({ where: { id, client: { orgId: s.orgId } } });
  if (!c) back("/creative", "error", "No encontrada.");
  await db.creative.update({ where: { id }, data: { reviewed: f.get("approved") === "1" } });
  await audit(s, "creative.review", id, { approved: f.get("approved") === "1" });
  back(`/creative?client=${c!.clientId}`, "ok", "Revisión de fidelidad guardada.");
}

async function saveCopy(f: FormData) {
  "use server";
  const s = await writer();
  const id = str(f, "id");
  const c = await db.creative.findFirst({ where: { id, client: { orgId: s.orgId } } });
  if (!c) back("/creative", "error", "No encontrada.");
  await db.creative.update({ where: { id }, data: { headline: str(f, "headline") || null, primaryText: str(f, "primaryText") || null, description: str(f, "description") || null, cta: str(f, "cta") || null } });
  back(`/creative?client=${c!.clientId}`, "ok", "Copy guardado.");
}

async function abCopies(f: FormData) {
  "use server";
  const s = await writer();
  const id = str(f, "id");
  const c = await db.creative.findFirst({ where: { id, client: { orgId: s.orgId } } });
  if (!c) back("/creative", "error", "No encontrada.");
  let msg = "";
  try {
    const variants = await generateCopy(s.orgId, c!.clientId, c!.title + (c!.price ? ` (${c!.price})` : ""), str(f, "angle") || "beneficio principal", 3);
    const group = `ab_${Date.now()}`;
    for (const v of variants) {
      await db.creative.create({
        data: { clientId: c!.clientId, title: c!.title, format: c!.format, mode: c!.mode, assetId: c!.assetId, sourceAssetId: c!.sourceAssetId, headline: v.headline, primaryText: v.primaryText, description: v.description, cta: v.cta, price: c!.price, badges: c!.badges, provider: c!.provider, reviewed: c!.reviewed, variantGroup: group },
      });
    }
    await audit(s, "creative.copies", id, { n: variants.length });
  } catch (e: any) {
    msg = e.message;
  }
  if (msg) back(`/creative?client=${c!.clientId}`, "error", msg);
  back(`/creative?client=${c!.clientId}`, "ok", "Variantes A/B de copy creadas.");
}

async function del(f: FormData) {
  "use server";
  const s = await writer();
  const id = str(f, "id");
  const c = await db.creative.findFirst({ where: { id, client: { orgId: s.orgId } } });
  if (!c) back("/creative", "error", "No encontrada.");
  await db.creative.delete({ where: { id } });
  const still = c!.assetId ? await db.creative.count({ where: { assetId: c!.assetId } }) : 1;
  if (!still && c!.assetId) await db.asset.deleteMany({ where: { id: c!.assetId } });
  back(`/creative?client=${c!.clientId}`, "ok", "Eliminada.");
}

export default async function CreativePage({ searchParams }: { searchParams: Promise<{ client?: string; ok?: string; error?: string }> }) {
  const s = await requireSession();
  const sp = await searchParams;
  const clients = await db.client.findMany({ where: { orgId: s.orgId }, orderBy: { name: "asc" } });
  const client = clients.find((c) => c.id === sp.client) ?? null;
  const originals = client ? await db.asset.findMany({ where: { clientId: client.id, kind: "original" }, select: { id: true, name: true } }) : [];
  const creatives = client ? await db.creative.findMany({ where: { clientId: client.id }, orderBy: { createdAt: "desc" }, take: 60 }) : [];

  return (
    <div className="space-y-6">
      <PageHeader title="Creative Studio" subtitle="El producto real nunca se redibuja: la IA crea el escenario y el código coloca logo, título, precio y CTA." />
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      {sp.ok && <Notice kind="ok">{sp.ok}</Notice>}
      <form className="card flex flex-wrap items-end gap-3" method="get">
        <div className="min-w-[220px] flex-1"><label className="label">Cliente</label>
          <select name="client" defaultValue={client?.id ?? ""} className="input"><option value="">Selecciona…</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <button className="btn-ghost">Abrir</button>
      </form>

      {!client ? <Empty>Selecciona un cliente para trabajar su biblioteca.</Empty> : (
        <>
          <form action={create} className="card grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <input type="hidden" name="clientId" value={client.id} />
            <h2 className="font-semibold text-white sm:col-span-2 lg:col-span-4">Nueva creatividad</h2>
            {originals.length === 0 && <div className="sm:col-span-2 lg:col-span-4"><Pending title="sin fotos originales">Sube la foto real del producto en <Link className="underline" href={`/clients/${client.id}`}>la ficha del cliente</Link>.</Pending></div>}
            <div><label className="label">Foto original</label>
              <select name="productAssetId" className="input" required>{originals.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
            <div><label className="label">Modo</label>
              <select name="mode" className="input">
                <option value="original">Foto original + marca (sin IA)</option>
                <option value="ai_background">Fondo con IA + foto original intacta</option>
                <option value="ai_scene">Escena completa con IA (revisión humana obligatoria)</option>
              </select></div>
            <div className="sm:col-span-2"><label className="label">Escena / fondo (modos IA)</label><input name="scene" className="input" placeholder="dormitorio moderno, luz cálida de tarde" /></div>
            <div><label className="label">Título en la imagen</label><input name="title" className="input" maxLength={60} /></div>
            <div><label className="label">Precio (texto exacto)</label><input name="price" className="input" placeholder="$299" /></div>
            <div><label className="label">Badges (máx. 2, coma)</label><input name="badges" className="input" placeholder="ENVÍO GRATIS" /></div>
            <div><label className="label">Botón en la imagen</label><input name="ctaText" className="input" placeholder="Escríbenos" /></div>
            <div><label className="label">CTA de Meta</label><select name="adCta" className="input">{CTAS.map((c) => <option key={c}>{c}</option>)}</select></div>
            <div><label className="label">Variaciones A/B (1-3)</label><input name="variations" type="number" min={1} max={3} defaultValue={1} className="input" /></div>
            <fieldset className="sm:col-span-2"><label className="label">Formatos</label>
              <div className="flex gap-4 text-sm">{Object.keys(FORMATS).map((k) => <label key={k} className="flex items-center gap-2"><input type="checkbox" name="formats" value={k} defaultChecked={k === "1:1"} /> {k}</label>)}</div></fieldset>
            <div className="flex items-end sm:col-span-2 lg:col-span-4"><button className="btn" disabled={originals.length === 0}>Generar</button>
              <span className="ml-3 text-xs text-zinc-500">Los modos con IA consumen crédito del proveedor configurado.</span></div>
          </form>

          <section className="space-y-3">
            <h2 className="font-semibold text-white">Biblioteca de {client.name}</h2>
            {creatives.length === 0 ? <Empty>Sin creatividades.</Empty> : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {creatives.map((c) => (
                  <div key={c.id} className="card space-y-3">
                    {c.assetId && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/assets/${c.assetId}`} alt={c.title} className="max-h-96 w-full rounded-xl bg-black/30 object-contain" />
                    )}
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="badge bg-white/10">{c.format}</span>
                      <span className="badge bg-white/10">{c.mode}</span>
                      {c.mode === "ai_scene" && <span className={`badge ${c.reviewed ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"}`}>{c.reviewed ? "producto verificado" : "revisión pendiente"}</span>}
                    </div>
                    {c.mode === "ai_scene" && (
                      <form action={review} className="flex items-center gap-2 text-xs">
                        <input type="hidden" name="id" value={c.id} />
                        <button name="approved" value={c.reviewed ? "0" : "1"} className="btn-ghost !py-1 text-xs">{c.reviewed ? "Quitar verificación" : "Confirmo: el producto es idéntico al real"}</button>
                      </form>
                    )}
                    <form action={saveCopy} className="space-y-2">
                      <input type="hidden" name="id" value={c.id} />
                      <input name="headline" defaultValue={c.headline ?? ""} placeholder="Titular (≤40)" className="input" maxLength={80} />
                      <textarea name="primaryText" defaultValue={c.primaryText ?? ""} placeholder="Texto principal" rows={2} className="input" />
                      <input name="description" defaultValue={c.description ?? ""} placeholder="Descripción" className="input" />
                      <select name="cta" defaultValue={c.cta ?? "LEARN_MORE"} className="input">{CTAS.map((x) => <option key={x}>{x}</option>)}</select>
                      <button className="btn-ghost w-full">Guardar copy</button>
                    </form>
                    <form action={abCopies} className="flex gap-2">
                      <input type="hidden" name="id" value={c.id} />
                      <input name="angle" placeholder="Ángulo (ej. precio, confort)" className="input" />
                      <button className="btn-ghost whitespace-nowrap">3 copies IA</button>
                    </form>
                    <div className="flex items-center justify-between text-xs">
                      {c.assetId && <a className="text-brand-400 hover:underline" href={`/api/assets/${c.assetId}?download=1`}>Descargar PNG (Meta)</a>}
                      <form action={del}><input type="hidden" name="id" value={c.id} /><button className="text-red-300 hover:underline">Eliminar</button></form>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
