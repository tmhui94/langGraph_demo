import { useEffect, useState } from "react";

export type Band = "HIGH" | "MEDIUM" | "LOW";

export const bandColor = (band?: Band) =>
  band === "HIGH" ? "var(--high)" : band === "MEDIUM" ? "var(--medium)" : "var(--low)";

export const bandFor = (score: number): Band => (score >= 80 ? "HIGH" : score >= 60 ? "MEDIUM" : "LOW");

/** A ring that fills to the score. Without a score it shows an empty track, or a spinner while scoring. */
export default function ScoreRing({ score, category, scoring = false, size = 44 }: {
  score?: number; category?: Band; scoring?: boolean; size?: number;
}) {
  const stroke = Math.max(4, Math.round(size / 11));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const [shown, setShown] = useState(0);

  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(score ?? 0));
    return () => cancelAnimationFrame(id);
  }, [score]);

  const color = bandColor(category ?? (score !== undefined ? bandFor(score) : undefined));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img"
      aria-label={score !== undefined ? `Score ${Math.round(score)} out of 100` : scoring ? "Scoring" : "Not scored yet"}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke}
        strokeDasharray={scoring && score === undefined ? `${c / 8} ${c / 8}` : undefined}
        className={scoring && score === undefined ? "spin" : undefined} />
      {score !== undefined && (
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={`${(c * shown) / 100} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dasharray 0.9s ease-out" }} />
      )}
      {score !== undefined && (
        <text x="50%" y="50%" dy="0.35em" textAnchor="middle" fill="var(--ink)"
          style={{ font: `700 ${Math.round(size * 0.32)}px var(--display)` }}>
          {Math.round(score)}
        </text>
      )}
    </svg>
  );
}
