"use client";
import { useMemo } from "react";
import { GRIDS, type GridId } from "@/lib/practice";

export function GridLines({ grid, opacity = 0.45, color = "var(--grid-line)" }: { grid: GridId; opacity?: number; color?: string }) {
  const g = GRIDS.find(g => g.id === grid)!;
  return <g fill="none" stroke={color} opacity={opacity}>
    <rect x="2" y="2" width="996" height="996" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
    <g strokeWidth="1" strokeDasharray="3 3">
      {g.cross && <><path d="M500 2V998" vectorEffect="non-scaling-stroke" /><path d="M2 500H998" vectorEffect="non-scaling-stroke" /></>}
      {g.diagonal && <><path d="M2 2L998 998" vectorEffect="non-scaling-stroke" /><path d="M998 2L2 998" vectorEffect="non-scaling-stroke" /></>}
      {g.inner && <rect x="250" y="250" width="500" height="500" vectorEffect="non-scaling-stroke" />}
    </g>
  </g>;
}

export function PracticeCell({ char, family, size, opacity, grid, lineColor, textColor, hideCharacter }: { char?: string; family?: string; size: number; opacity: number; grid: GridId; lineColor: string; textColor: string; hideCharacter?: boolean }) {
  const metrics = useMemo(() => {
    if (!family || !char || typeof document === "undefined") return null;
    const context = document.createElement("canvas").getContext("2d")!;
    context.font = `1000px "${family}"`;
    context.textRendering = "geometricPrecision";
    return context.measureText(char);
  }, [char, family]);
  let scale = size / 100;
  if (metrics) scale = Math.min(scale, 950 / Math.max(1, metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight), 950 / Math.max(1, metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent));
  return <svg className="practice-cell" viewBox="0 0 1000 1000" role="img" aria-label={char ? `${char}，${GRIDS.find(g => g.id === grid)!.name}` : "等待字体加载"} aria-hidden={hideCharacter || undefined} data-testid="practice-cell">
    <rect width="1000" height="1000" fill="var(--card)" />
    <GridLines grid={grid} opacity={opacity / 100} color={lineColor} />
    {metrics && !hideCharacter && <text x={500 - (metrics.actualBoundingBoxRight - metrics.actualBoundingBoxLeft) * scale / 2} y={500 + (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) * scale / 2} fontFamily={family} fontSize={1000 * scale} fill={textColor} style={{ fontSynthesis: "none", textRendering: "geometricPrecision" }}>{char}</text>}
  </svg>;
}
