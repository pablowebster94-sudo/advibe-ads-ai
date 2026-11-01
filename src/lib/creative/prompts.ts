/** Prompts que protegen el producto real. */
export const FIDELITY_RULES = `REGLAS ESTRICTAS: la(s) imagen(es) de referencia contienen el producto real. Conserva el producto EXACTAMENTE: misma forma, color, textura, proporciones, detalles, costuras y marcas. No lo rediseñes, no cambies su modelo ni añadas/quites elementos. No dibujes texto, logos ni precios (se añaden aparte). Solo crea la escena y la iluminación alrededor.`;

export function scenePrompt(opts: { scene: string; format: string; brand?: string }) {
  return `${FIDELITY_RULES}\nEscena: ${opts.scene}. Composición pensada para anuncio ${opts.format} con espacio libre arriba y abajo. Fotografía publicitaria realista, luz natural suave. Marca: ${opts.brand ?? "n/d"}.`;
}

export function backgroundPrompt(opts: { scene: string; format: string; colors: string[] }) {
  return `Genera SOLO un fondo/escenario publicitario vacío (sin producto, sin texto, sin logos, sin personas): ${opts.scene}. Paleta sugerida: ${opts.colors.join(", ") || "neutra"}. Deja el centro despejado para colocar un producto. Formato ${opts.format}.`;
}

const SIZE_HINT: Record<string, string> = { "1:1": "cuadrada 1:1 (1080x1080)", "4:5": "vertical 4:5 (1080x1350)", "9:16": "vertical 9:16 (1080x1920, historia/reel)" };

/** Prompt listo para pegar en ChatGPT u otra IA externa (no consume créditos de la API de la plataforma). */
export function externalPrompt(opts: {
  mode: "ai_scene" | "ai_background";
  scene: string;
  format: string;
  brand?: string;
  colors?: string[];
  industry?: string;
}) {
  const size = SIZE_HINT[opts.format] ?? opts.format;
  if (opts.mode === "ai_background") {
    return `Genera SOLO un fondo/escenario publicitario vacío, sin producto, sin texto, sin logos y sin personas: ${opts.scene}. Imagen ${size}. Paleta sugerida: ${opts.colors?.length ? opts.colors.join(", ") : "neutra"}. Deja el centro despejado para colocar un producto después, y espacio libre arriba y abajo para texto. Fotografía publicitaria realista, luz natural suave.`;
  }
  return `Te adjunto la foto REAL de mi producto. Conserva el producto EXACTAMENTE como en la foto: misma forma, color, textura, proporciones, detalles, costuras y marcas. No lo rediseñes, no cambies su modelo ni añadas o quites elementos. No dibujes texto, logos ni precios en la imagen. Solo crea la escena y la iluminación alrededor.
Escena: ${opts.scene}.
Imagen ${size} para anuncio de ${opts.brand ?? "mi marca"}${opts.industry ? ` (${opts.industry})` : ""}, con espacio libre arriba y abajo para añadir texto después. Fotografía publicitaria realista, luz natural suave.${opts.colors?.length ? ` Paleta sugerida: ${opts.colors.join(", ")}.` : ""}`;
}
