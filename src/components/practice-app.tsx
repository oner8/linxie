"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "cn";
import { ArrowLeft, ArrowRight, Check, ChevronDown, Expand, Grid2X2, LoaderCircle, Minimize2, Pause, PencilLine, Play, RotateCcw, SlidersHorizontal, Sun, Trash2, Type, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldError } from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PracticeCell, GridLines } from "./practice-cell";
import { StrokeAnimation, type StrokeProgress } from "./stroke-animation";
import { COLOR_PALETTE, DEFAULTS, GRIDS, STORAGE_KEY, THEMES, restoreSettings, swipeStep, validateText, type PublicFont, type Settings } from "@/lib/practice";
import { forgetLocalFont, loadPracticeFont, LoadError } from "@/lib/browser-fonts";
import { deleteLocalFont, inspectLocalFont, migrateLocalData, readLocalFonts, saveLocalFont, type LocalFont } from "@/lib/local-fonts";
import { useWakeLock } from "@/hooks/use-wake-lock";

type Panel = "text" | "fonts" | "grids" | "settings";
type Display = { text: string; fontId: string; name: string; family: string };
type SystemFont = { fullName: string; postscriptName: string; blob(): Promise<Blob> };
const TITLES: Record<Panel, string> = { text: "设置文字", fonts: "选择字体", grids: "选择格形", settings: "临写设置" };

function FontLabel({ name, style }: { name: string; style?: string }) {
  const script = style || name.match(/(楷书|行书|行楷)$/)?.[0];
  return <span className="font-label"><span className="truncate">{script && name.endsWith(script) ? name.slice(0, -script.length) : name}</span>{script && <Badge variant="outline">{script}</Badge>}</span>;
}

