import { db } from "../db";

export type Totals = {
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  conversations: number;
  leads: number;
  purchases: number;
  purchaseValue: number;
  results: number;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  cpa: number | null;
  roas: number | null;
};

export type Row = {
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  conversations: number;
  leads: number;
  purchases: number;
  purchaseValue: number;
};

export const emptyRow = (): Row => ({ spend: 0, impressions: 0, reach: 0, clicks: 0, conversations: 0, leads: 0, purchases: 0, purchaseValue: 0 });

export function addRow(a: Row, b: Row): Row {
  return {
    spend: a.spend + b.spend,
    impressions: a.impressions + b.impressions,
    // reach diario no es aditivo entre días; se suma como aproximación y se etiqueta así en la UI
    reach: a.reach + b.reach,
    clicks: a.clicks + b.clicks,
    conversations: a.conversations + b.conversations,
    leads: a.leads + b.leads,
    purchases: a.purchases + b.purchases,
    purchaseValue: a.purchaseValue + b.purchaseValue,
  };
}

export function totals(r: Row): Totals {
  const results = r.conversations + r.leads + r.purchases;
  return {
    ...r,
    results,
    ctr: r.impressions ? (r.clicks / r.impressions) * 100 : null,
    cpc: r.clicks ? r.spend / r.clicks : null,
    cpm: r.impressions ? (r.spend / r.impressions) * 1000 : null,
    cpa: results ? r.spend / results : null,
    roas: r.spend && r.purchaseValue ? r.purchaseValue / r.spend : null,
  };
}

export type Period = { from: Date; to: Date };

export function periodFromDays(days: number): { cur: Period; prev: Period } {
  const to = new Date();
  to.setUTCHours(0, 0, 0, 0);
  const from = new Date(to.getTime() - (days - 1) * 86400000);
  const prevTo = new Date(from.getTime() - 86400000);
  const prevFrom = new Date(prevTo.getTime() - (days - 1) * 86400000);
  return { cur: { from, to }, prev: { from: prevFrom, to: prevTo } };
}

/** Restricción por campaña: cuenta -> campañas atribuidas al cliente (solo en cuentas compartidas). */
export type CampaignScope = Record<string, string[]>;

/** adAccountIds permitidos: siempre derivados de la organización de la sesión */
export async function orgAccountIds(orgId: string, clientId?: string): Promise<string[]> {
  if (clientId) {
    const links = await db.clientMetaLink.findMany({ where: { clientId, client: { orgId } } });
    return links.map((l) => l.adAccountId);
  }
  const accs = await db.metaAdAccount.findMany({ where: { connection: { orgId } }, select: { id: true } });
  return accs.map((a) => a.id);
}

/**
 * Alcance de un cliente: sus cuentas y, si una cuenta la comparten varios clientes,
 * solo las campañas que se le asignaron. Una cuenta compartida sin campañas asignadas no aporta datos
 * (no se atribuye por adivinación).
 */
export async function clientScope(orgId: string, clientId: string): Promise<{ accountIds: string[]; scope: CampaignScope }> {
  const links = await db.clientMetaLink.findMany({ where: { clientId, client: { orgId } } });
  const accountIds = links.map((l) => l.adAccountId);
  const scope: CampaignScope = {};
  for (const accId of accountIds) {
    const others = await db.clientMetaLink.count({ where: { adAccountId: accId, clientId: { not: clientId } } });
    if (others > 0) {
      const camps = await db.metaEntity.findMany({ where: { adAccountId: accId, level: "campaign", clientId }, select: { metaId: true } });
      scope[accId] = camps.map((c) => c.metaId);
    }
  }
  return { accountIds, scope };
}

export async function fetchRows(accountIds: string[], p: Period, scope?: CampaignScope) {
  if (!accountIds.length) return [];
  const date = { gte: p.from, lte: p.to };
  const restricted = scope ? Object.keys(scope).filter((a) => accountIds.includes(a)) : [];
  if (!restricted.length) return db.insightSnapshot.findMany({ where: { adAccountId: { in: accountIds }, date } });
  const free = accountIds.filter((a) => !restricted.includes(a));
  return db.insightSnapshot.findMany({
    where: {
      date,
      OR: [
        ...(free.length ? [{ adAccountId: { in: free } }] : []),
        ...restricted.map((a) => ({ adAccountId: a, campaignId: { in: scope![a] } })),
      ],
    },
  });
}

export function sumRows(rows: Row[]): Row {
  return rows.reduce(addRow, emptyRow());
}

export function groupBy<T extends Row & Record<string, any>>(rows: T[], key: (r: T) => string) {
  const m = new Map<string, Row>();
  for (const r of rows) {
    const k = key(r);
    m.set(k, addRow(m.get(k) ?? emptyRow(), r));
  }
  return m;
}
