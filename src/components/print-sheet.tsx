"use client";
import { PracticeCell } from "./practice-cell";
import type { GridId } from "@/lib/practice";

// Printed sheet: one cell per character, one character per row, no tracing copies.
export function PrintSheet({ chars, family, grid, size, opacity, lineColor, textColor }: {
  chars: string[]; family?: string; grid: GridId; size: number; opacity: number; lineColor: string; textColor: string;
}) {
  if (!family || !chars.length) return null;
  // Fewer characters leave more page height, so each cell can grow; three per page is the
  // most that fits at a comfortable size.
  const cell = chars.length >= 3 ? 82 : chars.length === 2 ? 118 : 150;
  return <section className="print-sheet" aria-hidden="true" data-testid="print-sheet">
    <div className="print-grid" style={{ "--print-cell": `${cell}mm` } as React.CSSProperties}>
      {chars.map((char, index) => <div className="print-group" key={`${char}-${index}`}>
        <PracticeCell char={char} family={family} grid={grid} size={size} opacity={opacity}
          lineColor={lineColor} textColor={textColor} />
      </div>)}
    </div>
  </section>;
}
