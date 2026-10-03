"use client";

import { useEffect, useRef } from "react";
import type HanziWriter from "hanzi-writer";
import type { CharacterJson } from "hanzi-writer";

export type StrokeProgress = { phase: "idle" | "loading" | "playing" | "complete" | "error"; stroke: number; total: number; error?: string };
const dataCache = new Map<string, CharacterJson>();
const outlineColor = (color: string) => `rgba(${[1, 3, 5].map(start => parseInt(color.slice(start, start + 2), 16)).join(",")},0.13)`;

export function StrokeAnimation({ char, run, size, color, paused, visible, onProgress, onFinish }: {
  char: string; run: number; size: number; color: string; paused: boolean; visible: boolean;
  onProgress: (progress: StrokeProgress) => void; onFinish: (progress: StrokeProgress) => void;
}) {
  const target = useRef<SVGGElement>(null);
  const writer = useRef<HanziWriter | null>(null);
  const data = useRef<CharacterJson | null>(null);
  const pause = useRef(paused);
  const resume = useRef<(() => void) | null>(null);
  const appearance = useRef({ size, color });
  pause.current = paused; appearance.current = { size, color };

  useEffect(() => {
    if (!run) return;
    let cancelled = false;
    const controller = new AbortController();
    const waitForResume = () => pause.current ? new Promise<void>(resolve => { resume.current = resolve; }) : Promise.resolve();
    async function play() {
      try {
        onProgress({ phase: "loading", stroke: 0, total: 0 });
        const [module, characterData] = await Promise.all([
          import("hanzi-writer"),
          dataCache.get(char) || fetch(`/api/strokes/${encodeURIComponent(char)}`, { signal: controller.signal }).then(async response => {
            if (!response.ok) throw new Error(response.status === 404 ? `暂无「${char}」的笔顺数据` : "笔顺加载失败，请重试");
            const result: CharacterJson = await response.json();
            dataCache.set(char, result); return result;
          }),
        ]);
        if (cancelled || !target.current) return;
        data.current = characterData;
        const options = appearance.current;
        // Reuse one writer: each instance installs document pointer listeners.
        writer.current ||= new module.default(target.current as unknown as HTMLElement, {
          width: 1000, height: 1000, padding: (1000 - options.size * 10) / 2,
          showCharacter: false, showOutline: true, strokeColor: options.color, outlineColor: outlineColor(options.color),
          strokeAnimationSpeed: 1.3, strokeFadeDuration: 0, charDataLoader: () => data.current!,
        });
        await writer.current.setCharacter(char);
        const total = characterData.strokes.length;
        for (let stroke = 0; stroke < total; stroke++) {
          await waitForResume();
          if (cancelled) return;
          onProgress({ phase: "playing", stroke: stroke + 1, total });
          await writer.current.animateStroke(stroke);
          if (cancelled) return;
          await new Promise(resolve => setTimeout(resolve, stroke === total - 1 ? 600 : 220));
        }
        await waitForResume();
        if (!cancelled) onFinish({ phase: "complete", stroke: total, total });
      } catch (error) {
        if (!cancelled) onFinish({ phase: "error", stroke: 0, total: 0, error: error instanceof Error ? error.message : "笔顺加载失败，请重试" });
      }
    }
    void play();
    return () => {
      cancelled = true; controller.abort(); resume.current?.(); resume.current = null;
      void writer.current?.hideCharacter({ duration: 0 });
    };
  }, [char, run, onProgress, onFinish]);

  useEffect(() => {
    if (paused) void writer.current?.pauseAnimation();
    else { resume.current?.(); resume.current = null; void writer.current?.resumeAnimation(); }
  }, [paused]);
  useEffect(() => {
    writer.current?.updateDimensions({ width: 1000, height: 1000, padding: (1000 - size * 10) / 2 });
    void writer.current?.updateColor("strokeColor", color, { duration: 0 });
    void writer.current?.updateColor("outlineColor", outlineColor(color), { duration: 0 });
  }, [size, color]);

  return <svg viewBox="0 0 1000 1000" className={`practice-cell stroke-animation${visible ? " is-active" : ""}`} aria-hidden={!visible} role="img" aria-label={`${char}的楷书笔顺演示`} data-testid="stroke-animation"><g ref={target} /></svg>;
}
