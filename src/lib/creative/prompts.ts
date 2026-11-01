/** Prompts que protegen el producto real. */
export const FIDELITY_RULES = `REGLAS ESTRICTAS: la(s) imagen(es) de referencia contienen el producto real. Conserva el producto EXACTAMENTE: misma forma, color, textura, proporciones, detalles, costuras y marcas. No lo rediseñes, no cambies su modelo ni añadas/quites elementos. No dibujes texto, logos ni precios (se añaden aparte). Solo crea la escena y la iluminación alrededor.`;

export function scenePrompt(opts: { scene: string; format: string; brand?: string }) {
  return `${FIDELITY_RULES}\nEscena: ${opts.scene}. Composición pensada para anuncio ${opts.format} con espacio libre arriba y abajo. Fotografía publicitaria realista, luz natural suave. Marca: ${opts.brand ?? "n/d"}.`;
}

export function backgroundPrompt(opts: { scene: string; format: string; colors: string[] }) {
  return `Genera SOLO un fondo/escenario publicitario vacío (sin producto, sin texto, sin logos, sin personas): ${opts.scene}. Paleta sugerida: ${opts.colors.join(", ") || "neutra"}. Deja el centro despejado para colocar un producto. Formato ${opts.format}.`;
}
