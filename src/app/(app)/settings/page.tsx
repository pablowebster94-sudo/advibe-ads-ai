import { requireSession, canAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { back, str } from "@/lib/actions-util";
import { SECRET_KEYS, SETTING_KEYS, SettingKey, setSetting, settingsStatus, getSetting } from "@/lib/settings";
import { Notice, PageHeader, StatusBadge } from "@/components/ui";

async function save(f: FormData) {
  "use server";
  const s = await requireSession();
  if (!canAdmin(s.role)) back("/settings", "error", "Solo administradores.");
  const changed: string[] = [];
  for (const k of SETTING_KEYS) {
    const v = str(f, k);
    const clear = f.get(`clear_${k}`) === "on";
    if (clear) {
      await setSetting(s.orgId, k, "");
      changed.push(`${k}:borrada`);
    } else if (v) {
      await setSetting(s.orgId, k, v);
      changed.push(k);
    }
  }
  await audit(s, "settings.update", undefined, { keys: changed }); // nunca se registran valores
  back("/settings", "ok", changed.length ? "Configuración guardada (cifrada)." : "Sin cambios.");
}

const SECRET_LABEL: Record<string, string> = {
  GEMINI_API_KEY: "Gemini API key",
  OPENAI_API_KEY: "OpenAI API key",
  ANTHROPIC_API_KEY: "Anthropic API key",
  META_APP_SECRET: "Meta App Secret",
};

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const s = await requireSession();
  const sp = await searchParams;
  const st = await settingsStatus(s.orgId);
  const imageProvider = await getSetting(s.orgId, "IMAGE_PROVIDER");
  const textProvider = await getSetting(s.orgId, "TEXT_PROVIDER");
  const envOk = {
    DATABASE_URL: !!process.env.DATABASE_URL,
    SESSION_SECRET: !!process.env.SESSION_SECRET,
    ENCRYPTION_KEY: !!process.env.ENCRYPTION_KEY,
    APP_URL: !!process.env.APP_URL,
    CRON_SECRET: !!process.env.CRON_SECRET,
  };
  return (
    <div className="space-y-6">
      <PageHeader title="Configuración y seguridad" subtitle="Las claves se guardan cifradas (AES-256-GCM) y nunca se muestran de nuevo. Las variables de entorno del servidor tienen prioridad como respaldo." />
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      {sp.ok && <Notice kind="ok">{sp.ok}</Notice>}

      <section className="card">
        <h2 className="mb-2 font-semibold text-white">Estado del entorno</h2>
        <div className="flex flex-wrap gap-2 text-xs">
          {Object.entries(envOk).map(([k, v]) => (
            <span key={k} className={`badge ${v ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300"}`}>{v ? "✓" : "✗"} {k}</span>
          ))}
        </div>
      </section>

      <form action={save} className="card grid gap-4 sm:grid-cols-2">
        <h2 className="sm:col-span-2 font-semibold text-white">Proveedores de IA</h2>
        <div>
          <label className="label">Proveedor de imágenes</label>
          <select name="IMAGE_PROVIDER" defaultValue={imageProvider} className="input"><option value="gemini">Gemini</option><option value="openai">OpenAI (gpt-image)</option></select>
        </div>
        <div>
          <label className="label">Proveedor de texto (estrategia y copies)</label>
          <select name="TEXT_PROVIDER" defaultValue={textProvider} className="input"><option value="anthropic">Anthropic (Claude)</option><option value="gemini">Gemini</option><option value="openai">OpenAI</option></select>
        </div>
        {(["GEMINI_IMAGE_MODEL", "OPENAI_IMAGE_MODEL", "GEMINI_TEXT_MODEL", "ANTHROPIC_TEXT_MODEL", "OPENAI_TEXT_MODEL"] as SettingKey[]).map((k) => (
          <div key={k}><label className="label">{k}</label><input name={k} placeholder={st[k].configured ? "(configurado; escribe para cambiar)" : ""} className="input" /></div>
        ))}

        <h2 className="sm:col-span-2 mt-2 font-semibold text-white">Credenciales</h2>
        {SECRET_KEYS.map((k) => (
          <div key={k}>
            <label className="label">{SECRET_LABEL[k]} <StatusBadge s={st[k].configured ? "OK" : "PENDING"} /> <span className="normal-case text-zinc-500">{st[k].configured ? `origen: ${st[k].source}` : "pendiente"}</span></label>
            <input name={k} type="password" autoComplete="off" className="input" placeholder={st[k].configured ? "•••• (escribe para reemplazar)" : "Pegar clave"} />
            {st[k].source === "db" && <label className="mt-1 flex items-center gap-2 text-xs text-zinc-400"><input type="checkbox" name={`clear_${k}`} /> Borrar clave guardada</label>}
          </div>
        ))}
        <div>
          <label className="label">Meta App ID <StatusBadge s={st.META_APP_ID.configured ? "OK" : "PENDING"} /></label>
          <input name="META_APP_ID" className="input" placeholder={st.META_APP_ID.configured ? "(configurado)" : "ID de la app"} />
        </div>
        <div className="sm:col-span-2"><button className="btn">Guardar configuración</button></div>
      </form>
    </div>
  );
}
