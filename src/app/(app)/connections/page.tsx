import Link from "next/link";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { back, str, writer } from "@/lib/actions-util";
import { getSetting } from "@/lib/settings";
import { OPTIONAL_SCOPES, REQUIRED_SCOPES, discoverAdAccounts, refreshPermissions, saveConnection, verifyAccountAssets } from "@/lib/meta/connect";
import { syncAdAccount } from "@/lib/meta/sync";
import { Empty, Notice, PageHeader, Pending, StatusBadge } from "@/components/ui";

async function connectToken(f: FormData) {
  "use server";
  const s = await writer();
  const token = str(f, "token");
  let msg = "";
  try {
    const c = await saveConnection(s.orgId, str(f, "label") || "Token de usuario del sistema", "token", token);
    await audit(s, "meta.connect.token", c.id, { user: c.metaUserName });
  } catch (e: any) {
    msg = e.message;
  }
  if (msg) back("/connections", "error", `Meta rechazó el token: ${msg}`);
  back("/connections", "ok", "Token validado y conexión creada.");
}

async function verify(f: FormData) {
  "use server";
  const s = await writer();
  const id = str(f, "accountId");
  const acc = await db.metaAdAccount.findFirst({ where: { id, connection: { orgId: s.orgId } } });
  if (!acc) back("/connections", "error", "Cuenta no encontrada.");
  let msg = "";
  try {
    await refreshPermissions(acc!.connectionId);
    const r = await verifyAccountAssets(id);
    await audit(s, "meta.verify", id, r);
  } catch (e: any) {
    msg = e.message;
  }
  if (msg) back("/connections", "error", `Verificación falló: ${msg}`);
  back("/connections", "ok", "Activos verificados con la API de Meta.");
}

async function sync(f: FormData) {
  "use server";
  const s = await writer();
  const id = str(f, "accountId");
  const acc = await db.metaAdAccount.findFirst({ where: { id, connection: { orgId: s.orgId } } });
  if (!acc) back("/connections", "error", "Cuenta no encontrada.");
  let msg = "";
  let n = 0;
  try {
    n = (await syncAdAccount(id, 30)).insights;
    await audit(s, "meta.sync", id, { rows: n });
  } catch (e: any) {
    msg = e.message;
  }
  if (msg) back("/connections", "error", `Sincronización falló: ${msg}`);
  back("/connections", "ok", `Sincronizado: ${n} filas de resultados reales (últimos 30 días).`);
}

async function rediscover(f: FormData) {
  "use server";
  const s = await writer();
  const id = str(f, "connectionId");
  const conn = await db.metaConnection.findFirst({ where: { id, orgId: s.orgId } });
  if (!conn) back("/connections", "error", "Conexión no encontrada.");
  let msg = "";
  try {
    await refreshPermissions(id);
    await discoverAdAccounts(id);
  } catch (e: any) {
    msg = e.message;
  }
  if (msg) back("/connections", "error", msg);
  back("/connections", "ok", "Permisos y cuentas actualizados.");
}

async function remove(f: FormData) {
  "use server";
  const s = await writer();
  const id = str(f, "connectionId");
  await db.metaConnection.deleteMany({ where: { id, orgId: s.orgId } });
  await audit(s, "meta.disconnect", id);
  back("/connections", "ok", "Conexión eliminada (token borrado).");
}

