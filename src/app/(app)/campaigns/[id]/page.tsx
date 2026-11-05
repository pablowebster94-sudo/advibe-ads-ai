import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { back, num, str, writer } from "@/lib/actions-util";
import { money } from "@/lib/format";
import { DraftAdset, PublishBlocked, publishDraft, validateDraft } from "@/lib/meta/publish";
import { searchGeo, searchInterests } from "@/lib/meta/targeting";
import { listLeadForms, listLeads, type ExistingForm, type Lead } from "@/lib/meta/leadforms";
import { LEAD_CTAS, SPECIAL_CATEGORIES, STANDARD_FIELDS, buildTargeting, restrictionNotes, type LeadFormConfig, type StandardField } from "@/lib/meta/spec";
import { Notice, PageHeader, StatusBadge } from "@/components/ui";

export const maxDuration = 120;

async function load(orgId: string, id: string) {
  const d = await db.campaignDraft.findFirst({ where: { id, client: { orgId } }, include: { client: { include: { links: { include: { adAccount: true } } } } } });
  if (!d) throw new Error("Borrador no encontrado.");
  return d;
}
const editable = (status: string) => status !== "PUBLISHED_PAUSED";

async function saveBasics(f: FormData) {
  "use server";
  const s = await writer();
  const id = str(f, "id");
  const d = await load(s.orgId, id);
  if (!editable(d.status)) back(`/campaigns/${id}`, "error", "Ya fue publicada; edítala en Meta.");
  const linkId = str(f, "linkId");
  const link = d.client.links.find((l) => l.id === linkId);
  await db.campaignDraft.update({
    where: { id },
    data: {
      name: str(f, "name") || d.name,
      // Los formularios instantáneos solo existen con el objetivo de clientes potenciales.
      objective: str(f, "destination") === "FORM" ? "OUTCOME_LEADS" : str(f, "objective"),
      destination: str(f, "destination"),
      dailyBudget: num(f, "dailyBudget") ?? d.dailyBudget,
      startTime: str(f, "startTime") ? new Date(str(f, "startTime")) : null,
      endTime: str(f, "endTime") ? new Date(str(f, "endTime")) : null,
      specialAdCategories: str(f, "special") ? [str(f, "special")] : [],
      ...(link ? { adAccountId: link.adAccountId, pageId: link.pageId, igAccountId: link.igAccountId, pixelId: link.pixelId } : {}),
      status: "DRAFT",
    },
  });
  back(`/campaigns/${id}`, "ok", "Guardado.");
}

