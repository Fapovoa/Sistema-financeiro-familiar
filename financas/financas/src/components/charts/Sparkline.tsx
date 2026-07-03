"use client";

/** Mini gráfico dos cards de KPI (barras ou área), no estilo do dashboard de referência. */
export function Sparkline({ data, kind = "area" }: { data: number[]; kind?: "bars" | "area" }) {
  const w = 84, h = 36;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const norm = (v: number) => h - ((v - min) / (max - min || 1)) * (h - 4) - 2;

  if (kind === "bars") {
    const bw = w / data.length - 3;
    return (
      <svg width={w} height={h} className="text-brand-500">
        {data.map((v, i) => {
          const y = norm(v);
          return <rect key={i} x={i * (bw + 3)} y={y} width={bw} height={h - y} rx={2} fill="currentColor" opacity={0.85} />;
        })}
      </svg>
    );
  }
  const step = w / (data.length - 1);
  const pts = data.map((v, i) => `${i * step},${norm(v)}`).join(" ");
  return (
    <svg width={w} height={h} className="text-brand-500">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
      <polygon points={`0,${h} ${pts} ${w},${h}`} fill="currentColor" opacity={0.12} />
    </svg>
  );
}