export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const s = await requireSession();
  const sp = await searchParams;
  const appId = await getSetting(s.orgId, "META_APP_ID");
  const conns = await db.metaConnection.findMany({ where: { orgId: s.orgId }, orderBy: { createdAt: "desc" }, include: { adAccounts: { orderBy: { name: "asc" } } } });

  return (
    <div className="space-y-6">
      <PageHeader title="Conexiones Meta" subtitle="Cuentas publicitarias, páginas, Instagram, pixels y públicos. Todo se verifica contra la API: nada se asume vinculado." />
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      {sp.ok && <Notice kind="ok">{sp.ok}</Notice>}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card space-y-3">
          <h2 className="font-semibold text-white">Opción A · Iniciar sesión con Meta (OAuth)</h2>
          {appId ? (
            <>
              <p className="text-sm text-zinc-400">Permisos solicitados: {[...REQUIRED_SCOPES, ...OPTIONAL_SCOPES].join(", ")}. URI de redirección a registrar en tu app: <code className="text-zinc-200">{process.env.APP_URL}/api/meta/callback</code></p>
              <Link href="/api/meta/start" prefetch={false} className="btn">Conectar con Meta</Link>
            </>
          ) : (
            <Pending title="app de Meta sin configurar">Falta META_APP_ID y META_APP_SECRET (Configuración o variables de entorno). Crea una app en developers.facebook.com con el producto Marketing API. Para operar tus propias cuentas basta el modo desarrollo; para otras agencias se requiere App Review (ads_management, ads_read, business_management).</Pending>
          )}
        </div>
        <form action={connectToken} className="card space-y-3">
          <h2 className="font-semibold text-white">Opción B · Token de usuario del sistema</h2>
          <p className="text-sm text-zinc-400">Genera un token en Business Settings → Usuarios del sistema con ads_management, ads_read y business_management. Se valida con Meta y se guarda cifrado.</p>
          <input name="label" className="input" placeholder="Etiqueta (ej. Token AdVibe)" />
          <input name="token" type="password" className="input" placeholder="Token de acceso" required autoComplete="off" />
          <button className="btn">Validar y conectar</button>
        </form>
      </div>

      {conns.length === 0 ? (
        <Empty>Sin conexiones. Conecta con cualquiera de las dos opciones. Esperadas: <b>Imperio Barber Studio</b> y <b>AdVibe Agencia</b>.</Empty>
      ) : (
        conns.map((c) => (
          <section key={c.id} className="card space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-semibold text-white">{c.label} <StatusBadge s={c.status} /></div>
                <div className="text-xs text-zinc-400">{c.metaUserName} · {c.method === "oauth" ? "OAuth" : "Token"} · verificado {c.lastCheckedAt?.toLocaleString("es") ?? "nunca"}{c.tokenExpiresAt ? ` · expira ${c.tokenExpiresAt.toLocaleDateString("es")}` : ""}</div>
                {c.lastError && <div className="text-xs text-red-300">{c.lastError}</div>}
              </div>
              <div className="flex gap-2">
                <form action={rediscover}><input type="hidden" name="connectionId" value={c.id} /><button className="btn-ghost">Re-verificar permisos</button></form>
                <form action={remove}><input type="hidden" name="connectionId" value={c.id} /><button className="btn-danger">Desconectar</button></form>
              </div>
            </div>
            <div className="text-xs">
              <div className="mb-1 text-zinc-400">Permisos reales concedidos por Meta:</div>
              <div className="flex flex-wrap gap-1">
                {[...REQUIRED_SCOPES, ...OPTIONAL_SCOPES].map((p) => (
                  <span key={p} className={`badge ${c.grantedScopes.includes(p) ? "bg-emerald-500/15 text-emerald-300" : REQUIRED_SCOPES.includes(p) ? "bg-red-500/15 text-red-300" : "bg-white/10 text-zinc-400"}`}>
                    {c.grantedScopes.includes(p) ? "✓" : "✗"} {p}
                  </span>
                ))}
              </div>
            </div>
            {c.adAccounts.length === 0 ? (
              <Notice>Meta no devolvió cuentas publicitarias para este token. Revisa que el usuario tenga acceso a las cuentas (Business Settings → Cuentas publicitarias).</Notice>
            ) : (
              <div className="space-y-3">
                {c.adAccounts.map((a) => {
                  const pages = (a.pages as any[]) || [];
                  const igs = (a.igAccounts as any[]) || [];
                  const pixels = (a.pixels as any[]) || [];
                  const auds = (a.audiences as any[]) || [];
                  return (
                    <div key={a.id} className="rounded-xl border border-white/5 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="font-medium text-white">{a.name} <span className="text-xs text-zinc-400">{a.actId} · {a.currency} · {a.timezone}</span></div>
                          <div className="text-xs text-zinc-400">Sincronizada: {a.syncedAt?.toLocaleString("es") ?? "nunca"} {a.lastSyncError && <span className="text-red-300">· {a.lastSyncError}</span>}</div>
                        </div>
                        <div className="flex gap-2">
                          <form action={verify}><input type="hidden" name="accountId" value={a.id} /><button className="btn-ghost">Verificar activos</button></form>
                          <form action={sync}><input type="hidden" name="accountId" value={a.id} /><button className="btn">Sincronizar</button></form>
                        </div>
                      </div>
                      {a.assetsCheckedAt ? (
                        <div className="mt-3 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
                          <Assets title="Páginas" rows={pages.map((p) => `${p.name} · ${p.id}${p.igId ? ` · IG ${p.igId}` : ""}`)} />
                          <Assets title="Instagram" rows={igs.map((i) => `@${i.username} · ${i.id}`)} />
                          <Assets title="Pixels / datasets" rows={pixels.map((p) => `${p.name} · ${p.id}`)} />
                          <Assets title="Públicos personalizados" rows={auds.map((x) => `${x.name} (${x.subtype})`)} />
                          {a.assetsError && <div className="sm:col-span-4 text-red-300">Parcial: {a.assetsError}</div>}
                        </div>
                      ) : (
                        <div className="mt-2 text-xs text-amber-300">Activos sin verificar todavía.</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        ))
      )}
    </div>
  );
}

function Assets({ title, rows }: { title: string; rows: string[] }) {
  return (
    <div>
      <div className="mb-1 font-medium text-zinc-300">{title} ({rows.length})</div>
      {rows.length === 0 ? <div className="text-zinc-500">Ninguno disponible según Meta.</div> : <ul className="space-y-0.5 text-zinc-400">{rows.slice(0, 8).map((r, i) => <li key={i} className="truncate">{r}</li>)}{rows.length > 8 && <li>… y {rows.length - 8} más</li>}</ul>}
    </div>
  );
}