async function addAdset(f: FormData) {
  "use server";
  const s = await writer();
  const id = str(f, "id");
  const d = await load(s.orgId, id);
  if (!editable(d.status)) back(`/campaigns/${id}`, "error", "Ya publicada.");
  const adsets = (d.adsets as unknown as DraftAdset[]) || [];
  const interestTerms = str(f, "interests").split(",").map((x) => x.trim()).filter(Boolean);
  const cityTerms = str(f, "cities").split(",").map((x) => x.trim()).filter(Boolean);
  const regionTerms = str(f, "regions").split(",").map((x) => x.trim()).filter(Boolean);
  const geoCountry = (str(f, "geoCountry") || "EC").toUpperCase();
  const wholeCountry = str(f, "wholeCountry") === "on";
  const radius = Math.min(Math.max(num(f, "radius") ?? 25, 1), 80);
  const countries = [
    ...str(f, "countries").toUpperCase().split(/[,\s]+/).filter((x) => /^[A-Z]{2}$/.test(x)),
    ...(wholeCountry ? [geoCountry] : []),
  ].filter((x, i, a) => a.indexOf(x) === i);
  const interests: { id: string; name: string }[] = [];
  const cities: { key: string; name: string; country_code?: string; region_key?: string; radius: number; distance_unit: string }[] = [];
  const regions: { key: string; name: string; country_code?: string }[] = [];
  const unresolved: string[] = [];
  const needMeta = interestTerms.length || cityTerms.length || regionTerms.length;
  if (needMeta && !d.adAccountId) back(`/campaigns/${id}`, "error", "Para validar intereses/ubicaciones con Meta primero elige la cuenta publicitaria.");
  let err = "";
  try {
    for (const t of interestTerms) {
      const hit = (await searchInterests(d.adAccountId!, t))[0];
      if (hit) interests.push({ id: hit.id, name: hit.name });
      else unresolved.push(t);
    }
    // Ubicaciones: solo claves devueltas por Meta, limitadas al país elegido.
    for (const t of regionTerms) {
      const hit = (await searchGeo(d.adAccountId!, t, { types: ["region"], countryCode: geoCountry }))[0];
      if (hit) regions.push({ key: hit.key, name: `${hit.name}${hit.country_name ? `, ${hit.country_name}` : ""}`, country_code: hit.country_code ?? geoCountry });
      else unresolved.push(`${t} (provincia)`);
    }
    for (const t of cityTerms) {
      const hit = (await searchGeo(d.adAccountId!, t, { types: ["city"], countryCode: geoCountry }))[0];
      if (hit) cities.push({ key: hit.key, name: `${hit.name}${hit.region ? `, ${hit.region}` : ""}`, country_code: hit.country_code ?? geoCountry, region_key: hit.region_id != null ? String(hit.region_id) : undefined, radius, distance_unit: "kilometer" });
      else unresolved.push(`${t} (ciudad)`);
    }
  } catch (e: any) {
    err = e.message;
  }
  if (err) back(`/campaigns/${id}`, "error", `No se pudo consultar Meta: ${err}`);
  const audiences = f.getAll("audiences").map(String);
  const excluded = f.getAll("excluded").map(String);
  adsets.push({
    name: str(f, "name") || `Conjunto ${adsets.length + 1}`,
    dailyBudget: num(f, "dailyBudget") ?? undefined,
    targeting: {
      countries, regions, cities, interests,
      ageMin: num(f, "ageMin") ?? 18, ageMax: num(f, "ageMax") ?? 65,
      genders: str(f, "gender") ? [Number(str(f, "gender"))] : undefined,
      customAudiences: audiences.map((x) => ({ id: x })),
      excludedCustomAudiences: excluded.map((x) => ({ id: x })),
      placements: "advantage",
    },
    ads: [],
    ...(d.destination === "FORM" ? { leadForm: readLeadForm(f) } : {}),
  });
  await db.campaignDraft.update({ where: { id }, data: { adsets: adsets as any, status: "DRAFT" } });
  back(`/campaigns/${id}`, unresolved.length ? "error" : "ok", unresolved.length ? `Conjunto agregado, pero Meta no encontró: ${unresolved.join(", ")}.` : "Conjunto agregado con intereses y ubicaciones validados por Meta.");
}

/** Lee la configuración del formulario instantáneo del formulario HTML. */
function readLeadForm(f: FormData): LeadFormConfig {
  const fields = f.getAll("lfFields").map(String).filter((x): x is StandardField => x in STANDARD_FIELDS);
  const customQuestions = str(f, "lfCustom")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [label, opts] = line.split("|");
      const options = opts ? opts.split(";").map((o) => o.trim()).filter(Boolean) : undefined;
      return { label: label.trim(), ...(options?.length ? { options } : {}) };
    });
  return {
    existingFormId: str(f, "lfExisting") || undefined,
    name: str(f, "lfName") || "Formulario AdVibe",
    fields,
    customQuestions,
    privacyUrl: str(f, "lfPrivacy"),
    privacyLinkText: str(f, "lfPrivacyText") || undefined,
    intro: str(f, "lfIntro") ? { headline: str(f, "lfIntro"), description: str(f, "lfIntroBody") || undefined } : undefined,
    thankYou: {
      title: str(f, "lfThanksTitle"),
      body: str(f, "lfThanksBody"),
      buttonText: str(f, "lfThanksButton") || "Visitar sitio web",
      websiteUrl: str(f, "lfThanksUrl") || undefined,
    },
    locale: "es_LA",
    higherIntent: str(f, "lfHigherIntent") === "on",
  };
}

async function delAdset(f: FormData) {
  "use server";
  const s = await writer();
  const id = str(f, "id");
  const d = await load(s.orgId, id);
  if (!editable(d.status)) back(`/campaigns/${id}`, "error", "Ya publicada.");
  const adsets = (d.adsets as unknown as DraftAdset[]).filter((_, i) => i !== Number(str(f, "idx")));
  await db.campaignDraft.update({ where: { id }, data: { adsets: adsets as any, status: "DRAFT" } });
  back(`/campaigns/${id}`, "ok", "Conjunto eliminado.");
}

