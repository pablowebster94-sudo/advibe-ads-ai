import { ImageResponse } from "next/og";
import { readFile } from "fs/promises";
import path from "path";

export const FORMATS: Record<string, { w: number; h: number }> = {
  "1:1": { w: 1080, h: 1080 },
  "4:5": { w: 1080, h: 1350 },
  "9:16": { w: 1080, h: 1920 },
};

export type ComposeInput = {
  format: keyof typeof FORMATS | string;
  /** Foto real del producto: NUNCA se modifica, solo se coloca/escala */
  product?: { data: Buffer; mime: string };
  /** Fondo (generado por IA o color). Si falta, usa degradado de marca */
  background?: { data: Buffer; mime: string };
  /** Si la IA ya produjo la escena completa (modo ai_scene), se usa tal cual como lienzo */
  fullScene?: boolean;
  logo?: { data: Buffer; mime: string };
  title?: string;
  price?: string;
  badges?: string[];
  cta?: string;
  colors: { primary: string; secondary: string; text: string };
};

const uri = (b: { data: Buffer; mime: string }) => `data:${b.mime};base64,${b.data.toString("base64")}`;

let fontCache: Promise<{ regular: Buffer; bold: Buffer }> | null = null;
function fonts() {
  fontCache ??= (async () => {
    const dir = path.join(process.cwd(), "node_modules/@fontsource/montserrat/files");
    const [regular, bold] = await Promise.all([
      readFile(path.join(dir, "montserrat-latin-500-normal.woff")),
      readFile(path.join(dir, "montserrat-latin-800-normal.woff")),
    ]);
    return { regular, bold };
  })();
  return fontCache;
}

export async function composeCreative(i: ComposeInput): Promise<Buffer> {
  const f = FORMATS[i.format] || FORMATS["1:1"];
  const fnt = await fonts();
  const { primary, secondary, text } = i.colors;
  const story = f.h > f.w * 1.5;
  const pad = 56;

  const bg = i.background ? uri(i.background) : null;
  const showProduct = !!i.product && !i.fullScene;

  const el = (
    <div style={{ width: f.w, height: f.h, display: "flex", position: "relative", fontFamily: "Montserrat", background: `linear-gradient(160deg, ${primary}, ${secondary})` }}>
      {bg && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={bg} width={f.w} height={f.h} style={{ position: "absolute", left: 0, top: 0, objectFit: "cover" }} alt="" />
      )}
      {showProduct && i.product && (
        <div style={{ position: "absolute", left: pad, right: pad, top: story ? 360 : 200, bottom: story ? 420 : 230, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={uri(i.product)} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 24, boxShadow: "0 30px 80px rgba(0,0,0,.35)" }} alt="" />
        </div>
      )}
      <div style={{ position: "absolute", left: pad, right: pad, top: pad, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        {i.logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={uri(i.logo)} height={story ? 110 : 90} style={{ objectFit: "contain" }} alt="" />
        ) : (
          <div style={{ display: "flex" }} />
        )}
        <div style={{ display: "flex", gap: 10 }}>
          {(i.badges || []).slice(0, 2).map((b, k) => (
            <div key={k} style={{ display: "flex", background: text, color: primary, padding: "10px 20px", borderRadius: 999, fontSize: 26, fontWeight: 800 }}>
              {b}
            </div>
          ))}
        </div>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: `40px ${pad}px ${pad}px`, display: "flex", flexDirection: "column", background: "linear-gradient(0deg, rgba(0,0,0,.78), rgba(0,0,0,0))", gap: 18 }}>
        {i.title && <div style={{ display: "flex", color: "#fff", fontSize: story ? 78 : 64, fontWeight: 800, lineHeight: 1.05 }}>{i.title}</div>}
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          {i.price && <div style={{ display: "flex", color: "#fff", fontSize: story ? 72 : 60, fontWeight: 800 }}>{i.price}</div>}
          {i.cta && (
            <div style={{ display: "flex", background: text, color: primary, padding: "16px 34px", borderRadius: 999, fontSize: 32, fontWeight: 800 }}>{i.cta}</div>
          )}
        </div>
      </div>
    </div>
  );

  const res = new ImageResponse(el, {
    width: f.w,
    height: f.h,
    fonts: [
      { name: "Montserrat", data: fnt.regular, weight: 500, style: "normal" },
      { name: "Montserrat", data: fnt.bold, weight: 800, style: "normal" },
    ],
  });
  return Buffer.from(await res.arrayBuffer());
}
