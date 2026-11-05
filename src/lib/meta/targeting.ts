import { db } from "../db";
import { credsFor } from "./connect";
import { gget } from "./graph";

export type InterestHit = { id: string; name: string; audience_size_lower_bound?: number; path?: string[] };
export type GeoHit = {
  key: string;
  name: string;
  type: string;
  country_code?: string;
  country_name?: string;
  region?: string;
  region_id?: number;
  supports_city?: boolean;
  supports_region?: boolean;
};

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

/**
 * Ubicaciones reales de Meta (claves válidas para targeting.geo_locations).
 * `countryCode` limita la búsqueda a un país (p. ej. "EC") para no confundir
 * Cuenca (Ecuador) con Cuenca (España).
 */
export async function searchGeo(
  adAccountId: string,
  q: string,
  opts: { types?: ("country" | "region" | "city")[]; countryCode?: string } = {}
): Promise<GeoHit[]> {
  const c = await creds(adAccountId);
  const r = await gget<{ data: GeoHit[] }>("search", c, {
    type: "adgeolocation",
    q,
    location_types: opts.types ?? ["city", "region", "country"],
    country_code: opts.countryCode,
    limit: 10,
  });
  const hits = r.data || [];
  return opts.countryCode ? hits.filter((h) => !h.country_code || h.country_code === opts.countryCode) : hits;
}