async function addAd(f: FormData) {
  "use server";
  const s = await writer();
  const id = str(f, "id");
  const d = await load(s.orgId, id);
  if (!editable(d.status)) back(`/campaigns/${id}`, "error", "Ya publicada.");
  const cr = await db.creative.findFirst({ where: { id: str(f, "creativeId"), clientId: d.clientId } });
  if (!cr) back(`/campaigns/${id}`, "error", "Elige una creatividad.");
  if (!cr!.reviewed) back(`/campaigns/${id}`, "error", "Esa creatividad con IA aún no tiene la verificación humana del producto.");
  const adsets = d.adsets as unknown as DraftAdset[];
  const idx = Number(str(f, "idx"));
  adsets[idx].ads.push({
    name: str(f, "name") || cr!.headline || cr!.title,
    creativeId: cr!.id,
    headline: cr!.headline ?? undefined,
    primaryText: cr!.primaryText ?? undefined,
    description: cr!.description ?? undefined,
    cta: cr!.cta ?? undefined,
    link: str(f, "link") || d.client.website || undefined,
  });
  await db.campaignDraft.update({ where: { id }, data: { adsets: adsets as any, status: "DRAFT" } });
  back(`/campaigns/${id}`, "ok", "Anuncio agregado.");
}

async function delAd(f: FormData) {
  "use server";
  const s = await writer();
  const id = str(f, "id");
  const d = await load(s.orgId, id);
  const adsets = d.adsets as unknown as DraftAdset[];
  adsets[Number(str(f, "idx"))].ads.splice(Number(str(f, "adIdx")), 1);
  await db.campaignDraft.update({ where: { id }, data: { adsets: adsets as any, status: "DRAFT" } });
  back(`/campaigns/${id}`, "ok", "Anuncio quitado.");
}

async function publish(f: FormData) {
  "use server";
  const s = await writer();
  const id = str(f, "id");
  await load(s.orgId, id);
  if (str(f, "confirm") !== "PUBLICAR EN PAUSA") back(`/campaigns/${id}`, "error", "Escribe exactamente: PUBLICAR EN PAUSA");
  let msg = "";
  let campaignId = "";
  try {
    campaignId = (await publishDraft(id)).campaignId;
    await audit(s, "campaign.publish_paused", id, { campaignId });
  } catch (e: any) {
    msg = e instanceof PublishBlocked ? `Bloqueado:\n${e.message}` : e.message;
    await audit(s, "campaign.publish_failed", id, { error: msg });
  }
  if (msg) back(`/campaigns/${id}`, "error", msg);
  back(`/campaigns/${id}`, "ok", `Creada en Meta en PAUSA (campaña ${campaignId}). Actívala tú en Meta cuando quieras.`);
}

async function removeDraft(f: FormData) {
  "use server";
  const s = await writer();
  const id = str(f, "id");
  await load(s.orgId, id);
  await db.campaignDraft.delete({ where: { id } });
  back("/campaigns", "ok", "Borrador eliminado.");
}

