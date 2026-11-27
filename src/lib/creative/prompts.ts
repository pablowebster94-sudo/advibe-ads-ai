/** Prompts publicitarios y reglas de fidelidad del producto. */
import { buildCreativeBrief, type CreativeDirection, type CreativeObjective } from "./director";

export const FIDELITY_RULES = `REGLAS ESTRICTAS: la(s) imagen(es) de referencia contienen el producto real. Conserva el producto EXACTAMENTE: misma forma, color, textura, proporciones, detalles, costuras y marcas. No lo rediseñes, no cambies su modelo ni añadas/quites elementos. No dibujes texto, logos ni precios (se añaden aparte). Solo crea la escena y la iluminación alrededor.`;

export function scenePrompt(opts: { scene: string; format: string; brand?: string; direction?: CreativeDirection; objective?: CreativeObjective; audience?: string }) {
  return buildCreativeBrief({ ...opts, mode: "ai_scene" });
}

export function backgroundPrompt(opts: { scene: string; format: string; colors: string[]; direction?: CreativeDirection; objective?: CreativeObjective; audience?: string }) {
  return `${buildCreativeBrief({ ...opts, mode: "ai_background" })}\nPaleta sugerida: ${opts.colors.join(", ") || "neutra"}.`;
}

const SIZE_HINT: Record<string, string> = { "1:1": "cuadrada 1:1 (1080x1080)", "4:5": "vertical 4:5 (1080x1350)", "9:16": "vertical 9:16 (1080x1920, historia/reel)" };

/** Prompt listo para pegar en ChatGPT u otra IA externa (no consume créditos de la API). */
export function externalPrompt(opts: {
  mode: "ai_scene" | "ai_background";
  scene: string;
  format: string;
  brand?: string;
  colors?: string[];
  industry?: string;
  direction?: CreativeDirection;
  objective?: CreativeObjective;
  audience?: string;
}) {
  const size = SIZE_HINT[opts.format] ?? opts.format;
  return `${buildCreativeBrief({ ...opts, format: size, mode: opts.mode })}\n${opts.industry ? `Sector: ${opts.industry}.\n` : ""}${opts.colors?.length ? `Paleta de marca: ${opts.colors.join(", ")}.\n` : ""}${opts.mode === "ai_background" ? "Entrega únicamente el fondo vacío, sin producto ni personas." : "Usa la foto de referencia adjunta y conserva el producto fiel; si no puedes mantenerlo idéntico, deja la escena preparada para que la foto original se monte encima."}`;
}
