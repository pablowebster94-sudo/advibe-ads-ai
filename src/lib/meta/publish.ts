import { db } from "../db";
import { credsFor } from "./connect";
import { MetaCreds, MetaError, gpost } from "./graph";
import { createLeadForm } from "./leadforms";
import {
  LeadFormConfig,
  TargetingInput,
  buildTargeting,
  callToAction,
  destinationAdsetParams,
  hasLocation,
  isRestricted,
  validateLeadForm,
} from "./spec";

export type DraftAd = {
  name: string;
  creativeId: string; // id de Creative (Asset local)
  headline?: string;
  primaryText?: string;
  description?: string;
  cta?: string;
  link?: string;
};
export type DraftAdset = {
  name: string;
  dailyBudget?: number;
  targeting: TargetingInput;
  /** Formulario instantáneo (solo destino FORM). */
  leadForm?: LeadFormConfig;
  ads: DraftAd[];
};

export class PublishBlocked extends Error {}

const OBJECTIVE_GOAL: Record<string, { optimization: string; billing: string }> = {
  OUTCOME_ENGAGEMENT: { optimization: "CONVERSATIONS", billing: "IMPRESSIONS" },
  OUTCOME_TRAFFIC: { optimization: "LINK_CLICKS", billing: "IMPRESSIONS" },
  OUTCOME_LEADS: { optimization: "LEAD_GENERATION", billing: "IMPRESSIONS" },
  OUTCOME_SALES: { optimization: "OFFSITE_CONVERSIONS", billing: "IMPRESSIONS" },
  OUTCOME_AWARENESS: { optimization: "REACH", billing: "IMPRESSIONS" },
};

/** Validaciones previas. Devuelve lista de bloqueos; vacío = se puede publicar (en PAUSA). */
export async function validateDraft(draftId: string): Promise<string[]> {
  const d = await db.campaignDraft.findUniqueOrThrow({ where: { id: draftId } });
  const issues: string[] = [];
  if (!d.adAccountId) issues.push("Selecciona la cuenta publicitaria.");
  if (!d.pageId) issues.push("Selecciona la página de Facebook.");
  if (d.destination === "WHATSAPP" && !d.pageId) issues.push("WhatsApp requiere página.");
  if (d.destination === "FORM" && d.objective !== "OUTCOME_LEADS") issues.push("Los formularios instantáneos requieren el objetivo Clientes potenciales (OUTCOME_LEADS).");
  if (isRestricted(d.specialAdCategories) && !specialCountries(d).length) issues.push("Con categoría especial, Meta exige indicar el país del anuncio (usa países o ubicaciones de un solo país).");
  if (d.dailyBudget <= 0) issues.push("El presupuesto debe ser mayor que 0.");
  const adsets = (d.adsets as unknown as DraftAdset[]) || [];
  if (!adsets.length) issues.push("Agrega al menos un conjunto de anuncios.");
  for (const s of adsets) {
    if (!s.ads?.length) issues.push(`El conjunto "${s.name}" no tiene anuncios.`);
    for (const a of s.ads || []) {
      if (!a.creativeId) issues.push(`El anuncio "${a.name}" no tiene creatividad.`);
      if (d.destination === "WEBSITE" && !a.link) issues.push(`El anuncio "${a.name}" requiere URL de destino.`);
    }
    if (!hasLocation(s.targeting || {})) issues.push(`El conjunto "${s.name}" requiere ubicación.`);
    if (d.destination === "FORM") for (const x of validateLeadForm(s.leadForm)) issues.push(`Conjunto "${s.name}": ${x}`);
  }
  if (d.adAccountId) {
    const acc = await db.metaAdAccount.findUnique({ where: { id: d.adAccountId } });
    const conn = acc && (await db.metaConnection.findUnique({ where: { id: acc.connectionId } }));
    if (conn && !conn.grantedScopes.includes("ads_management")) issues.push("El token no tiene el permiso ads_management.");
    const pages = ((acc?.pages as any[]) || []).map((p) => p.id);
    if (d.pageId && acc?.assetsCheckedAt && !pages.includes(d.pageId)) issues.push("La página no está verificada como disponible para esta cuenta.");
    if (!acc?.assetsCheckedAt) issues.push("Verifica los activos de la cuenta (Conexiones → Verificar activos) antes de publicar.");
  }
  return issues;
}

/**
 * Publica el borrador en Meta. TODO se crea con status PAUSED (campaña, conjuntos y anuncios).
 * Esta función no activa nada.
 * AVISO: ruta de escritura sin probar contra Meta real hasta contar con credenciales.
 */
