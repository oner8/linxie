"use client";
import { useEffect, useState } from "react";

export function useWakeLock(active: boolean) {
  const [state, setState] = useState<"off" | "on" | "unsupported" | "failed">("off");
  useEffect(() => {
    let disposed = false;
    let sentinel: WakeLockSentinel | null = null;
    let requesting = false;
    const update = async () => {
      if (!active || document.visibilityState !== "visible") {
        await sentinel?.release(); sentinel = null;
        if (!disposed) setState("off");
        return;
      }
      if (!("wakeLock" in navigator) || !window.isSecureContext) { setState("unsupported"); return; }
      if (requesting || sentinel) return;
      requesting = true;
      try {
        const lock = await navigator.wakeLock.request("screen");
        if (disposed || document.visibilityState !== "visible") { await lock.release(); return; }
        sentinel = lock; setState("on");
        lock.addEventListener("release", () => { sentinel = null; if (!disposed) setState("off"); });
      } catch { if (!disposed) setState("failed"); }
      finally { requesting = false; }
    };
    void update();
    document.addEventListener("visibilitychange", update);
    return () => { disposed = true; document.removeEventListener("visibilitychange", update); void sentinel?.release(); };
  }, [active]);
  return state;
}
