import { useMemo } from "react";

type Props = { points: { t: number; price: number }[]; height?: number; id?: string };

export function PriceChart({ points, height = 200, id = "chart" }: Props) {
  const gradId = `grad-${id}`;
  const width = 800;
  const pad = 10;

  const rendered = useMemo(() => {
    if (points.length === 0) return null;

    // Pad single point into a flat line
    const pts = points.length === 1
      ? [{ ...points[0], t: points[0].t - 1 }, points[0]]
      : points;

    const prices = pts.map(p => p.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min || prices[0] * 0.01 || 1; // small range shows subtle slope

    const xs = pts.map((_, i) => (i / (pts.length - 1)) * width);
    const ys = pts.map(p => height - ((p.price - min) / range) * (height - pad * 2) - pad);

    const path = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${ys[i].toFixed(2)}`).join(" ");
    const area = `${path} L${width},${height} L0,${height} Z`;
    const up = prices[prices.length - 1] >= prices[0];
    // Green when the price is up over the window, red when down — matches the buy/sell palette.
    const stroke = up ? "oklch(0.74 0.16 150)" : "oklch(0.64 0.21 25)";
    const lastX = xs[xs.length - 1];
    const lastY = ys[ys.length - 1];

    return { path, area, stroke, up, lastX, lastY };
  }, [points, height]);

  if (!rendered) {
    return <div style={{ height }} className="flex items-center justify-center text-mono-xs text-muted-foreground">No trade data yet</div>;
  }

  const { path, area, stroke, lastX, lastY } = rendered;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ height }} className="w-full">
      <defs>
        <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.2" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      <path d={path} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {/* Live dot at the current price */}
      <circle cx={lastX} cy={lastY} r="4" fill={stroke} />
      <circle cx={lastX} cy={lastY} r="8" fill={stroke} fillOpacity="0.2" />
    </svg>
  );
}
