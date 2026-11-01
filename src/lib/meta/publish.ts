import { db } from "../db";
import { credsFor } from "./connect";
import { MetaCreds, MetaError, gpost } from "./graph";

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
  targeting: {
    countries?: string[];
    cities?: { key: string; radius?: number; distance_unit?: string }[];
    ageMin?: number;
    ageMax?: number;
    genders?: number[]; // 1 hombres, 2 mujeres
    interests?: { id: string; name: string }[];
    customAudiences?: { id: string }[];
    excludedCustomAudiences?: { id: string }[];
    placements?: "advantage" | { publisher_platforms: string[]; facebook_positions?: string[]; instagram_positions?: string[] };
  };
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
  if (d.dailyBudget <= 0) issues.push("El presupuesto debe ser mayor que 0.");
  const adsets = (d.adsets as unknown as DraftAdset[]) || [];
  if (!adsets.length) issues.push("Agrega al menos un conjunto de anuncios.");
  for (const s of adsets) {
    if (!s.ads?.length) issues.push(`El conjunto "${s.name}" no tiene anuncios.`);
    for (const a of s.ads || []) {
      if (!a.creativeId) issues.push(`El anuncio "${a.name}" no tiene creatividad.`);
      if (d.destination === "WEBSITE" && !a.link) issues.push(`El anuncio "${a.name}" requiere URL de destino.`);
    }
    if (!s.targeting?.countries?.length && !s.targeting?.cities?.length) issues.push(`El conjunto "${s.name}" requiere ubicación.`);
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
        buying_type: "AUCTION",
        is_adset_budget_sharing_enabled: false,
      });
      campaignId = c.id;
      await db.campaignDraft.update({ where: { id: draftId }, data: { metaCampaignId: campaignId } });
      await log("campaign", true, campaignId);
    }

    for (const s of adsets) {
      const goal = OBJECTIVE_GOAL[d.objective] || OBJECTIVE_GOAL.OUTCOME_TRAFFIC;
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
        targeting: buildTargeting(s.targeting),
        promoted_object: promoted,
        start_time: d.startTime?.toISOString(),
        end_time: d.endTime?.toISOString(),
      };
      if (d.destination === "WHATSAPP") {
        adsetParams.destination_type = "WHATSAPP";
        if (d.client.whatsapp) promoted.whatsapp_phone_number = d.client.whatsapp;
      } else if (d.destination === "MESSENGER") adsetParams.destination_type = "MESSENGER";
      else if (d.destination === "INSTAGRAM_DM") adsetParams.destination_type = "INSTAGRAM_DIRECT";
      else if (d.destination === "WEBSITE") adsetParams.destination_type = "WEBSITE";
      const adset = await gpost<{ id: string }>(`${acc.actId}/adsets`, creds, adsetParams as any);
      await log("adset", true, adset.id, s.name);

      for (const a of s.ads) {
        const hash = await uploadImage(creds, acc.actId, a.creativeId);
        const cta = d.destination === "WHATSAPP" ? "WHATSAPP_MESSAGE" : a.cta || "LEARN_MORE";
        const link = d.destination === "WHATSAPP" ? "https://api.whatsapp.com/send" : a.link || "";
        const spec: Record<string, unknown> = {
          page_id: d.pageId,
          link_data: {
            image_hash: hash,
            link,
            message: a.primaryText,
            name: a.headline,
            description: a.description,
            call_to_action: { type: cta, value: d.destination === "WHATSAPP" ? { app_destination: "WHATSAPP" } : { link } },
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

function buildTargeting(t: DraftAdset["targeting"]) {
  const out: Record<string, unknown> = {
    geo_locations: {
      ...(t.countries?.length ? { countries: t.countries } : {}),
      ...(t.cities?.length ? { cities: t.cities } : {}),
    },
    age_min: t.ageMin ?? 18,
    age_max: t.ageMax ?? 65,
    targeting_automation: { advantage_audience: 0 },
  };
  if (t.genders?.length) out.genders = t.genders;
  if (t.interests?.length) out.flexible_spec = [{ interests: t.interests.map((i) => ({ id: i.id, name: i.name })) }];
  if (t.customAudiences?.length) out.custom_audiences = t.customAudiences;
  if (t.excludedCustomAudiences?.length) out.excluded_custom_audiences = t.excludedCustomAudiences;
  if (t.placements && t.placements !== "advantage") Object.assign(out, t.placements);
  return out;
}