export function PracticeApp() {
  const [settings, setSettings] = useState<Settings>({ ...DEFAULTS });
  const [fonts, setFonts] = useState<PublicFont[]>([]);
  const [localFonts, setLocalFonts] = useState<LocalFont[]>([]);
  const [display, setDisplay] = useState<Display | null>(null);
  const [ready, setReady] = useState(false);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [focus, setFocus] = useState(false);
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState(DEFAULTS.text);
  const [composing, setComposing] = useState(false);
  const [fontTab, setFontTab] = useState("builtin");
  const [loading, setLoading] = useState<{ text: string; name: string } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [importing, setImporting] = useState(false);
  const [systemSupported, setSystemSupported] = useState(false);
  const [systemFonts, setSystemFonts] = useState<SystemFont[]>([]);
  const [systemChoice, setSystemChoice] = useState("");
  const [strokeRun, setStrokeRun] = useState(0);
  const [strokePaused, setStrokePaused] = useState(false);
  const [strokeProgress, setStrokeProgress] = useState<StrokeProgress>({ phase: "idle", stroke: 0, total: 0 });
  const strokeSequence = useRef(0);
  const finishStroke = useCallback((progress: StrokeProgress) => { setStrokeProgress(progress); setStrokeRun(0); setStrokePaused(false); }, []);
  const request = useRef<{ sequence: number; controller?: AbortController }>({ sequence: 0 });
  const current = useRef<Display | null>(null);
  const retry = useRef<(() => void) | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const pointer = useRef<{ x: number; y: number; time: number; id: number } | null>(null);
  const wake = useWakeLock(focus && settings.wake);
  const measureDrawer = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const root = document.documentElement;
    const update = () => root.style.setProperty("--panel-height", `${node.getBoundingClientRect().height}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => { observer.disconnect(); root.style.removeProperty("--panel-height"); };
  }, []);

  const load = useCallback(async (font: PublicFont | LocalFont, text: string): Promise<boolean> => {
    request.current.controller?.abort();
    const controller = new AbortController();
    const sequence = ++request.current.sequence;
    request.current.controller = controller;
    setLoading({ text, name: font.name }); setError("");
    retry.current = () => { void load(font, text); };
    try {
      const family = await loadPracticeFont(font, text, controller.signal, current.current?.family);
      if (sequence !== request.current.sequence) return false;
      const next = { text, family, fontId: font.id, name: font.name };
      if (current.current?.text !== text) setIndex(0);
      current.current = next; setDisplay(next);
      retry.current = null;
      setSettings(s => ({ ...s, text, fontId: font.id }));
      return true;
    } catch (e) {
      if (controller.signal.aborted || sequence !== request.current.sequence) return false;
      setError(e instanceof Error ? e.message : "字体加载失败，请检查网络后重试");
      if (e instanceof LoadError) {
        setCooldown(e.retryAfter);
        if (e.refreshList) {
          try {
            const response = await fetch("/api/fonts");
            if (response.ok && sequence === request.current.sequence) {
              const updated: PublicFont[] = await response.json(); setFonts(updated);
              const fresh = updated.find(f => f.id === font.id);
              if (fresh) retry.current = () => { void load(fresh, text); };
            }
          } catch { /* The retry control remains available. */ }
        }
      }
      return false;
    } finally { if (sequence === request.current.sequence) setLoading(null); }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      try { await migrateLocalData(); }
      catch (error) {
        if (!cancelled) {
          setError(error instanceof Error ? `旧数据迁移未完成：${error.message}` : "旧数据迁移未完成，请重试");
          retry.current = () => { void boot(); };
        }
        return;
      }
      if (cancelled) return;
      let saved = { ...DEFAULTS };
      try { saved = restoreSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null")); }
      catch { setNotice("无法读取上次设置，本次使用默认设置"); }
      const [fontResult, localResult] = await Promise.allSettled([
        fetch("/api/fonts").then(async response => { if (!response.ok) throw new Error("字体列表暂时不可用，请重试"); return response.json() as Promise<PublicFont[]>; }),
        readLocalFonts(),
      ]);
      if (cancelled) return;
      const locals = localResult.status === "fulfilled" ? localResult.value : [];
      setLocalFonts(locals);
      setSystemSupported("queryLocalFonts" in window);
      if (fontResult.status === "rejected") {
        setError("字体列表暂时不可用，请检查网络后重试"); retry.current = () => { void boot(); }; return;
      }
      const builtin = fontResult.value; setFonts(builtin);
      const chosen = [...builtin, ...locals].find(f => f.id === saved.fontId) || builtin[0];
      if (!chosen) { setError("字体资源尚未就绪"); return; }
      if (chosen.id !== saved.fontId) setNotice("上次使用的本机字体不可用，已切回内置字体");
      setSettings({ ...saved, fontId: chosen.id }); setDraft(saved.text); setReady(true);
      await load(chosen, saved.text);
    }
    void boot();
    return () => { cancelled = true; request.current.controller?.abort(); };
  }, [load]);

  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); }
    catch { setNotice("当前设置可用，但浏览器无法保存；刷新后可能需要重新设置"); }
  }, [ready, settings]);
  useEffect(() => {
    const theme = THEMES.find(t => t.id === settings.theme) || THEMES[0];
    const root = document.documentElement;
    root.style.setProperty("--background", theme.background);
    root.style.setProperty("--card", theme.card);
    root.style.setProperty("--foreground", theme.ink);
    root.style.setProperty("--primary", theme.accent);
    root.style.setProperty("--grid-line", theme.grid);
    root.style.setProperty("--primary-foreground", theme.id === "night" ? theme.background : "#ffffff");
    root.style.colorScheme = theme.id === "night" ? "dark" : "light";
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute("content", theme.background);
  }, [settings.theme]);
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown(c => Math.max(0, c - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      const height = viewport?.height || window.innerHeight;
      const top = viewport?.offsetTop || 0;
      const root = document.documentElement;
      root.style.setProperty("--app-height", `${height}px`);
      root.style.setProperty("--viewport-top", `${top}px`);
      root.style.setProperty("--drawer-bottom", `${Math.max(0, window.innerHeight - height - top)}px`);
    };
    update(); viewport?.addEventListener("resize", update); viewport?.addEventListener("scroll", update); window.addEventListener("resize", update);
    return () => { viewport?.removeEventListener("resize", update); viewport?.removeEventListener("scroll", update); window.removeEventListener("resize", update); };
  }, []);
  useEffect(() => {
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape" && !panel) setFocus(false); };
    window.addEventListener("keydown", escape); return () => window.removeEventListener("keydown", escape);
  }, [panel]);

  const openPanel = (value: Panel, element: HTMLElement) => {
    trigger.current = element; setError(""); retry.current = null;
    if (value === "text") setDraft(settings.text);
    setPanel(value);
  };
  const closePanel = () => {
    if (panel === "text" && loading) { request.current.controller?.abort(); request.current.sequence++; setLoading(null); }
    setPanel(null);
  };
  const submitText = async () => {
    if (composing || cooldown || loading) return;
    try {
      const text = validateText(draft);
      const font = [...fonts, ...localFonts].find(f => f.id === settings.fontId);
      if (font && await load(font, text)) setPanel(null);
    } catch (e) { retry.current = null; setError((e as Error).message); }
  };
  const importFont = async (file: Blob, name: string) => {
    setImporting(true); setError(""); retry.current = null;
    try {
      let font = await inspectLocalFont(file, name, localFonts);
      // Verify browser support before storing a font that cannot be used here.
      await new FontFace(`Import${font.id}`, font.data).load();
      if (!font.saved) {
        try { await saveLocalFont(font); font = { ...font, saved: true }; }
        catch { setNotice("字体仅在本次页面临时使用：浏览器空间不足或不允许保存"); }
      }
      setLocalFonts(list => [...list.filter(f => f.id !== font.id), font]); setFontTab("local");
      await load(font, settings.text);
    } catch (e) { setError(e instanceof Error ? (e.name === "SyntaxError" ? "浏览器无法加载这份字体，请换一份文件" : e.message) : "字体导入失败"); }
    finally { setImporting(false); }
  };
  const removeFont = async (font: LocalFont) => {
    if (settings.fontId === font.id) {
      const fallback = fonts.find(f => f.id === DEFAULTS.fontId);
      if (!fallback || !await load(fallback, settings.text)) { setNotice("请先修改文字或切换到可用内置字体，再删除当前字体"); return; }
    }
    try {
      await deleteLocalFont(font.id, font.saved);
      forgetLocalFont(font.id); setLocalFonts(list => list.filter(f => f.id !== font.id));
    } catch { retry.current = () => { void removeFont(font); }; setError("删除失败，字体仍保留，请重试"); }
  };
  const chooseSystemFonts = async () => {
    retry.current = null;
    try {
      const values = await (window as unknown as { queryLocalFonts(): Promise<SystemFont[]> }).queryLocalFonts();
      setSystemFonts(values); setSystemChoice(values[0]?.postscriptName || "");
    } catch { setError("没有取得系统字体访问权限，仍可通过文件导入"); }
  };
  const chars = [...(display?.text || settings.text)];
  const theme = THEMES.find(t => t.id === settings.theme) || THEMES[0];
  const activeIndex = Math.min(index, chars.length - 1);
  const all = settings.view === "all" && chars.length > 1 && !panel;
  const strokeVisible = !!strokeRun && strokeProgress.phase === "playing";
  useEffect(() => {
    setStrokeRun(0); setStrokePaused(false); setStrokeProgress({ phase: "idle", stroke: 0, total: 0 });
  }, [activeIndex, display?.family, display?.text, all, panel]);
  const playStroke = () => {
    setStrokePaused(false); setStrokeProgress({ phase: "loading", stroke: 0, total: 0 }); setStrokeRun(++strokeSequence.current);
  };
  const stopStroke = () => {
    setStrokeRun(0); setStrokePaused(false); setStrokeProgress(p => ({ phase: "idle", stroke: 0, total: p.total }));
  };
  const step = (direction: number) => setIndex(i => Math.max(0, Math.min(chars.length - 1, i + direction)));
  let draftError = "";
  if (!composing && draft) { try { validateText(draft); } catch (e) { draftError = (e as Error).message; } }
  const feedback = <>
    {error && <Alert variant="destructive" className="feedback"><AlertDescription>{error}</AlertDescription>{retry.current && <Button variant="ghost" onClick={() => panel === "text" ? void submitText() : retry.current?.()} disabled={cooldown > 0 || !!loading}>{cooldown ? `${cooldown} 秒后重试` : "重试"}</Button>}</Alert>}
    {notice && <Alert className="feedback"><AlertDescription>{notice}</AlertDescription><Button variant="ghost" size="icon" aria-label="关闭提示" onClick={() => setNotice("")}><X /></Button></Alert>}
  </>;

  return <>
    <main className={cn("app-shell", focus && "is-focused", panel && "has-panel")}>
      <header className="app-header">
        <div className="brand"><h1>临写</h1></div>
        <Button variant="ghost" className="focus-button" onClick={() => setFocus(f => !f)} aria-label={focus ? "退出专注" : "进入专注"}>{focus ? <Minimize2 data-icon="inline-start" /> : <Expand data-icon="inline-start" />}{focus ? "退出专注" : "专注"}</Button>
      </header>
      {!focus && !panel && <>
        <section className="writing-entry" aria-label="练习内容">
          <p className="entry-text">{[...settings.text].map((char, i) => <span key={i} className={cn("entry-char", i === activeIndex && "is-active")}>{char}</span>)}</p>
          <Button variant="ghost" onClick={e => openPanel("text", e.currentTarget)} disabled={!ready}><PencilLine data-icon="inline-start" />编辑</Button>
        </section>
        <div className="view-switch"><ToggleGroup type="single" value={settings.view} onValueChange={value => value && setSettings(s => ({ ...s, view: value as Settings["view"] }))} aria-label="展示方式" spacing={0}><ToggleGroupItem value="single" aria-label="逐字放大">逐字</ToggleGroupItem><ToggleGroupItem value="all" aria-label="全部展示">全览</ToggleGroupItem></ToggleGroup></div>
      </>}
      {!panel && <div className="feedback-stack">{feedback}</div>}
      <section className={cn("practice-area", all && "is-all")} aria-label="临写展示区" aria-busy={!!loading}>
        <div className={cn("loading-caption", !loading && "is-idle")} role="status">{loading ? <><LoaderCircle className="spin" aria-hidden="true" />正在加载 {loading.name}{display ? " · 下方保留上次字形" : ""}</> : ""}</div>
        <div className={cn("glyph-stage", all && "all-glyphs")} style={{ "--count": chars.length } as React.CSSProperties}
          tabIndex={panel ? -1 : 0} aria-label={all ? "全部汉字，点击可放大" : "左右滑动或使用左右方向键切字"}
          onKeyDown={e => { if (!panel && !all && ["ArrowLeft", "ArrowRight"].includes(e.key)) { e.preventDefault(); step(e.key === "ArrowRight" ? 1 : -1); } }}
          onPointerDown={e => { if (panel || all || chars.length < 2 || !e.isPrimary) return; pointer.current = { x: e.clientX, y: e.clientY, time: performance.now(), id: e.pointerId }; e.currentTarget.setPointerCapture(e.pointerId); }}
          onPointerCancel={() => { pointer.current = null; }}
          onPointerUp={e => { const p = pointer.current; pointer.current = null; if (p && p.id === e.pointerId && !panel && !all) step(swipeStep(e.clientX - p.x, e.clientY - p.y, performance.now() - p.time)); }}>
          {(all ? chars : [chars[activeIndex]]).map((char, i) => all ? <button key={i} className="all-character" aria-label={`放大第 ${i + 1} 字：${char}`} onClick={() => { setIndex(i); setSettings(s => ({ ...s, view: "single" })); }}><PracticeCell char={display ? char : undefined} family={display?.family} grid={settings.grid} size={settings.size} opacity={settings.opacity} lineColor={settings.lineColor} textColor={settings.textColor} /></button> : <PracticeCell key="single" char={display ? char : undefined} family={display?.family} grid={settings.grid} size={settings.size} opacity={settings.opacity} lineColor={settings.lineColor} textColor={settings.textColor} hideCharacter={strokeVisible} />)}
          <StrokeAnimation char={chars[activeIndex]} run={strokeRun} size={settings.size} color={settings.textColor} paused={strokePaused} visible={strokeVisible && !all && !panel} onProgress={setStrokeProgress} onFinish={finishStroke} />
          {!display && <div className="font-placeholder"><LoaderCircle className="spin" aria-hidden="true" /><span>字体加载中</span></div>}
        </div>
        {!panel && <div className="practice-details">
          <p className="font-caption">{strokeVisible ? "参考楷书" : display?.name || "准备字体"}<span>·</span>{GRIDS.find(g => g.id === settings.grid)?.name}</p>
          {chars.length > 1 && !all && <nav className="character-navigation" aria-label="切换汉字"><Button variant="ghost" disabled={activeIndex === 0} onClick={() => step(-1)} aria-label="上一字"><ArrowLeft data-icon="inline-start" /><span>上一字</span></Button><span className="page-number" aria-live="polite">{activeIndex + 1} / {chars.length}</span><Button variant="ghost" disabled={activeIndex === chars.length - 1} onClick={() => step(1)} aria-label="下一字"><span>下一字</span><ArrowRight data-icon="inline-end" /></Button></nav>}
          {all && <p className="practice-hint">点击任一字，放大临写</p>}
          {!all && <section className="stroke-tools" aria-label="笔顺演示工具">
            <div className="stroke-tools-row"><div className="stroke-description"><p className="stroke-title">书写顺序{strokeProgress.total > 0 && <span>{strokeProgress.total} 画</span>}</p><p className="stroke-note" role="status">{strokeProgress.phase === "loading" ? "正在准备笔顺…" : strokeVisible ? `参考楷书 · 第 ${strokeProgress.stroke} / ${strokeProgress.total} 画${strokePaused ? " · 已暂停" : ""}` : strokeProgress.phase === "complete" ? "演示完成，继续临写" : strokeProgress.phase === "error" ? strokeProgress.error : "先看笔顺，再动笔"}</p></div>
              <div className="stroke-actions">{strokeVisible ? <><Button variant="ghost" size="sm" aria-label={strokePaused ? "继续笔顺演示" : "暂停笔顺演示"} onClick={() => setStrokePaused(p => !p)}>{strokePaused ? <Play /> : <Pause />}{strokePaused ? "继续" : "暂停"}</Button><Button variant="ghost" size="icon-sm" aria-label="重播笔顺演示" onClick={playStroke}><RotateCcw /></Button><Button variant="ghost" size="sm" aria-label="返回范字" onClick={stopStroke}>返回</Button></> : <Button variant="secondary" size="sm" onClick={playStroke} disabled={!display || !!loading || strokeProgress.phase === "loading"} aria-label={strokeProgress.phase === "complete" ? "重播笔顺演示" : "笔顺演示"}>{strokeProgress.phase === "loading" ? <LoaderCircle className="spin" /> : strokeProgress.phase === "complete" ? <RotateCcw /> : <Play />}{strokeProgress.phase === "complete" ? "重播" : "笔顺演示"}</Button>}</div>
            </div>
            {strokeProgress.total > 0 && <progress className="stroke-progress" max={strokeProgress.total} value={strokeProgress.phase === "idle" ? 0 : strokeProgress.stroke} aria-label="笔顺演示进度" />}
          </section>}
          {focus && settings.wake && <p className="wake-status" role="status"><Sun aria-hidden="true" />{wake === "on" ? "屏幕保持常亮" : wake === "unsupported" ? "当前浏览器不支持常亮，请调整系统设置" : wake === "failed" ? "未能开启常亮，请调整系统设置" : "专注临写"}</p>}
        </div>}
      </section>
      {!focus && !panel && <footer className="toolbar" aria-label="临写工具">{([{ id: "text", name: "文字", icon: Type }, { id: "fonts", name: "字体", icon: PencilLine }, { id: "grids", name: "格形", icon: Grid2X2 }, { id: "settings", name: "设置", icon: SlidersHorizontal }] as const).map(item => <Button key={item.id} variant="ghost" aria-haspopup="dialog" onClick={e => openPanel(item.id, e.currentTarget)} disabled={!ready}><item.icon /><span>{item.name}</span></Button>)}</footer>}
    </main>

    <Drawer open={!!panel} onOpenChange={open => !open && closePanel()} shouldScaleBackground={false} repositionInputs={false} autoFocus>
      <DrawerContent ref={measureDrawer} className="practice-drawer" data-panel={panel || undefined} aria-describedby={undefined} onOpenAutoFocus={e => { if (panel === "text") { e.preventDefault(); input.current?.focus({ preventScroll: true }); input.current?.select(); } }} onCloseAutoFocus={e => { e.preventDefault(); trigger.current?.focus(); }}>
        <DrawerHeader><div className="panel-title-row"><DrawerTitle>{panel ? TITLES[panel] : "临写设置"}</DrawerTitle><Button variant="ghost" onClick={() => panel === "text" ? void submitText() : closePanel()} disabled={panel === "text" && (!!draftError || !draft.trim() || composing || !!loading || cooldown > 0)}>完成</Button></div></DrawerHeader>
        <div className="panel-scroll" data-vaul-no-drag>
          <div className="feedback-stack">{feedback}</div>
          {panel === "text" && <form onSubmit={e => { e.preventDefault(); void submitText(); }}><FieldGroup className="text-fields"><Field data-invalid={!!draftError}><FieldLabel htmlFor="practice-input">练习的汉字</FieldLabel><Input ref={input} id="practice-input" className="practice-input" value={draft} placeholder="例如：永和安" autoComplete="off" spellCheck={false} aria-invalid={!!draftError} aria-describedby={draftError ? "input-error" : "input-description"} onChange={e => setDraft(e.target.value)} onCompositionStart={() => setComposing(true)} onCompositionEnd={e => { setDraft(e.currentTarget.value); setComposing(false); }} onKeyDown={e => { if (e.key === "Enter" && (composing || e.nativeEvent.isComposing)) e.preventDefault(); }} /><div className="input-meta"><FieldDescription id="input-description">输入 1–3 个汉字</FieldDescription><span>{[...draft.trim()].length} / 3</span></div>{draftError && <FieldError id="input-error">{draftError}</FieldError>}</Field><div className="text-actions"><Button type="button" variant="outline" onClick={closePanel}>取消编辑</Button><Button type="submit" disabled={!!draftError || !draft.trim() || composing || !!loading || cooldown > 0}>{loading && <LoaderCircle className="spin" data-icon="inline-start" />}开始临写</Button></div></FieldGroup></form>}
          {panel === "fonts" && <Tabs value={fontTab} onValueChange={setFontTab}><TabsList className="w-full"><TabsTrigger value="builtin">内置字体 · {fonts.length}</TabsTrigger><TabsTrigger value="local">本机字体</TabsTrigger></TabsList><TabsContent value="builtin"><div className="font-list">{fonts.map(font => <Button key={font.id} variant={settings.fontId === font.id ? "secondary" : "ghost"} aria-pressed={settings.fontId === font.id} className="font-option" aria-label={font.name} onClick={() => { if (!cooldown) void load(font, settings.text); }} disabled={cooldown > 0}><FontLabel name={font.name} style={font.style} />{loading?.name === font.name ? <LoaderCircle className="spin" /> : settings.fontId === font.id ? <Check /> : null}</Button>)}</div></TabsContent><TabsContent value="local">
            <div className="font-list">{localFonts.map(font => <div className="local-font-row" key={font.id}><Button variant={settings.fontId === font.id ? "secondary" : "ghost"} aria-pressed={settings.fontId === font.id} className="font-option" aria-label={font.name} onClick={() => void load(font, settings.text)}><span className="min-w-0"><FontLabel name={font.name} /><small>{(font.size / 1024 / 1024).toFixed(1)} MiB · {font.saved ? "已保存在本机" : "本次临时使用"}</small></span>{settings.fontId === font.id && <Check />}</Button><AlertDialog><AlertDialogTrigger asChild><Button variant="ghost" size="icon" aria-label={`删除${font.name}`}><Trash2 /></Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>删除这款本机字体？</AlertDialogTitle><AlertDialogDescription>从当前浏览器移除「{font.name}」。如果正在使用，将先切换到田英章楷书；原始文件不会被删除。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>保留</AlertDialogCancel><AlertDialogAction onClick={() => void removeFont(font)}>删除字体</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div>)}</div>
            {!localFonts.length && <p className="local-empty">把你喜欢的字体带进来。<br />导入后，仅在这台设备上使用。</p>}
            <Button variant="outline" className="w-full" disabled={importing} onClick={() => fileInput.current?.click()}><Upload data-icon="inline-start" />{importing ? "正在读取字体…" : "导入字体文件"}</Button>
            <input ref={fileInput} type="file" className="sr-only" tabIndex={-1} accept=".ttf,.otf,.woff,.woff2" aria-label="导入字体文件" onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void importFont(file, file.name); }} />
            <p className="local-help">TTF / OTF / WOFF / WOFF2 · 每款最多 30 MiB<br />最多 5 款，总量 100 MiB；文件不会上传</p>
            {systemSupported && <Button variant="ghost" className="w-full" onClick={() => void chooseSystemFonts()}>选择电脑已安装的字体</Button>}
            {!!systemFonts.length && <FieldGroup><Field><FieldLabel htmlFor="system-font">系统字体</FieldLabel><select id="system-font" value={systemChoice} onChange={e => setSystemChoice(e.target.value)}>{systemFonts.map(f => <option key={f.postscriptName} value={f.postscriptName}>{f.fullName}</option>)}</select></Field><Button disabled={importing || !systemChoice} onClick={async () => { const font = systemFonts.find(f => f.postscriptName === systemChoice); if (font) { try { await importFont(await font.blob(), font.fullName); } catch { setError("无法读取这款系统字体"); } } }}>使用这款系统字体</Button></FieldGroup>}
          </TabsContent></Tabs>}
          {panel === "grids" && <ToggleGroup type="single" className="grid-options" value={settings.grid} onValueChange={value => value && setSettings(s => ({ ...s, grid: value as Settings["grid"] }))} aria-label="格形">{GRIDS.map(grid => <ToggleGroupItem key={grid.id} value={grid.id} className="grid-option" aria-label={grid.name}><svg viewBox="0 0 1000 1000" aria-hidden="true"><GridLines grid={grid.id} opacity={0.65} color={settings.lineColor} /></svg><span className="grid-option-name">{grid.name}</span>{settings.grid === grid.id && <Check className="grid-check" />}</ToggleGroupItem>)}</ToggleGroup>}
          {panel === "settings" && <FieldGroup className="settings-fields">
            <fieldset className="settings-group theme-settings"><legend>主题</legend><div className="theme-options">{THEMES.map(item => <button key={item.id} type="button" className="theme-option" aria-label={`${item.name}主题`} aria-pressed={settings.theme === item.id} onClick={() => setSettings(s => ({ ...s, theme: item.id, lineColor: item.grid, textColor: item.ink }))} style={{ "--theme-paper": item.card, "--theme-ink": item.ink, "--theme-grid": item.grid } as React.CSSProperties}><span className="theme-mini">{display && <span style={{ fontFamily: display.family }}>{chars[activeIndex]}</span>}</span><span className="theme-name">{item.name}</span>{settings.theme === item.id && <Check className="theme-check" aria-hidden="true" />}</button>)}</div></fieldset>
            <div className="settings-group color-settings">
              {([{ key: "lineColor", label: "线条颜色" }, { key: "textColor", label: "描红颜色" }] as const).map(({ key, label }) => {
                const themeColor = key === "lineColor" ? theme.grid : theme.ink;
                return <details key={key} name="practice-colors" className="color-setting">
                  <summary><span>{label}</span><span className="color-current" style={{ backgroundColor: settings[key] }} aria-hidden="true" /><ChevronDown className="color-chevron" aria-hidden="true" /></summary>
                  <fieldset><legend className="sr-only">{label}</legend><label className="theme-color-option"><input className="sr-only" type="radio" name={key} aria-label="主题默认" checked={settings[key] === themeColor} onChange={() => setSettings(s => ({ ...s, [key]: themeColor }))} /><span className="color-swatch" style={{ backgroundColor: themeColor }} />主题默认</label><div className="color-options">
                    {COLOR_PALETTE.flatMap(group => group.colors.map((color, i) => <label className="color-option" key={color} title={`${group.name}色 ${color}`}>
                      <input className="sr-only" type="radio" name={key} aria-label={`${group.name}色 ${i + 1}`} value={color} checked={settings[key] === color} onChange={() => setSettings(s => ({ ...s, [key]: color }))} />
                      <span className="color-swatch" style={{ backgroundColor: color }}>{settings[key] === color && <Check aria-hidden="true" />}</span>
                    </label>))}
                  </div></fieldset>
                </details>;
              })}
            </div>
            <div className="settings-group slider-setting"><Field><div className="setting-label"><FieldLabel htmlFor="font-size">字形大小</FieldLabel><output>{settings.size}%</output></div><Slider id="font-size" aria-label="字形大小" value={[settings.size]} min={50} max={95} step={1} onValueChange={([size]) => setSettings(s => ({ ...s, size }))} /></Field></div>
            <div className="settings-group slider-setting"><Field><div className="setting-label"><FieldLabel htmlFor="grid-opacity">格线深浅</FieldLabel><output>{settings.opacity}%</output></div><Slider id="grid-opacity" aria-label="格线深浅" value={[settings.opacity]} min={10} max={100} step={1} onValueChange={([opacity]) => setSettings(s => ({ ...s, opacity }))} /></Field></div>
            <div className="settings-group"><Field orientation="horizontal"><FieldContent><FieldLabel htmlFor="wake-lock">专注时保持常亮</FieldLabel><FieldDescription>退出专注后关闭，需要浏览器支持</FieldDescription></FieldContent><Switch id="wake-lock" checked={settings.wake} onCheckedChange={wake => setSettings(s => ({ ...s, wake }))} /></Field></div>
            <Button variant="outline" className="manage-fonts" onClick={() => { setPanel("fonts"); setFontTab("local"); }}>管理本机字体 <Badge variant="secondary">{localFonts.length}</Badge><ArrowRight aria-hidden="true" /></Button>
            <Button variant="ghost" className="reset-settings" onClick={async () => { const font = fonts.find(f => f.id === DEFAULTS.fontId); if (font && await load(font, settings.text)) { setSettings(s => ({ ...DEFAULTS, text: s.text })); setNotice("已恢复默认设置，练习内容与本机字体已保留"); } }}>恢复默认设置</Button>
          </FieldGroup>}
        </div>
      </DrawerContent>
    </Drawer>
  </>;
}