export default async function DraftPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const s = await requireSession();
  const { id } = await params;
  const sp = await searchParams;
  const d = await db.campaignDraft.findFirst({
    where: { id, client: { orgId: s.orgId } },
    include: { client: { include: { links: { include: { adAccount: true } } } }, logs: { orderBy: { createdAt: "asc" } } },
  });
  if (!d) notFound();
  const adsets = (d.adsets as unknown as (DraftAdset & { notes?: any })[]) || [];
  const creatives = await db.creative.findMany({ where: { clientId: d.clientId }, orderBy: { createdAt: "desc" }, take: 80 });
  const issues = await validateDraft(d.id);
  const acc = d.adAccountId ? await db.metaAdAccount.findUnique({ where: { id: d.adAccountId } }) : null;
  const audiences = ((acc?.audiences as any[]) || []) as { id: string; name: string }[];
  const ed = editable(d.status);
  // Leads de los formularios ya creados (solo lectura; requiere leads_retrieval).
  const leadForms = adsets.map((a) => a.leadForm?.metaFormId || a.leadForm?.existingFormId).filter((x): x is string => Boolean(x));
  const leadsByForm: Record<string, { leads?: Lead[]; error?: string }> = {};
  if (d.destination === "FORM" && d.status === "PUBLISHED_PAUSED" && d.adAccountId && d.pageId) {
    for (const fid of [...new Set(leadForms)]) {
      try {
        leadsByForm[fid] = { leads: await listLeads(d.adAccountId, d.pageId, fid, 50) };
      } catch (e: any) {
        leadsByForm[fid] = { error: e.message };
      }
    }
  }
  let forms: ExistingForm[] = [];
  let formsError = "";
  if (d.destination === "FORM" && d.adAccountId && d.pageId && ed) {
    try {
      forms = await listLeadForms(d.adAccountId, d.pageId);
    } catch (e: any) {
      formsError = e.message;
    }
  }
  const dt = (x: Date | null) => (x ? x.toISOString().slice(0, 16) : "");
  const cur = d.client.currency;

  return (
    <div className="space-y-6">
      <PageHeader title={d.name} subtitle={`${d.client.name} · ${d.objective.replace("OUTCOME_", "")} · ${d.destination}`}>
        <StatusBadge s={d.status} />
        <Link href="/campaigns" className="btn-ghost">Volver</Link>
      </PageHeader>
      {sp.error && <Notice kind="error"><span className="whitespace-pre-line">{sp.error}</span></Notice>}
      {sp.ok && <Notice kind="ok">{sp.ok}</Notice>}

      <form action={saveBasics} className="card grid gap-3 sm:grid-cols-3">
        <input type="hidden" name="id" value={d.id} />
        <h2 className="font-semibold text-white sm:col-span-3">1 · Configuración</h2>
        <div><label className="label">Nombre</label><input name="name" defaultValue={d.name} className="input" /></div>
        <div><label className="label">Objetivo</label>
          <select name="objective" defaultValue={d.objective} className="input">{["OUTCOME_ENGAGEMENT", "OUTCOME_LEADS", "OUTCOME_SALES", "OUTCOME_TRAFFIC", "OUTCOME_AWARENESS"].map((o) => <option key={o}>{o}</option>)}</select></div>
        <div><label className="label">Destino</label>
          <select name="destination" defaultValue={d.destination} className="input">{[["WHATSAPP", "WhatsApp"], ["MESSENGER", "Messenger"], ["INSTAGRAM_DM", "Instagram DM"], ["WEBSITE", "Sitio web"], ["FORM", "Formulario instantáneo (Leads)"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div className="sm:col-span-2"><label className="label">Cuenta + página + Instagram + pixel (vínculo del cliente)</label>
          <select name="linkId" className="input" defaultValue="">
            <option value="">{d.adAccountId ? "(mantener selección actual)" : "Elige…"}</option>
            {d.client.links.map((l) => <option key={l.id} value={l.id}>{l.adAccount.name} · pág {l.pageId ?? "—"} · IG {l.igAccountId ?? "—"} · px {l.pixelId ?? "—"}</option>)}
          </select>
          {d.client.links.length === 0 && <div className="mt-1 text-xs text-amber-300">Este cliente no tiene cuenta vinculada: hazlo en su ficha (requiere conexión y activos verificados).</div>}
          <div className="mt-1 text-xs text-zinc-500">Actual: cuenta {acc?.name ?? "—"} · página {d.pageId ?? "—"} · IG {d.igAccountId ?? "—"} · pixel {d.pixelId ?? "—"}</div></div>
        <div><label className="label">Presupuesto diario por conjunto ({cur})</label><input name="dailyBudget" type="number" step="0.01" min="1" defaultValue={d.dailyBudget} className="input" /></div>
        <div><label className="label">Inicio</label><input name="startTime" type="datetime-local" defaultValue={dt(d.startTime)} className="input" /></div>
        <div><label className="label">Fin</label><input name="endTime" type="datetime-local" defaultValue={dt(d.endTime)} className="input" /></div>
        <div><label className="label">Categoría especial</label>
          <select name="special" defaultValue={d.specialAdCategories[0] === "CREDIT" ? "FINANCIAL_PRODUCTS_SERVICES" : d.specialAdCategories[0] ?? ""} className="input"><option value="">Ninguna</option>{SPECIAL_CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        {ed && <div className="sm:col-span-3"><button className="btn">Guardar</button></div>}
      </form>

      <section className="space-y-4">
        <h2 className="font-semibold text-white">2 · Conjuntos y anuncios</h2>
        {adsets.map((a, i) => (
          <div key={i} className="card space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-medium text-white">{a.name} · {money(a.dailyBudget ?? d.dailyBudget, cur)}/día</div>
                <div className="text-xs text-zinc-400">
                  Países {a.targeting.countries?.join(",") || "—"} · Provincias: {a.targeting.regions?.map((r) => r.name).join("; ") || "—"} · Ciudades: {a.targeting.cities?.map((c) => `${c.name ?? c.key} (+${c.radius ?? 25} km)`).join("; ") || "—"} · {a.targeting.ageMin}-{a.targeting.ageMax} · Intereses: {a.targeting.interests?.map((x) => x.name).join(", ") || "—"} · Audiencias: {a.targeting.customAudiences?.length ?? 0} · Excl.: {a.targeting.excludedCustomAudiences?.length ?? 0}
                </div>
                {restrictionNotes(a.targeting, d.specialAdCategories).map((n) => <div key={n} className="text-xs text-sky-300">{n}</div>)}
                {a.leadForm && <div className="text-xs text-zinc-400">Formulario: {a.leadForm.existingFormId ? `existente ${a.leadForm.existingFormId}` : `${a.leadForm.name} · ${a.leadForm.fields.length + a.leadForm.customQuestions.length} pregunta(s)`}{a.leadForm.metaFormId ? ` · creado en Meta ${a.leadForm.metaFormId}` : ""}</div>}
                <details className="text-xs text-zinc-400"><summary className="cursor-pointer">Segmentación final que recibirá Meta</summary>
                  <pre className="mt-1 max-h-60 overflow-auto rounded-lg bg-black/40 p-2 text-[11px]">{JSON.stringify(buildTargeting(a.targeting, d.specialAdCategories), null, 2)}</pre></details>
                {a.notes?.interestTerms?.length > 0 && !a.targeting.interests?.length && <div className="text-xs text-amber-300">Sugeridos por la IA sin validar: {a.notes.interestTerms.join(", ")}</div>}
              </div>
              {ed && <form action={delAdset}><input type="hidden" name="id" value={d.id} /><input type="hidden" name="idx" value={i} /><button className="text-xs text-red-300 hover:underline">Eliminar conjunto</button></form>}
            </div>
            <ul className="space-y-1">
              {a.ads.map((ad, k) => (
                <li key={k} className="flex items-center justify-between gap-2 rounded-lg bg-white/5 px-3 py-2 text-sm">
                  <span className="truncate">{ad.name} <span className="text-xs text-zinc-400">· {d.destination === "FORM" ? (ad.cta && LEAD_CTAS.includes(ad.cta) ? ad.cta : "SIGN_UP") : ad.cta}</span></span>
                  {ed && <form action={delAd}><input type="hidden" name="id" value={d.id} /><input type="hidden" name="idx" value={i} /><input type="hidden" name="adIdx" value={k} /><button className="text-xs text-red-300">Quitar</button></form>}
                </li>
              ))}
              {a.ads.length === 0 && <li className="text-xs text-zinc-500">Sin anuncios.</li>}
            </ul>
            {ed && (
              <form action={addAd} className="grid gap-2 sm:grid-cols-4">
                <input type="hidden" name="id" value={d.id} /><input type="hidden" name="idx" value={i} />
                <select name="creativeId" className="input sm:col-span-2" required>
                  <option value="">Creatividad…</option>
                  {creatives.map((c) => <option key={c.id} value={c.id} disabled={!c.reviewed}>{c.title} · {c.format}{c.headline ? ` · ${c.headline}` : ""}{!c.reviewed ? " (sin verificar)" : ""}</option>)}
                </select>
                <input name="name" placeholder="Nombre del anuncio" className="input" />
                <input name="link" placeholder={d.destination === "WEBSITE" ? "URL destino" : "URL (opcional)"} className="input" />
                <div><button className="btn-ghost">Agregar anuncio</button></div>
              </form>
            )}
          </div>
        ))}
        {ed && (
          <form action={addAdset} className="card grid gap-3 sm:grid-cols-4">
            <input type="hidden" name="id" value={d.id} />
            <h3 className="sm:col-span-4 font-medium text-white">Nuevo conjunto de anuncios</h3>
            <div><label className="label">Nombre</label><input name="name" className="input" /></div>
            <div><label className="label">Presupuesto diario</label><input name="dailyBudget" type="number" step="0.01" className="input" placeholder={String(d.dailyBudget)} /></div>
            <div><label className="label">País de las ubicaciones (ISO)</label><input name="geoCountry" className="input" defaultValue="EC" maxLength={2} /></div>
            <label className="flex items-end gap-2 pb-2 text-sm text-zinc-300"><input type="checkbox" name="wholeCountry" /> Todo el país</label>
            <div><label className="label">Provincias (se buscan en Meta)</label><input name="regions" className="input" placeholder="Azuay, Cañar" /></div>
            <div><label className="label">Ciudades (se buscan en Meta)</label><input name="cities" className="input" placeholder="Cuenca, Azogues" /></div>
            <div><label className="label">Radio alrededor de ciudades (km)</label><input name="radius" type="number" min={1} max={80} defaultValue={25} className="input" /></div>
            <div><label className="label">Otros países (ISO, coma)</label><input name="countries" className="input" placeholder="opcional" /></div>
            {d.specialAdCategories.length > 0 && <div className="sm:col-span-4 text-xs text-sky-300">Categoría especial {d.specialAdCategories.join(", ")}: se aplican las restricciones de Meta (edad 18-65+, todos los géneros, sin exclusiones, radio mínimo de 25 km alrededor de ciudades; sin comportamientos, datos demográficos ni públicos similares). No combines una ciudad con la provincia que la contiene: Meta rechaza ubicaciones superpuestas.</div>}
            <div><label className="label">Edad mín.</label><input name="ageMin" type="number" min={13} max={65} defaultValue={18} className="input" /></div>
            <div><label className="label">Edad máx.</label><input name="ageMax" type="number" min={13} max={65} defaultValue={65} className="input" /></div>
            <div><label className="label">Género</label><select name="gender" className="input"><option value="">Todos</option><option value="1">Hombres</option><option value="2">Mujeres</option></select></div>
            <div><label className="label">Intereses (se validan en Meta)</label><input name="interests" className="input" placeholder="Barbería, Cuidado personal" /></div>
            <div className="sm:col-span-2"><label className="label">Públicos personalizados (disponibles en la cuenta)</label>
              <select name="audiences" multiple className="input h-20">{audiences.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
            <div className="sm:col-span-2"><label className="label">Excluir públicos</label>
              <select name="excluded" multiple className="input h-20">{audiences.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
            {d.destination === "FORM" && (
              <fieldset className="sm:col-span-4 grid gap-3 rounded-xl border border-white/10 p-3 sm:grid-cols-4">
                <legend className="px-1 text-sm font-medium text-white">Formulario instantáneo</legend>
                {formsError && <div className="sm:col-span-4 text-xs text-amber-300">No se pudieron leer los formularios de la página: {formsError}</div>}
                <div className="sm:col-span-4"><label className="label">Usar un formulario existente de la página</label>
                  <select name="lfExisting" className="input" defaultValue=""><option value="">— Crear uno nuevo con estos datos —</option>{forms.filter((x) => x.status === "ACTIVE").map((x) => <option key={x.id} value={x.id}>{x.name} ({x.id})</option>)}</select></div>
                <div className="sm:col-span-2"><label className="label">Nombre del formulario</label><input name="lfName" className="input" placeholder="Casting AdVibe · Cuenca" /></div>
                <div className="sm:col-span-2"><label className="label">Política de privacidad (URL https)</label><input name="lfPrivacy" className="input" placeholder="https://tusitio.com/privacidad" /></div>
                <div className="sm:col-span-4"><label className="label">Campos del formulario</label>
                  <div className="flex flex-wrap gap-3 text-sm text-zinc-300">{Object.entries(STANDARD_FIELDS).map(([k, l]) => <label key={k} className="flex items-center gap-1"><input type="checkbox" name="lfFields" value={k} defaultChecked={["FULL_NAME", "PHONE", "EMAIL", "CITY"].includes(k)} /> {l}</label>)}</div></div>
                <div className="sm:col-span-4"><label className="label">Preguntas personalizadas (una por línea; opciones tras | separadas por ;)</label>
                  <textarea name="lfCustom" rows={3} className="input" placeholder={"¿Tienes experiencia frente a cámara?|Sí;No\nEnlace a tu Instagram o TikTok"} /></div>
                <div className="sm:col-span-2"><label className="label">Introducción: título (opcional)</label><input name="lfIntro" className="input" /></div>
                <div className="sm:col-span-2"><label className="label">Introducción: texto (opcional)</label><input name="lfIntroBody" className="input" /></div>
                <div><label className="label">Agradecimiento: título</label><input name="lfThanksTitle" className="input" placeholder="¡Gracias por postular!" /></div>
                <div className="sm:col-span-2"><label className="label">Agradecimiento: texto</label><input name="lfThanksBody" className="input" placeholder="Revisaremos tu perfil y te contactaremos." /></div>
                <div><label className="label">Botón: texto</label><input name="lfThanksButton" className="input" placeholder="Visitar sitio web" /></div>
                <div className="sm:col-span-2"><label className="label">Botón: URL https</label><input name="lfThanksUrl" className="input" placeholder="https://tusitio.com" /></div>
                <label className="sm:col-span-2 flex items-center gap-2 text-sm text-zinc-300"><input type="checkbox" name="lfHigherIntent" /> Mayor intención (pantalla de revisión antes de enviar)</label>
                <div className="sm:col-span-4 text-xs text-zinc-500">El formulario se crea en la página de Facebook al publicar (Meta no permite editarlo después; para cambiarlo se crea otro).</div>
              </fieldset>
            )}
            <div className="sm:col-span-4 text-xs text-zinc-500">Ubicaciones: automáticas (Advantage+ placements). Advantage+ audience desactivada para respetar tu segmentación.</div>
            <div><button className="btn">Agregar conjunto</button></div>
          </form>
        )}
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold text-white">3 · Revisión y publicación</h2>
        {issues.length === 0 ? <Notice kind="ok">Sin bloqueos. Se creará todo en PAUSA (campaña, conjuntos y anuncios).</Notice> : (
          <Notice kind="error"><b>Pendiente antes de publicar:</b><ul className="mt-1 list-disc pl-5">{issues.map((x, i) => <li key={i}>{x}</li>)}</ul></Notice>
        )}
        <div className="text-xs text-zinc-400">Presupuesto total diario: {money(adsets.reduce((t, a) => t + (a.dailyBudget ?? d.dailyBudget), 0), cur)} · {adsets.length} conjunto(s) · {adsets.reduce((t, a) => t + a.ads.length, 0)} anuncio(s)</div>
        {d.lastError && <Notice kind="error">Último error: {d.lastError}</Notice>}
        {d.metaCampaignId && <div className="text-sm text-zinc-300">ID de campaña en Meta: <code>{d.metaCampaignId}</code></div>}
        {ed && (
          <form action={publish} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="id" value={d.id} />
            <div className="min-w-[240px] flex-1"><label className="label">Escribe PUBLICAR EN PAUSA para confirmar</label><input name="confirm" className="input" autoComplete="off" /></div>
            <button className="btn" disabled={issues.length > 0}>Publicar en Meta (en pausa)</button>
          </form>
        )}
        {Object.entries(leadsByForm).map(([fid, r]) => (
          <div key={fid} className="space-y-2 rounded-xl border border-white/10 p-3 text-sm">
            <div className="flex items-center justify-between"><b className="text-white">Leads del formulario {fid}</b>
              {r.leads && <a className="btn-ghost text-xs" href={`/api/leads/${fid}?draft=${d.id}`}>Descargar CSV</a>}</div>
            {r.error && <div className="text-xs text-amber-300">Meta no permitió leer los leads: {r.error}</div>}
            {r.leads && r.leads.length === 0 && <div className="text-xs text-zinc-500">Aún no hay leads.</div>}
            {r.leads && r.leads.length > 0 && (
              <ul className="max-h-64 space-y-1 overflow-auto text-xs text-zinc-300">{r.leads.map((l) => (
                <li key={l.id} className="rounded bg-white/5 px-2 py-1">{new Date(l.created_time).toLocaleString("es-EC")} · {l.field_data.map((f) => `${f.name}: ${f.values.join(", ")}`).join(" · ")}</li>
              ))}</ul>
            )}
          </div>
        ))}
        {d.logs.length > 0 && (
          <details className="text-xs text-zinc-400"><summary className="cursor-pointer">Registro de publicación</summary>
            <ul className="mt-2 space-y-1">{d.logs.map((l) => <li key={l.id}>{l.ok ? "✓" : "✗"} {l.step} {l.metaId} {l.message}</li>)}</ul></details>
        )}
        <form action={removeDraft}><input type="hidden" name="id" value={d.id} /><button className="text-xs text-red-300 hover:underline">Eliminar borrador (no borra nada en Meta)</button></form>
      </section>
    </div>
  );
}
