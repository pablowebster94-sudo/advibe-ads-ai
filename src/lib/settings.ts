import { db } from "./db";
import { decrypt, encrypt } from "./crypto";

export const SETTING_KEYS = [
  "GEMINI_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "META_APP_ID",
  "META_APP_SECRET",
  "IMAGE_PROVIDER", // gemini | openai
  "TEXT_PROVIDER", // anthropic | gemini | openai
  "GEMINI_IMAGE_MODEL",
  "OPENAI_IMAGE_MODEL",
  "GEMINI_TEXT_MODEL",
  "ANTHROPIC_TEXT_MODEL",
  "OPENAI_TEXT_MODEL",
] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

export const SECRET_KEYS: SettingKey[] = ["GEMINI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "META_APP_SECRET"];

export const DEFAULTS: Partial<Record<SettingKey, string>> = {
  IMAGE_PROVIDER: "gemini",
  TEXT_PROVIDER: "anthropic",
  GEMINI_IMAGE_MODEL: "gemini-3.1-flash-image",
  OPENAI_IMAGE_MODEL: "gpt-image-2",
  GEMINI_TEXT_MODEL: "gemini-2.5-flash",
  ANTHROPIC_TEXT_MODEL: "claude-sonnet-5-5",
  OPENAI_TEXT_MODEL: "gpt-4.1",
};

/** DB (cifrado) > variable de entorno > default */
export async function getSetting(orgId: string, key: SettingKey): Promise<string | undefined> {
  const row = await db.setting.findUnique({ where: { orgId_key: { orgId, key } } });
  if (row) {
    try {
      const v = decrypt(row.valueEnc);
      if (v) return v;
    } catch {
      /* clave de cifrado cambiada: cae al entorno */
    }
  }
  return process.env[key] || DEFAULTS[key];
}

export async function setSetting(orgId: string, key: SettingKey, value: string) {
  if (!value) {
    await db.setting.deleteMany({ where: { orgId, key } });
    return;
  }
  const valueEnc = encrypt(value);
  await db.setting.upsert({
    where: { orgId_key: { orgId, key } },
    update: { valueEnc },
    create: { orgId, key, valueEnc },
  });
}

/** Estado sin exponer valores */
export async function settingsStatus(orgId: string) {
  const rows = await db.setting.findMany({ where: { orgId } });
  const inDb = new Set(rows.map((r) => r.key));
  const out: Record<string, { configured: boolean; source: "db" | "env" | "default" | "none" }> = {};
  for (const k of SETTING_KEYS) {
    if (inDb.has(k)) out[k] = { configured: true, source: "db" };
    else if (process.env[k]) out[k] = { configured: true, source: "env" };
    else if (DEFAULTS[k]) out[k] = { configured: true, source: "default" };
    else out[k] = { configured: false, source: "none" };
  }
  return out;
}
