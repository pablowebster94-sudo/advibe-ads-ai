export type CreativeDirection = "premium" | "commercial" | "editorial" | "minimal" | "cinematic" | "lifestyle";
export type CreativeObjective = "conversion" | "awareness" | "engagement" | "branding";

export const CREATIVE_DIRECTIONS: Record<CreativeDirection, { label: string; guidance: string }> = {
  premium: { label: "Premium", guidance: "Art direction sofisticada, pocos elementos, materiales y acabados de alta gama, luz controlada, composición refinada y mucho espacio negativo. Evita clichés de lujo." },
  commercial: { label: "Comercial / Performance", guidance: "Producto protagonista, contraste fuerte, lectura instantánea, composición directa y zonas despejadas para oferta y CTA. Energía visual sin saturación." },
  editorial: { label: "Editorial", guidance: "Composición de revista, fotografía de campaña, encuadre intencional, tipografía que se añadirá después y narrativa visual elegante." },
  minimal: { label: "Minimalista", guidance: "Máximo un elemento visual dominante, fondo limpio, geometría sencilla, paleta limitada, espacios amplios y cero decoración innecesaria." },
  cinematic: { label: "Cinematográfico", guidance: "Iluminación de película, profundidad atmosférica, contraste cuidado, separación del sujeto, reflejos realistas y narrativa visual; no sacrifiques claridad comercial." },
  lifestyle: { label: "Lifestyle / Real", guidance: "Escena cotidiana creíble, ambiente auténtico, luz natural, contexto útil para entender el uso del producto y estética de fotografía profesional, no stock genérico." },
};

const OBJECTIVES: Record<CreativeObjective, string> = {
  conversion: "Prioriza comprensión rápida de la oferta, producto protagonista, jerarquía clara y espacio para CTA.",
  awareness: "Prioriza una imagen memorable, reconocimiento de marca y un concepto visual distintivo; no sobrecargues de texto.",
  engagement: "Prioriza un concepto que genere curiosidad o identificación y que se entienda sin explicación larga.",
  branding: "Prioriza consistencia de identidad, códigos visuales de marca y percepción; evita mensajes promocionales innecesarios.",
};

export function buildCreativeBrief(opts: {
  scene: string;
  format: string;
  brand?: string;
  direction?: CreativeDirection;
  objective?: CreativeObjective;
  audience?: string;
  mode?: "ai_scene" | "ai_background";
}) {
  const direction = CREATIVE_DIRECTIONS[opts.direction ?? "commercial"];
  const objective = OBJECTIVES[opts.objective ?? "conversion"];
  const mode = opts.mode ?? "ai_scene";
  const isBackground = mode === "ai_background";
  return [
    "DIRECTOR CREATIVO DE AD VIBE — BRIEF DE PRODUCCIÓN",
    `Marca: ${opts.brand || "no especificada"}`,
    `Formato: ${opts.format}`,
    `Concepto / escena: ${opts.scene}`,
    `Dirección visual: ${direction.label}. ${direction.guidance}`,
    `Objetivo: ${objective}`,
    opts.audience?.trim() ? `Audiencia: ${opts.audience.trim()}` : "",
    "COMPOSICIÓN: crea un solo punto focal dominante; reserva una zona limpia para el titular y otra para elementos de oferta/CTA que serán añadidos posteriormente. Evita texto en la imagen, logos generados, marcas de agua, interfaces falsas, sellos inventados y elementos decorativos sin función.",
    isBackground ? "ENTREGABLE: únicamente escenario/fondo. No incluir producto, personas, texto, logo ni objetos que distraigan. Mantén espacio útil para montar el producto real después." : "FIDELIDAD: la referencia contiene un producto real. No lo rediseñes ni alteres forma, modelo, color, textura, proporciones, piezas, marcas, accesorios o detalles. No inventes características. El producto debe ser reconocible e idéntico; crea únicamente ambiente, escena y luz. Si la fidelidad exacta no puede garantizarse, favorece una composición de fondo que permita superponer la fotografía original.",
    "CALIDAD: fotografía publicitaria profesional, iluminación físicamente plausible, materiales realistas, anatomía natural si aparecen personas, bordes limpios, sin duplicaciones ni artefactos. Evita la estética genérica de IA, exceso de glow, saturación, bokeh artificial y renders plásticos.",
    "No escribas ningún texto dentro de la imagen. Los textos, precios, CTA y logos se integran posteriormente con composición tipográfica real.",
  ].filter(Boolean).join("\n");
}

export type QualityCheck = { id: string; label: string; required: boolean; pass: boolean; note?: string };
export function creativeQualityChecks(input: {
  title?: string;
  price?: string;
  cta?: string;
  format?: string;
  hasProductReference?: boolean;
  aiScene?: boolean;
}) {
  const title = (input.title ?? "").trim();
  const price = (input.price ?? "").trim();
  return [
    { id: "copy", label: "Titular breve y legible", required: false, pass: !title || title.length <= 60, note: title.length > 60 ? "Reduce el titular a 60 caracteres." : undefined },
    { id: "offer", label: "Precio / oferta exactos", required: Boolean(price), pass: true, note: "Verifica contra el brief del cliente antes de publicar." },
    { id: "cta", label: "CTA claro", required: false, pass: !input.cta || input.cta.trim().length <= 28, note: input.cta && input.cta.trim().length > 28 ? "Usa un CTA más corto." : undefined },
    { id: "format", label: "Formato seleccionado", required: true, pass: ["1:1", "4:5", "9:16"].includes(input.format ?? ""), note: "Usa 1:1, 4:5 o 9:16." },
    { id: "product", label: "Producto fiel a la foto original", required: Boolean(input.hasProductReference), pass: !input.aiScene, note: input.aiScene ? "Revisión visual humana obligatoria: forma, modelo, color, detalles y proporciones." : undefined },
    { id: "brand", label: "Logo y branding correctos", required: false, pass: true, note: "Confirma que el logo original no fue alterado y que la paleta coincide." },
    { id: "text", label: "Texto sin errores ni elementos inventados", required: false, pass: true, note: "Revisa ortografía, precios, beneficios y datos comerciales." },
  ] satisfies QualityCheck[];
}