export async function publishDraft(draftId: string) {
  const issues = await validateDraft(draftId);
  if (issues.length) throw new PublishBlocked(issues.join("\n"));
  const d = await db.campaignDraft.findUniqueOrThrow({ where: { id: draftId }, include: { client: true } });
  const acc = await db.metaAdAccount.findUniqueOrThrow({ where: { id: d.adAccountId! } });
  const { creds } = await credsFor(acc.connectionId);
  const adsets = d.adsets as unknown as DraftAdset[];

  const log = async (step: string, ok: boolean, metaId?: string, message?: string) =>
    db.publishLog.create({ data: { draftId, step, ok, metaId, message } });

  let campaignId = d.metaCampaignId || "";
  try {
    if (!campaignId) {
      const c = await gpost<{ id: string }>(`${acc.actId}/campaigns`, creds, {
        name: d.name,
        objective: d.objective,
        status: "PAUSED",
        special_ad_categories: d.specialAdCategories.length ? d.specialAdCategories : [],
        ...(isRestricted(d.specialAdCategories) ? { special_ad_category_country: specialCountries(d) } : {}),
        buying_type: "AUCTION",
        is_adset_budget_sharing_enabled: false,
      });
      campaignId = c.id;
      await db.campaignDraft.update({ where: { id: draftId }, data: { metaCampaignId: campaignId } });
      await log("campaign", true, campaignId);
    }

    for (const s of adsets) {
      const goal = OBJECTIVE_GOAL[d.objective] || OBJECTIVE_GOAL.OUTCOME_TRAFFIC;
      // Formulario instantáneo: se crea en la página una sola vez y se guarda su id en el borrador.
      let formId = s.leadForm?.existingFormId || s.leadForm?.metaFormId;
      if (d.destination === "FORM" && !formId) {
        formId = await createLeadForm(d.adAccountId!, d.pageId!, s.leadForm!);
        s.leadForm = { ...s.leadForm!, metaFormId: formId };
        await db.campaignDraft.update({ where: { id: draftId }, data: { adsets: adsets as any } });
        await log("leadform", true, formId, s.leadForm.name);
      }
      const promoted: Record<string, unknown> = { page_id: d.pageId };
      if (d.destination === "WEBSITE" && d.pixelId && d.objective === "OUTCOME_SALES") {
        promoted.pixel_id = d.pixelId;
        promoted.custom_event_type = "PURCHASE";
      }
      const adsetParams: Record<string, unknown> = {
        name: s.name,
        campaign_id: campaignId,
        status: "PAUSED",
        daily_budget: Math.round((s.dailyBudget ?? d.dailyBudget) * 100),
        billing_event: goal.billing,
        optimization_goal: goal.optimization,
        bid_strategy: "LOWEST_COST_WITHOUT_CAP",
        targeting: buildTargeting(s.targeting, d.specialAdCategories),
        promoted_object: promoted,
        start_time: d.startTime?.toISOString(),
        end_time: d.endTime?.toISOString(),
      };
      Object.assign(adsetParams, destinationAdsetParams(d.destination));
      if (d.destination === "WHATSAPP" && d.client.whatsapp) promoted.whatsapp_phone_number = d.client.whatsapp;
      const adset = await gpost<{ id: string }>(`${acc.actId}/adsets`, creds, adsetParams as any);
      await log("adset", true, adset.id, s.name);

      for (const a of s.ads) {
        const hash = await uploadImage(creds, acc.actId, a.creativeId);
        const link =
          d.destination === "WHATSAPP"
            ? "https://api.whatsapp.com/send"
            : d.destination === "FORM"
              ? a.link || `https://www.facebook.com/${d.pageId}`
              : a.link || "";
        const spec: Record<string, unknown> = {
          page_id: d.pageId,
          link_data: {
            image_hash: hash,
            link,
            message: a.primaryText,
            name: a.headline,
            description: a.description,
            call_to_action: callToAction(d.destination, { cta: a.cta, link, formId }),
          },
        };
        if (d.igAccountId) spec.instagram_user_id = d.igAccountId;
        const cr = await gpost<{ id: string }>(`${acc.actId}/adcreatives`, creds, { name: a.name, object_story_spec: spec });
        await log("creative", true, cr.id, a.name);
        const ad = await gpost<{ id: string }>(`${acc.actId}/ads`, creds, {
          name: a.name,
          adset_id: adset.id,
          creative: { creative_id: cr.id },
          status: "PAUSED",
        });
        await log("ad", true, ad.id, a.name);
      }
    }
    await db.campaignDraft.update({
      where: { id: draftId },
      data: { status: "PUBLISHED_PAUSED", publishedAt: new Date(), lastError: null },
    });
    return { campaignId };
  } catch (e: any) {
    const msg = e instanceof MetaError ? `${e.message}${e.fbtraceId ? ` (trace ${e.fbtraceId})` : ""}` : e.message;
    await log("error", false, undefined, msg);
    await db.campaignDraft.update({ where: { id: draftId }, data: { status: "FAILED", lastError: msg } });
    throw e;
  }
}

async function uploadImage(creds: MetaCreds, actId: string, creativeId: string): Promise<string> {
  const cr = await db.creative.findUniqueOrThrow({ where: { id: creativeId } });
  if (!cr.assetId) throw new Error("La creatividad no tiene imagen final.");
  const asset = await db.asset.findUniqueOrThrow({ where: { id: cr.assetId } });
  const res = await gpost<{ images: Record<string, { hash: string }> }>(`${actId}/adimages`, creds, {
    bytes: Buffer.from(asset.data).toString("base64"),
  });
  const first = Object.values(res.images)[0];
  if (!first?.hash) throw new Error("Meta no devolvió hash de imagen.");
  return first.hash;
}

/** Países del anuncio para special_ad_category_country (derivados de la segmentación). */
function specialCountries(d: { adsets: unknown }): string[] {
  const set = new Set<string>();
  for (const s of ((d.adsets as unknown as DraftAdset[]) || [])) {
    s.targeting?.countries?.forEach((c) => set.add(c));
    for (const g of [...(s.targeting?.regions ?? []), ...(s.targeting?.cities ?? [])] as { country_code?: string }[]) {
      if (g.country_code) set.add(g.country_code);
    }
  }
  return [...set];
}
