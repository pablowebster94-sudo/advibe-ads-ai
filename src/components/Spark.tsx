/** Barras diarias simples en SVG (sin dependencias). Solo datos reales recibidos. */
export function Bars({ data, labels, height = 80 }: { data: number[]; labels?: string[]; height?: number }) {
  if (!data.length) return null;
  const max = Math.max(...data, 0.0001);
  const w = 100 / data.length;
  return (
    <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }} role="img" aria-label="Gráfico diario">
      {data.map((v, i) => {
        const h = (v / max) * (height - 4);
        return (
          <rect key={i} x={i * w + w * 0.15} y={height - h} width={w * 0.7} height={h} rx={0.6} className="fill-brand-500/70">
            <title>{`${labels?.[i] ?? i + 1}: ${v.toFixed(2)}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}
