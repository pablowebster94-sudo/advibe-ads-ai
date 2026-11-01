import { appSecretProof } from "../crypto";
import { getSetting } from "../settings";

export const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v23.0";
export const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

export class MetaError extends Error {
  code?: number;
  subcode?: number;
  fbtraceId?: string;
  constructor(message: string, o?: { code?: number; subcode?: number; fbtraceId?: string }) {
    super(message);
    this.code = o?.code;
    this.subcode = o?.subcode;
    this.fbtraceId = o?.fbtraceId;
  }
}

export type MetaCreds = { token: string; appSecret?: string };

type Params = Record<string, string | number | boolean | undefined | null | object>;

function encodeParams(p: Params): URLSearchParams {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined || v === null) continue;
    u.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  }
  return u;
}

async function parse(res: Response) {
  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || json.error) {
    const e = json.error || {};
    throw new MetaError(e.error_user_msg || e.message || `Meta HTTP ${res.status}`, {
      code: e.code,
      subcode: e.error_subcode,
      fbtraceId: e.fbtrace_id,
    });
  }
  return json;
}

function auth(creds: MetaCreds, p: Params): Params {
  const out: Params = { ...p, access_token: creds.token };
  if (creds.appSecret) out.appsecret_proof = appSecretProof(creds.token, creds.appSecret);
  return out;
}

export async function gget<T = any>(path: string, creds: MetaCreds, params: Params = {}): Promise<T> {
  const url = `${GRAPH}/${path.replace(/^\//, "")}?${encodeParams(auth(creds, params))}`;
  return parse(await fetch(url, { cache: "no-store" }));
}

export async function gpost<T = any>(path: string, creds: MetaCreds, params: Params = {}): Promise<T> {
  const res = await fetch(`${GRAPH}/${path.replace(/^\//, "")}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: encodeParams(auth(creds, params)),
    cache: "no-store",
  });
  return parse(res);
}

/** Sigue paginación `paging.next` hasta `max` elementos */
export async function gall<T = any>(path: string, creds: MetaCreds, params: Params = {}, max = 2000): Promise<T[]> {
  const out: T[] = [];
  let json = await gget<{ data: T[]; paging?: { next?: string } }>(path, creds, { limit: 200, ...params });
  out.push(...(json.data || []));
  while (json.paging?.next && out.length < max) {
    json = await parse(await fetch(json.paging.next, { cache: "no-store" }));
    out.push(...(json.data || []));
  }
  return out;
}

export async function appCreds(orgId: string, token: string): Promise<MetaCreds> {
  const appSecret = await getSetting(orgId, "META_APP_SECRET");
  return { token, appSecret: appSecret || undefined };
}

export const normAct = (id: string) => (id.startsWith("act_") ? id : `act_${id}`);
