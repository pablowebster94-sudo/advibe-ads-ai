import { db } from "../db";
import { credsFor } from "./connect";
import { gall } from "./graph";

const num = (v: unknown) => (v == null || v === "" ? 0 : Number(v));

function actionSum(list: any[] | undefined, types: string[]) {
  if (!list) return 0;
  return list.filter((a) => types.includes(a.action_type)).reduce((s, a) => s + num(a.value), 0);
}

const CONV_TYPES = ["onsite_conversion.messaging_conversation_started_7d", "onsite_conversion.total_messaging_connection"];
const LEAD_TYPES = ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead"];
const PURCHASE_TYPES = ["purchase", "offsite_conversion.fb_pixel_purchase", "omni_purchase"];

/** Sincroniza estructura + insights diarios por anuncio. Solo lectura. */
export async function syncAdAccount(adAccountId: string, days = 30) {
  const acc = await db.metaAdAccount.findUniqueOrThrow({ where: { id: adAccountId } });
  const { creds } = await credsFor(acc.connectionId);
  try {
    // Estructura
    const structures: [string, string, string][] = [
      ["campaign", "campaigns", "id,name,status,effective_status,objective,daily_budget,lifetime_budget"],
      ["adset", "adsets", "id,name,status,effective_status,campaign_id,daily_budget,lifetime_budget"],
      ["ad", "ads", "id,name,status,effective_status,adset_id"],
    ];
    for (const [level, edge, fields] of structures) {
      const rows = await gall<any>(`${acc.actId}/${edge}`, creds, { fields }, 5000);
      for (const r of rows) {
        const parentId = level === "adset" ? r.campaign_id : level === "ad" ? r.adset_id : null;
        const data = {
          parentId,
          name: r.name,
          status: r.status,
          effectiveStatus: r.effective_status,
          objective: r.objective ?? null,
          dailyBudget: r.daily_budget ? Number(r.daily_budget) / 100 : null,
          lifetimeBudget: r.lifetime_budget ? Number(r.lifetime_budget) / 100 : null,
          syncedAt: new Date(),
        };
        await db.metaEntity.upsert({
          where: { adAccountId_level_metaId: { adAccountId, level, metaId: r.id } },
          update: data,
          create: { adAccountId, level, metaId: r.id, ...data },
        });
      }
    }

    // Insights
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const until = new Date().toISOString().slice(0, 10);
    const rows = await gall<any>(
      `${acc.actId}/insights`,
      creds,
      {
        level: "ad",
        time_increment: 1,
        time_range: { since, until },
        fields: "campaign_id,adset_id,ad_id,spend,impressions,reach,clicks,frequency,actions,action_values",
      },
      20000
    );
    for (const r of rows) {
      const data = {
        campaignId: r.campaign_id,
        adsetId: r.adset_id,
        spend: num(r.spend),
        impressions: Math.round(num(r.impressions)),
        reach: Math.round(num(r.reach)),
        clicks: Math.round(num(r.clicks)),
        frequency: num(r.frequency),
        conversations: Math.round(actionSum(r.actions, CONV_TYPES.slice(0, 1))),
        leads: Math.round(actionSum(r.actions, LEAD_TYPES.slice(0, 1))),
        purchases: Math.round(actionSum(r.actions, PURCHASE_TYPES.slice(0, 1))),
        purchaseValue: actionSum(r.action_values, PURCHASE_TYPES.slice(0, 1)),
      };
      const date = new Date(r.date_start);
      await db.insightSnapshot.upsert({
        where: { adAccountId_date_adId: { adAccountId, date, adId: r.ad_id } },
        update: data,
        create: { adAccountId, date, adId: r.ad_id, ...data },
      });
    }
    await db.metaAdAccount.update({ where: { id: adAccountId }, data: { syncedAt: new Date(), lastSyncError: null } });
    return { insights: rows.length };
  } catch (e: any) {
    await db.metaAdAccount.update({ where: { id: adAccountId }, data: { lastSyncError: e.message } });
    throw e;
  }
}
