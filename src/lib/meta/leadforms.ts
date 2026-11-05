import { db } from "../db";
import { credsFor } from "./connect";
import { MetaCreds, gall, gget, gpost } from "./graph";
import { LeadFormConfig, buildLeadFormPayload } from "./spec";

/**
 * Instant Forms live on the Facebook Page, not on the ad account, and Meta
 * requires a Page access token to create them. That token is requested with
 * the connection's user/system-user token (needs pages_manage_ads,
 * pages_read_engagement and leads_retrieval on that Page).
 */
async function pageCreds(adAccountId: string, pageId: string): Promise<MetaCreds> {
  const acc = await db.metaAdAccount.findUniqueOrThrow({ where: { id: adAccountId } });
  const { creds } = await credsFor(acc.connectionId);
  const page = await gget<{ access_token?: string }>(pageId, creds, { fields: "access_token" });
  if (!page.access_token) {
    throw new Error(
      "Meta no entregó el token de la página. El usuario conectado necesita acceso a la página con los permisos pages_manage_ads, pages_read_engagement y leads_retrieval."
    );
  }
  return { token: page.access_token, appSecret: creds.appSecret };
}

export type ExistingForm = { id: string; name: string; status: string; locale?: string; created_time?: string };

export async function listLeadForms(adAccountId: string, pageId: string): Promise<ExistingForm[]> {
  const creds = await pageCreds(adAccountId, pageId);
  return gall<ExistingForm>(`${pageId}/leadgen_forms`, creds, { fields: "id,name,status,locale,created_time" }, 200);
}

/** Creates the form on the Page and returns its id. Forms can't be edited after creation in Meta. */
export async function createLeadForm(adAccountId: string, pageId: string, config: LeadFormConfig): Promise<string> {
  const creds = await pageCreds(adAccountId, pageId);
  const res = await gpost<{ id: string }>(`${pageId}/leadgen_forms`, creds, buildLeadFormPayload(config) as Parameters<typeof gpost>[2]);
  if (!res.id) throw new Error("Meta no devolvió el id del formulario.");
  return res.id;
}

/** Makes sure the ad account can deliver lead ads for this Page (Meta's Lead Ads ToS must be accepted). */
export async function leadgenTosAccepted(adAccountId: string, pageId: string): Promise<boolean | null> {
  try {
    const creds = await pageCreds(adAccountId, pageId);
    const r = await gget<{ leadgen_tos_accepted?: boolean }>(pageId, creds, { fields: "leadgen_tos_accepted" });
    return typeof r.leadgen_tos_accepted === "boolean" ? r.leadgen_tos_accepted : null;
  } catch {
    return null;
  }
}
