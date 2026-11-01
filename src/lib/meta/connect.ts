import { db } from "../db";
import { decrypt, encrypt } from "../crypto";
import { getSetting } from "../settings";
import { GRAPH, GRAPH_VERSION, MetaCreds, MetaError, appCreds, gall, gget, normAct } from "./graph";

export const REQUIRED_SCOPES = ["ads_management", "ads_read", "business_management", "pages_show_list", "pages_read_engagement"];
export const OPTIONAL_SCOPES = ["instagram_basic", "pages_manage_ads", "whatsapp_business_management", "leads_retrieval"];

export async function oauthUrl(orgId: string, state: string) {
  const appId = await getSetting(orgId, "META_APP_ID");
  if (!appId) throw new Error("META_APP_ID no configurado");
  const redirect = `${process.env.APP_URL}/api/meta/callback`;
  const scope = [...REQUIRED_SCOPES, ...OPTIONAL_SCOPES].join(",");
  return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(
    redirect
  )}&state=${state}&scope=${scope}&auth_type=rerequest`;
}

export async function exchangeCode(orgId: string, code: string) {
  const appId = await getSetting(orgId, "META_APP_ID");
  const secret = await getSetting(orgId, "META_APP_SECRET");
  if (!appId || !secret) throw new Error("META_APP_ID / META_APP_SECRET no configurados");
  const redirect = `${process.env.APP_URL}/api/meta/callback`;
  const short = await (
    await fetch(
      `${GRAPH}/oauth/access_token?client_id=${appId}&client_secret=${secret}&redirect_uri=${encodeURIComponent(redirect)}&code=${code}`
    )
  ).json();
  if (short.error) throw new MetaError(short.error.message);
  const long = await (
    await fetch(
      `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${secret}&fb_exchange_token=${short.access_token}`
    )
  ).json();
  if (long.error) throw new MetaError(long.error.message);
  return { token: long.access_token as string, expiresIn: long.expires_in as number | undefined };
}

/** Guarda una conexión (OAuth o token manual) tras verificar permisos reales. */
export async function saveConnection(orgId: string, label: string, method: "oauth" | "token", token: string, expiresIn?: number) {
  const creds = await appCreds(orgId, token);
  const me = await gget<{ id: string; name: string }>("me", creds, { fields: "id,name" });
  const perms = await gget<{ data: { permission: string; status: string }[] }>("me/permissions", creds);
  const granted = perms.data.filter((p) => p.status === "granted").map((p) => p.permission);
  const declined = perms.data.filter((p) => p.status !== "granted").map((p) => p.permission);
  const conn = await db.metaConnection.create({
    data: {
      orgId,
      label,
      method,
      metaUserId: me.id,
      metaUserName: me.name,
      tokenEnc: encrypt(token),
      tokenExpiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
      grantedScopes: granted,
      declinedScopes: declined,
      lastCheckedAt: new Date(),
    },
  });
  await discoverAdAccounts(conn.id);
  return conn;
}

export async function credsFor(connectionId: string): Promise<{ creds: MetaCreds; orgId: string }> {
  const c = await db.metaConnection.findUniqueOrThrow({ where: { id: connectionId } });
  return { creds: await appCreds(c.orgId, decrypt(c.tokenEnc)), orgId: c.orgId };
}

/** Re-verifica permisos reales contra Meta */
export async function refreshPermissions(connectionId: string) {
  const { creds } = await credsFor(connectionId);
  try {
    const perms = await gget<{ data: { permission: string; status: string }[] }>("me/permissions", creds);
    await db.metaConnection.update({
      where: { id: connectionId },
      data: {
        grantedScopes: perms.data.filter((p) => p.status === "granted").map((p) => p.permission),
        declinedScopes: perms.data.filter((p) => p.status !== "granted").map((p) => p.permission),
        status: "ACTIVE",
        lastError: null,
        lastCheckedAt: new Date(),
      },
    });
  } catch (e: any) {
    await db.metaConnection.update({
      where: { id: connectionId },
      data: { status: e.code === 190 ? "EXPIRED" : "ERROR", lastError: e.message, lastCheckedAt: new Date() },
    });
    throw e;
  }
}

/** Cuentas publicitarias accesibles: directas + de negocios (propias y de clientes) */
export async function discoverAdAccounts(connectionId: string) {
  const { creds } = await credsFor(connectionId);
  const fields = "id,account_id,name,currency,timezone_name,account_status,balance,amount_spent";
  const found = new Map<string, any>();
  const add = (a: any) => a?.id && found.set(a.id, a);

  const direct = await gall("me/adaccounts", creds, { fields });
  direct.forEach(add);
  try {
    const biz = await gall<{ id: string }>("me/businesses", creds, { fields: "id,name" });
    for (const b of biz) {
      for (const edge of ["owned_ad_accounts", "client_ad_accounts"]) {
        try {
          (await gall(`${b.id}/${edge}`, creds, { fields })).forEach(add);
        } catch {
          /* sin permiso en ese negocio: se ignora, no se asume */
        }
      }
    }
  } catch {
    /* sin business_management */
  }

  for (const a of found.values()) {
    await db.metaAdAccount.upsert({
      where: { connectionId_actId: { connectionId, actId: normAct(a.id) } },
      update: { name: a.name, currency: a.currency, timezone: a.timezone_name, status: a.account_status, balance: a.balance, amountSpent: a.amount_spent },
      create: { connectionId, actId: normAct(a.id), name: a.name, currency: a.currency, timezone: a.timezone_name, status: a.account_status, balance: a.balance, amountSpent: a.amount_spent },
    });
  }
  return found.size;
}

/** Verifica activos REALMENTE disponibles para la cuenta (nunca se asumen vinculados). */
export async function verifyAccountAssets(adAccountId: string) {
  const acc = await db.metaAdAccount.findUniqueOrThrow({ where: { id: adAccountId } });
  const { creds } = await credsFor(acc.connectionId);
  const errors: string[] = [];
  const safe = async <T,>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn();
    } catch (e: any) {
      errors.push(`${label}: ${e.message}`);
      return fallback;
    }
  };

  const pages = await safe("páginas", async () => {
    const list = await gall<any>(`${acc.actId}/promote_pages`, creds, { fields: "id,name" });
    const out: any[] = [];
    for (const p of list) {
      let igId: string | undefined;
      try {
        const ig = await gget<any>(p.id, creds, { fields: "instagram_business_account{id,username}" });
        igId = ig.instagram_business_account?.id;
      } catch {
        /* sin acceso al IG de esa página */
      }
      out.push({ id: p.id, name: p.name, igId });
    }
    return out;
  }, [] as any[]);

  const igAccounts = await safe("instagram", async () => {
    const list = await gall<any>(`${acc.actId}/instagram_accounts`, creds, { fields: "id,username" });
    return list.map((i) => ({ id: i.id, username: i.username }));
  }, [] as any[]);

  const pixels = await safe("pixels", async () => {
    const list = await gall<any>(`${acc.actId}/adspixels`, creds, { fields: "id,name" });
    return list.map((p) => ({ id: p.id, name: p.name }));
  }, [] as any[]);

  const audiences = await safe("audiencias", async () => {
    const list = await gall<any>(`${acc.actId}/customaudiences`, creds, { fields: "id,name,subtype,approximate_count_lower_bound" }, 300);
    return list.map((a) => ({ id: a.id, name: a.name, subtype: a.subtype, approxSize: a.approximate_count_lower_bound }));
  }, [] as any[]);

  await db.metaAdAccount.update({
    where: { id: adAccountId },
    data: { pages, igAccounts, pixels, audiences, assetsCheckedAt: new Date(), assetsError: errors.length ? errors.join(" | ") : null },
  });
  return { pages: pages.length, igAccounts: igAccounts.length, pixels: pixels.length, audiences: audiences.length, errors };
}
