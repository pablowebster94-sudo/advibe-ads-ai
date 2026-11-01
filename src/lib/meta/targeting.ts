import { db } from "../db";
import { credsFor } from "./connect";
import { gget } from "./graph";

export type InterestHit = { id: string; name: string; audience_size_lower_bound?: number; path?: string[] };
export type GeoHit = { key: string; name: string; type: string; country_code?: string; region?: string };

async function creds(adAccountId: string) {
  const acc = await db.metaAdAccount.findUniqueOrThrow({ where: { id: adAccountId } });
  return (await credsFor(acc.connectionId)).creds;
}

/** Intereses reales de Meta (IDs válidos). */
export async function searchInterests(adAccountId: string, q: string): Promise<InterestHit[]> {
  const c = await creds(adAccountId);
  const r = await gget<{ data: InterestHit[] }>("search", c, { type: "adinterest", q, limit: 8 });
  return r.data || [];
}

export async function searchGeo(adAccountId: string, q: string): Promise<GeoHit[]> {
  const c = await creds(adAccountId);
  const r = await gget<{ data: GeoHit[] }>("search", c, { type: "adgeolocation", q, location_types: ["city", "region", "country"], limit: 8 });
  return r.data || [];
}
