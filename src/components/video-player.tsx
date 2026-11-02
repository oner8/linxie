"use client";

import { useEffect, useRef } from "react";
import type Artplayer from "artplayer";

export type VideoState = { phase: "idle" | "loading" | "playing" | "complete" | "error"; paused?: boolean; error?: string };

// The recordings are wide shots whose writing cell sits at a known spot. Enlarge that
// square until it covers the cell, so the character fills the practice grid.
function applyCrop(video: HTMLVideoElement, host: HTMLElement, [cx, cy, half]: [number, number, number]) {
  // Always a square: a wide stage must not stretch the video into 16:9.
  const side = Math.min(host.clientWidth, host.clientHeight);
  const width = video.videoWidth, height = video.videoHeight;
  if (!side || !width || !height) return false;
  // `half` is the crop square's half-size as a percentage of frame height.
  const boxPx = (Math.min(half, 50) / 100) * height * 2;
  const halfWidthPct = ((boxPx / 2) / width) * 100;
  const halfHeightPct = (boxPx / 2 / height) * 100;
  // Keep the square inside the frame so the cell is never clipped away.
  const left = Math.min(Math.max(cx - halfWidthPct, 0), Math.max(0, 100 - halfWidthPct * 2));
  const top = Math.min(Math.max(cy - halfHeightPct, 0), Math.max(0, 100 - halfHeightPct * 2));
  // Scale the whole frame so the crop square is exactly one cell wide and tall.
  const scale = side / boxPx;
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
  return true;
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
    const cleanups: Array<() => void> = [];
    async function play() {
      try {
        report.current({ phase: "loading" });
        const [module, meta] = await Promise.all([import("artplayer"), fetch(`/api/videos/${encodeURIComponent(char)}`, { signal: controller.signal, cache: "no-store" }).then(async response => {
          if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "示范视频暂时不可用");
          return response.json() as Promise<{ start: number; end: number; crop?: [number, number, number]; whole?: boolean }>;
        })]);
        if (cancelled || !host.current) return;
        // artplayer defaults to double-tap on touch devices; a single tap is what people expect here.
        module.default.MOBILE_CLICK_PLAY = true;
        module.default.MOBILE_DBCLICK_PLAY = false;
        const art = new module.default({
          container: host.current,
          url: `/api/videos/${encodeURIComponent(char)}/stream?t=${run}`,
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
          // Metadata and the container size arrive in either order, so retry until the
          // crop lands. Without this the frame stays 16:9 and neighbours show through.
          let tries = 0;
          const fit = () => {
            if (cancelled || !host.current) return;
            if (applyCrop(art.video, host.current, crop)) return;
            if (++tries < 120) requestAnimationFrame(fit);
          };
          fit();
          art.on("ready", fit);
          art.video.addEventListener("loadedmetadata", fit);
          window.addEventListener("resize", fit);
          cleanups.push(() => window.removeEventListener("resize", fit));
        }

        {
          // Autoplay starts at the top of the part, so the first frames belong to another
          // character. Keep the picture hidden until it actually sits on this clip.
          let revealed = false;
          const reveal = () => {
            if (revealed) return;
            revealed = true;
            art.video.style.opacity = "1";
          };
          art.video.style.opacity = "0";
          if (meta.whole) reveal();
          else {
            const { start } = meta;
            art.video.addEventListener("timeupdate", () => { if (art.video.currentTime >= start - 0.3) reveal(); });
            art.video.addEventListener("seeked", reveal);
            // Slow networks must not leave a blank cell forever.
            const timer = setTimeout(reveal, 4000);
            cleanups.push(() => clearTimeout(timer));
          }
        }

        if (meta.whole) {
          // No timestamp marks for this part: play it from the start, artplayer loops.
          art.video.loop = true;
        } else {
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
      for (const off of cleanups) off();
      player.current?.destroy(false); player.current = null;
    };
  }, [char, run]);

  // Tapping the picture pauses and resumes: artplayer already toggles on click.
  return <div ref={host} className={`video-player${active ? " is-active" : ""} is-wide`} aria-hidden={!active} data-testid="video-player" />;
}
