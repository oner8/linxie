"use client";

import { useEffect, useRef } from "react";
import type Artplayer from "artplayer";

export type VideoState = { phase: "idle" | "loading" | "playing" | "complete" | "error"; paused?: boolean; error?: string };

// The recordings are wide shots whose writing cell sits at a known spot. Enlarge that
// square until it covers the cell, so the character fills the practice grid.
function applyCrop(video: HTMLVideoElement, host: HTMLElement, [cx, cy, half]: [number, number, number]) {
  const side = host.clientWidth;
  const width = video.videoWidth, height = video.videoHeight;
  if (!side || !width || !height) return;
  // `half` is the square's half-size as a percentage of frame height (the unit the
  // annotation tool records). Convert to pixels, then scale so the square fills the cell.
  const px = (Math.min(half, 50) / 100) * height;
  const halfX = (px / width) * 100;
  const left = Math.min(Math.max(cx - halfX, 0), Math.max(0, 100 - halfX * 2));
  const top = Math.min(Math.max(cy - (px / height) * 100, 0), Math.max(0, 100 - (px / height) * 200));
  const scale = side / (px * 2);
  Object.assign(video.style, {
    position: "absolute",
    objectFit: "fill",
    maxWidth: "none",
    maxHeight: "none",
    width: `${width * scale}px`,
    height: `${height * scale}px`,
    left: `${-(left / 100) * width * scale}px`,
    top: `${-(top / 100) * height * scale}px`,
  });
}

export function VideoPlayer({ char, run, active, onState }: {
  char: string; run: number; active: boolean; onState: (state: VideoState) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<Artplayer | null>(null);
  const report = useRef(onState);
  report.current = onState;

  useEffect(() => {
    if (!run) return;
    let cancelled = false;
    const controller = new AbortController();
    async function play() {
      try {
        report.current({ phase: "loading" });
        const [module, meta] = await Promise.all([import("artplayer"), fetch(`/api/videos/${encodeURIComponent(char)}`, { signal: controller.signal }).then(async response => {
          if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "示范视频暂时不可用");
          return response.json() as Promise<{ start: number; end: number; crop?: [number, number, number] }>;
        })]);
        if (cancelled || !host.current) return;
        // artplayer defaults to double-tap on touch devices; a single tap is what people expect here.
        module.default.MOBILE_CLICK_PLAY = true;
        module.default.MOBILE_DBCLICK_PLAY = false;
        const art = new module.default({
          container: host.current,
          url: `/api/videos/${encodeURIComponent(char)}/stream`,
          type: "mp4",
          autoplay: true,
          muted: true,
          // A clip ends where the next character begins, so it wraps by hand.
          loop: false,
          // The clip is silent and short; the control bar is hidden by CSS instead.
          setting: false,
          playbackRate: false,
          aspectRatio: false,
          fullscreen: false,
          pip: false,
          miniProgressBar: true,
          airplay: false,
          theme: getComputedStyle(document.documentElement).getPropertyValue("--primary").trim() || "#b64d3d",
          cssVar: { "--art-background-color": "transparent" },
        });
        player.current = art;
        art.on("video:play", () => { if (!cancelled) report.current({ phase: "playing", paused: false }); });
        art.on("video:pause", () => { if (!cancelled) report.current({ phase: "playing", paused: true }); });
        art.on("video:error", () => { if (!cancelled) report.current({ phase: "error", error: "视频加载失败，请重试" }); });

        if (meta.crop) {
          const crop = meta.crop;
          const fit = () => applyCrop(art.video, host.current!, crop);
          art.video.addEventListener("loadedmetadata", fit, { once: true });
          // Re-apply once artplayer finishes sizing its own container.
          art.on("ready", () => requestAnimationFrame(fit));
        }

        {
          const { start, end } = meta;
          const seekToStart = () => { art.video.currentTime = start; };
          art.on("ready", seekToStart);
          art.video.addEventListener("loadedmetadata", seekToStart, { once: true });
          // Wrap at the next character's start instead of playing into it.
          art.video.addEventListener("timeupdate", () => {
            if (art.video.currentTime >= end) seekToStart();
          });
        }
      } catch (error) {
        if (!cancelled) report.current({ phase: "error", error: error instanceof Error ? error.message : "视频加载失败，请重试" });
      }
    }
    void play();
    return () => {
      cancelled = true; controller.abort();
      player.current?.destroy(false); player.current = null;
    };
  }, [char, run]);

  // Tapping the picture pauses and resumes: artplayer already toggles on click.
  return <div ref={host} className={`video-player${active ? " is-active" : ""} is-wide`} aria-hidden={!active} data-testid="video-player" />;
}
