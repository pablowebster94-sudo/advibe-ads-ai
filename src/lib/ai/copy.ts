import { db } from "../db";
import { generateText, parseJson } from "./providers";
import { POLICY_NOTE } from "./strategy";

export type CopyVariant = { headline: string; primaryText: string; description: string; cta: string };

export async function generateCopy(orgId: string, clientId: string, product: string, angle: string, n = 3): Promise<CopyVariant[]> {
  const c = await db.client.findFirstOrThrow({ where: { id: clientId, orgId } });
  const sys = `Eres copywriter de performance para Meta Ads en español. ${POLICY_NOTE} Responde SOLO JSON: {"variants":[{"headline","primaryText","description","cta"}]}. headline ≤40 caracteres, primaryText ≤125 visibles, cta uno de: LEARN_MORE, SHOP_NOW, CONTACT_US, WHATSAPP_MESSAGE, SEND_MESSAGE, GET_QUOTE, SIGN_UP, BOOK_TRAVEL. No inventes precios, descuentos ni garantías que no estén en los datos.`;
  const user = `Marca: ${c.name}. Voz: ${c.voice ?? "cercana y clara"}. Industria: ${c.industry ?? ""}. Producto/oferta: ${product}. Ángulo: ${angle}. Genera ${n} variantes distintas para prueba A/B.`;
  const { text } = await generateText(orgId, sys, user, true);
  return parseJson<{ variants: CopyVariant[] }>(text).variants;
}
