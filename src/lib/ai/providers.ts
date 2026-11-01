import { getSetting } from "../settings";

export class ProviderNotConfigured extends Error {}

export type ImageInput = { data: Buffer; mimeType: string };
export type ImageResult = { data: Buffer; mimeType: string; provider: string };

const ratioToSize: Record<string, string> = { "1:1": "1024x1024", "4:5": "1024x1536", "9:16": "1024x1536" };

/** Genera una imagen con IA. Si hay referencias, la IA debe conservar el producto intacto. */
export async function generateImage(orgId: string, prompt: string, refs: ImageInput[], aspect: string): Promise<ImageResult> {
  const provider = (await getSetting(orgId, "IMAGE_PROVIDER")) || "gemini";
  if (provider === "openai") {
    const key = await getSetting(orgId, "OPENAI_API_KEY");
    if (!key) throw new ProviderNotConfigured("OPENAI_API_KEY no configurada (Configuración).");
    const model = (await getSetting(orgId, "OPENAI_IMAGE_MODEL")) || "gpt-image-2";
    let res: Response;
    if (refs.length) {
      const form = new FormData();
      form.set("model", model);
      form.set("prompt", prompt);
      form.set("size", ratioToSize[aspect] || "1024x1024");
      refs.forEach((r, i) => form.append("image[]", new Blob([new Uint8Array(r.data)], { type: r.mimeType }), `ref${i}.png`));
      res = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form });
    } else {
      res = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt, size: ratioToSize[aspect] || "1024x1024" }),
      });
    }
    const j: any = await res.json();
    if (!res.ok) throw new Error(j.error?.message || `OpenAI HTTP ${res.status}`);
    const b64 = j.data?.[0]?.b64_json;
    if (!b64) throw new Error("OpenAI no devolvió imagen.");
    return { data: Buffer.from(b64, "base64"), mimeType: "image/png", provider: `openai:${model}` };
  }

  const key = await getSetting(orgId, "GEMINI_API_KEY");
  if (!key) throw new ProviderNotConfigured("GEMINI_API_KEY no configurada (Configuración).");
  const model = (await getSetting(orgId, "GEMINI_IMAGE_MODEL")) || "gemini-3.1-flash-image";
  const parts: any[] = [{ text: prompt }];
  for (const r of refs) parts.push({ inline_data: { mime_type: r.mimeType, data: r.data.toString("base64") } });
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: aspect === "4:5" ? "4:5" : aspect === "9:16" ? "9:16" : "1:1" } },
    }),
  });
  const j: any = await res.json();
  if (!res.ok) throw new Error(j.error?.message || `Gemini HTTP ${res.status}`);
  const img = j.candidates?.[0]?.content?.parts?.find((p: any) => p.inline_data || p.inlineData);
  const d = img?.inline_data || img?.inlineData;
  if (!d?.data) throw new Error("Gemini no devolvió imagen (posible bloqueo de seguridad).");
  return { data: Buffer.from(d.data, "base64"), mimeType: d.mime_type || d.mimeType || "image/png", provider: `gemini:${model}` };
}

/** Texto (JSON o libre) con el proveedor configurado. */
export async function generateText(orgId: string, system: string, user: string, json = false): Promise<{ text: string; provider: string }> {
  const provider = (await getSetting(orgId, "TEXT_PROVIDER")) || "anthropic";
  if (provider === "openai") {
    const key = await getSetting(orgId, "OPENAI_API_KEY");
    if (!key) throw new ProviderNotConfigured("OPENAI_API_KEY no configurada.");
    const model = (await getSetting(orgId, "OPENAI_TEXT_MODEL")) || "gpt-4.1";
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "system", content: system }, { role: "user", content: user }], ...(json ? { response_format: { type: "json_object" } } : {}) }),
    });
    const j: any = await res.json();
    if (!res.ok) throw new Error(j.error?.message || `OpenAI HTTP ${res.status}`);
    return { text: j.choices[0].message.content, provider: `openai:${model}` };
  }
  if (provider === "gemini") {
    const key = await getSetting(orgId, "GEMINI_API_KEY");
    if (!key) throw new ProviderNotConfigured("GEMINI_API_KEY no configurada.");
    const model = (await getSetting(orgId, "GEMINI_TEXT_MODEL")) || "gemini-2.5-flash";
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        ...(json ? { generationConfig: { responseMimeType: "application/json" } } : {}),
      }),
    });
    const j: any = await res.json();
    if (!res.ok) throw new Error(j.error?.message || `Gemini HTTP ${res.status}`);
    return { text: j.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? "", provider: `gemini:${model}` };
  }
  const key = await getSetting(orgId, "ANTHROPIC_API_KEY");
  if (!key) throw new ProviderNotConfigured("ANTHROPIC_API_KEY no configurada.");
  const model = (await getSetting(orgId, "ANTHROPIC_TEXT_MODEL")) || "claude-sonnet-5-5";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ model, max_tokens: 4096, system, messages: [{ role: "user", content: user }] }),
  });
  const j: any = await res.json();
  if (!res.ok) throw new Error(j.error?.message || `Anthropic HTTP ${res.status}`);
  return { text: j.content?.map((c: any) => c.text).join("") ?? "", provider: `anthropic:${model}` };
}

export function parseJson<T>(text: string): T {
  const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!m) throw new Error("La IA no devolvió JSON válido.");
  return JSON.parse(m[0]) as T;
}
