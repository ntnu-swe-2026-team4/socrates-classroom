import {
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Angry,
  Annoyed,
  Laugh,
  LoaderCircle,
  Meh,
  Send,
  Smile,
  Sparkles,
  Square,
  Trash2,
  Undo2,
  UserRound,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import type { AssistantMessage } from "@socrates/shared";
import { api } from "@/api";
import { Markdown } from "@/components/Markdown";
import { type MessageKey, useT } from "@/i18n";
import { type CompanionManualExpression, companion, getCompanion, onExpression, useCompanion } from "@/lib/companion";
import { createSocratesScene } from "@/lib/socrates/scene";
import { speak, speakableText, stopSpeech } from "@/lib/speech";

type Point = { x: number; y: number };
type Viewport = { w: number; h: number };
type MenuLevel = "main" | "expression";
type MenuItem = {
  id: string;
  label: MessageKey;
  icon: ReactNode;
  role: "menuitem" | "menuitemcheckbox" | "menuitemradio";
  checked?: boolean;
  hasPopup?: boolean;
  run: () => void;
};
type AssistantTurn = AssistantMessage & { failed?: boolean };

const POSITION_KEY = "socrates_companion_position";
const EDGE = 8;
const ITEM = 44;
const DRAG_THRESHOLD = 5;
const DOUBLE_TAP_MS = 400;
const DOUBLE_TAP_SLOP = 24;
const NUDGE = 16;
const PANEL_WIDTH = 340;
const PANEL_MAX_HEIGHT = 460;
const EXPRESSIONS: { name: CompanionManualExpression; label: MessageKey; icon: ReactNode }[] = [
  { name: "neutral", label: "companion_expr_neutral", icon: <Meh className="size-4.5" aria-hidden /> },
  { name: "Happy", label: "companion_expr_happy", icon: <Laugh className="size-4.5" aria-hidden /> },
  { name: "Confused", label: "companion_expr_confused", icon: <Annoyed className="size-4.5" aria-hidden /> },
  { name: "Angry", label: "companion_expr_angry", icon: <Angry className="size-4.5" aria-hidden /> },
];

function readViewport(): Viewport {
  return {
    w: document.documentElement.clientWidth || window.innerWidth,
    h: document.documentElement.clientHeight || window.innerHeight,
  };
}

function readPosition(): Point | null {
  try {
    const raw = localStorage.getItem(POSITION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Point>;
    if (typeof parsed.x === "number" && typeof parsed.y === "number" && Number.isFinite(parsed.x + parsed.y)) {
      return { x: parsed.x, y: parsed.y };
    }
  } catch {}
  return null;
}

function writePosition(point: Point) {
  try {
    localStorage.setItem(POSITION_KEY, JSON.stringify({ x: Math.round(point.x), y: Math.round(point.y) }));
  } catch {}
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function clampPoint(point: Point, vp: Viewport, size: number): Point {
  return { x: clamp(point.x, EDGE, vp.w - size - EDGE), y: clamp(point.y, EDGE, vp.h - size - EDGE) };
}

function defaultPoint(vp: Viewport, size: number): Point {
  return { x: vp.w - size - 16, y: vp.h - size - 112 };
}

function ringAngles(count: number, center: Point, radius: number, vp: Viewport) {
  const fits = (angle: number) => {
    const x = center.x + Math.cos(angle) * radius - ITEM / 2;
    const y = center.y + Math.sin(angle) * radius - ITEM / 2;
    return x >= EDGE && y >= EDGE && x + ITEM <= vp.w - EDGE && y + ITEM <= vp.h - EDGE;
  };
  const fullStep = (Math.PI * 2) / count;
  const full = Array.from({ length: count }, (_, i) => -Math.PI / 2 + i * fullStep);
  if (full.every(fits)) return { angles: full, step: fullStep, closed: true };
  const step = Math.max(0.6, (ITEM + 12) / radius);
  const base = Math.atan2(vp.h / 2 - center.y, vp.w / 2 - center.x);
  const angles = Array.from({ length: count }, (_, i) => base + (i - (count - 1) / 2) * step);
  return { angles, step, closed: false };
}

function arcPath(cx: number, cy: number, r: number, from: number, to: number) {
  const x1 = cx + Math.cos(from) * r;
  const y1 = cy + Math.sin(from) * r;
  const x2 = cx + Math.cos(to) * r;
  const y2 = cy + Math.sin(to) * r;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${to - from > Math.PI ? 1 : 0} 1 ${x2} ${y2}`;
}

function useViewport() {
  const [vp, setVp] = useState(readViewport);
  useEffect(() => {
    const onResize = () => setVp(readViewport());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return vp;
}

export function SocratesCompanion() {
  const { visible } = useCompanion();
  if (!visible) return null;
  return <CompanionBody />;
}

function CompanionBody() {
  const t = useT();
  const state = useCompanion();
  const vp = useViewport();
  const size = vp.w < 768 ? 120 : 300;
  const [stored, setStored] = useState<Point | null>(readPosition);
  const pos = clampPoint(stored ?? defaultPoint(vp, size), vp, size);
  const [dragging, setDragging] = useState(false);
  const [modelState, setModelState] = useState<"loading" | "ready" | "error">("loading");
  const [menu, setMenu] = useState<MenuLevel | null>(null);
  const [active, setActive] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<HTMLButtonElement>(null);
  const stageRef = useRef<HTMLSpanElement>(null);
  const searchInputRef = useRef<HTMLTextAreaElement>(null);
  const [assistantTurns, setAssistantTurns] = useState<AssistantTurn[]>([]);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const sceneRef = useRef<ReturnType<typeof createSocratesScene> | null>(null);
  const dragRef = useRef<{ id: number; start: Point; origin: Point; moved: boolean } | null>(null);
  const cleanTaps = useRef(0);
  const lastTap = useRef<{ time: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const canvas = document.createElement("canvas");
    canvas.className = "block size-full";
    stage.prepend(canvas);
    let scene: ReturnType<typeof createSocratesScene>;
    try {
      scene = createSocratesScene(canvas, stage, {
        mini: true,
        onReady: () => setModelState("ready"),
        onError: () => setModelState("error"),
      });
    } catch {
      canvas.remove();
      setModelState("error");
      return;
    }
    sceneRef.current = scene;
    scene.setSpeaking(getCompanion().speaking);
    return () => {
      scene.dispose();
      sceneRef.current = null;
      canvas.remove();
    };
  }, []);

  useEffect(() => onExpression((name) => sceneRef.current?.setExpression(name, { loop: false })), []);

  useEffect(() => {
    sceneRef.current?.setSpeaking(state.speaking);
  }, [state.speaking]);

  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setMenu(null);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [menu]);

  useEffect(() => {
    if (menu) itemRefs.current[active]?.focus({ preventScroll: true });
  }, [menu, active]);

  function openMenu() {
    setMenu("main");
    setActive(0);
  }

  function closeMenu(restoreFocus: boolean) {
    setMenu(null);
    if (restoreFocus) modelRef.current?.focus({ preventScroll: true });
  }

  function moveTo(next: Point, persist: boolean) {
    const clamped = clampPoint(next, vp, size);
    setStored(clamped);
    if (persist) writePosition(clamped);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!event.isPrimary) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    dragRef.current = {
      id: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      origin: pos,
      moved: false,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {}
  }

  function onPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.start.x;
    const dy = event.clientY - drag.start.y;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!drag.moved) {
      drag.moved = true;
      setDragging(true);
    }
    moveTo({ x: drag.origin.x + dx, y: drag.origin.y + dy }, false);
  }

  function endDrag(event: ReactPointerEvent<HTMLButtonElement>, cancelled: boolean) {
    const drag = dragRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    dragRef.current = null;
    if (drag.moved) {
      setDragging(false);
      cleanTaps.current = 0;
      lastTap.current = null;
      moveTo(
        { x: drag.origin.x + event.clientX - drag.start.x, y: drag.origin.y + event.clientY - drag.start.y },
        true,
      );
      return;
    }
    if (cancelled) return;
    cleanTaps.current += 1;
    if (event.pointerType === "mouse") return;
    const now = performance.now();
    const prev = lastTap.current;
    if (
      prev &&
      now - prev.time < DOUBLE_TAP_MS &&
      Math.hypot(event.clientX - prev.x, event.clientY - prev.y) < DOUBLE_TAP_SLOP
    ) {
      lastTap.current = null;
      openMenu();
    } else {
      lastTap.current = { time: now, x: event.clientX, y: event.clientY };
    }
  }

  function onDoubleClick() {
    if (cleanTaps.current >= 2) openMenu();
  }

  function onModelKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openMenu();
      return;
    }
    const step = event.shiftKey ? NUDGE * 4 : NUDGE;
    const delta: Record<string, Point> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    };
    const d = delta[event.key];
    if (!d) return;
    event.preventDefault();
    moveTo({ x: pos.x + d.x, y: pos.y + d.y }, true);
  }

  const mainItems: MenuItem[] = [
    {
      id: "search",
      label: "companion_search",
      icon: <Sparkles className="size-4.5" aria-hidden />,
      role: "menuitem",
      run: () => {
        setMenu(null);
        setSearchOpen(true);
        requestAnimationFrame(() => searchInputRef.current?.focus({ preventScroll: true }));
      },
    },
    {
      id: "mute",
      label: "companion_mute",
      icon: state.muted ? <VolumeX className="size-4.5" aria-hidden /> : <Volume2 className="size-4.5" aria-hidden />,
      role: "menuitemcheckbox",
      checked: state.muted,
      run: () => companion.toggleMuted(),
    },
    {
      id: "expression",
      label: "companion_expression",
      icon: <Smile className="size-4.5" aria-hidden />,
      role: "menuitem",
      hasPopup: true,
      run: () => {
        setMenu("expression");
        setActive(0);
      },
    },
  ];
  const expressionItems: MenuItem[] = [
    ...EXPRESSIONS.map(
      (e): MenuItem => ({
        id: `expr-${e.name}`,
        label: e.label,
        icon: e.icon,
        role: "menuitem",
        run: () => {
          companion.playExpression(e.name);
          closeMenu(true);
        },
      }),
    ),
    {
      id: "back",
      label: "companion_back",
      icon: <Undo2 className="size-4.5" aria-hidden />,
      role: "menuitem",
      run: () => {
        setMenu("main");
        setActive(2);
      },
    },
  ];
  const items = menu === "expression" ? expressionItems : menu === "main" ? mainItems : [];

  function onMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const count = items.length;
    if (!count) return;
    const next: Record<string, number> = {
      ArrowRight: (active + 1) % count,
      ArrowDown: (active + 1) % count,
      ArrowLeft: (active - 1 + count) % count,
      ArrowUp: (active - 1 + count) % count,
      Home: 0,
      End: count - 1,
    };
    const target = next[event.key];
    if (target !== undefined) {
      event.preventDefault();
      setActive(target);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (menu === "expression") {
        setMenu("main");
        setActive(2);
      } else {
        closeMenu(true);
      }
      return;
    }
    if (event.key === "Tab") setMenu(null);
  }

  const center = { x: pos.x + size / 2, y: pos.y + size / 2 };
  const radius = size / 2 + 24;
  const ring = ringAngles(Math.max(items.length, 1), center, radius, vp);
  const activeItem = items[active];
  const captionText = activeItem
    ? activeItem.id === "mute"
      ? t(state.muted ? "companion_muted" : "companion_unmuted")
      : t(activeItem.label)
    : "";
  const half = size / 2;
  const svgSize = radius * 2 + 8;
  const svgOrigin = svgSize / 2;

  return (
    <div ref={rootRef} className="contents">
      <div className="fixed z-40" style={{ left: pos.x, top: pos.y, width: size, height: size }}>
        <button
          ref={modelRef}
          type="button"
          aria-label={t("companion_label")}
          aria-haspopup="menu"
          aria-expanded={menu !== null}
          aria-busy={modelState === "loading"}
          className={`relative block size-full touch-none select-none overflow-hidden rounded-full border border-line-strong bg-card shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(event) => endDrag(event, false)}
          onPointerCancel={(event) => endDrag(event, true)}
          onDoubleClick={onDoubleClick}
          onKeyDown={onModelKeyDown}
        >
          <span ref={stageRef} className="pointer-events-none absolute inset-0 block" />
          {modelState === "loading" && (
            <span className="pointer-events-none absolute inset-x-0 bottom-1 text-center text-[11px] text-ink-faint">
              {t("companion_loading")}
            </span>
          )}
          {modelState === "error" && (
            <span className="pointer-events-none absolute inset-[18%] flex flex-col items-center justify-center gap-1 rounded-full border border-line-strong bg-card text-center text-[11px] text-ink-faint">
              <UserRound className="size-6 text-ink-soft" aria-hidden />
              {t("companion_error")}
            </span>
          )}
        </button>

        {state.speakingSource && menu === null && (
          <div className="anim-fade absolute -top-3 left-1/2 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-full border border-line-strong bg-paper py-0.5 pr-0.5 pl-2.5 text-[11.5px] text-ink-soft shadow-sm">
            <span className="size-1.5 shrink-0 rounded-full bg-ember motion-safe:animate-pulse" aria-hidden />
            <span role="status">
              {t("companion_speaking", {
                source: t(
                  state.speakingSource === "dialogue" ? "companion_source_dialogue" : "companion_source_assistant",
                ),
              })}
            </span>
            <button
              type="button"
              aria-label={t("companion_stop_speaking")}
              title={t("companion_stop_speaking")}
              onClick={() => stopSpeech()}
              className="flex size-5 cursor-pointer items-center justify-center rounded-full text-ink-soft hover:bg-paper-deep hover:text-ink"
            >
              <Square className="size-2.5 fill-current" aria-hidden />
            </button>
          </div>
        )}

        {menu && (
          <div
            role="menu"
            aria-label={t(menu === "expression" ? "companion_expression" : "companion_menu")}
            className="anim-fade pointer-events-none absolute inset-0"
            onKeyDown={onMenuKeyDown}
          >
            <svg
              aria-hidden
              className="pointer-events-none absolute overflow-visible"
              style={{ left: half - svgOrigin, top: half - svgOrigin, width: svgSize, height: svgSize }}
              viewBox={`0 0 ${svgSize} ${svgSize}`}
            >
              {ring.closed ? (
                <circle
                  cx={svgOrigin}
                  cy={svgOrigin}
                  r={radius}
                  className="fill-none stroke-line-strong"
                  strokeWidth={1}
                />
              ) : (
                <path
                  d={arcPath(
                    svgOrigin,
                    svgOrigin,
                    radius,
                    (ring.angles[0] ?? 0) - ring.step / 2,
                    (ring.angles[ring.angles.length - 1] ?? 0) + ring.step / 2,
                  )}
                  className="fill-none stroke-line-strong"
                  strokeWidth={1}
                />
              )}
              {ring.angles[active] !== undefined && (
                <path
                  d={arcPath(
                    svgOrigin,
                    svgOrigin,
                    radius,
                    ring.angles[active] - ring.step * 0.4,
                    ring.angles[active] + ring.step * 0.4,
                  )}
                  className="fill-none stroke-ember"
                  strokeWidth={3}
                />
              )}
            </svg>
            {items.map((item, i) => {
              const angle = ring.angles[i] ?? 0;
              const x = clamp(center.x + Math.cos(angle) * radius - ITEM / 2, EDGE, vp.w - ITEM - EDGE);
              const y = clamp(center.y + Math.sin(angle) * radius - ITEM / 2, EDGE, vp.h - ITEM - EDGE);
              const isActive = i === active;
              const style: CSSProperties = { left: x - pos.x, top: y - pos.y, width: ITEM, height: ITEM };
              return (
                <button
                  key={item.id}
                  ref={(el) => {
                    itemRefs.current[i] = el;
                  }}
                  type="button"
                  role={item.role}
                  aria-label={t(item.label)}
                  {...(item.role === "menuitem" ? {} : { "aria-checked": !!item.checked })}
                  aria-haspopup={item.hasPopup ? "menu" : undefined}
                  tabIndex={isActive ? 0 : -1}
                  className={`pointer-events-auto absolute flex items-center justify-center rounded-full border focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ember motion-safe:transition-colors ${
                    isActive
                      ? "border-ember bg-ember text-on-ember"
                      : item.checked
                        ? "border-ember bg-ember-wash text-ink"
                        : "border-line-strong bg-card text-ink hover:bg-paper-deep"
                  }`}
                  style={style}
                  onPointerEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onClick={item.run}
                >
                  {item.icon}
                </button>
              );
            })}
            {captionText && (
              <span
                aria-hidden
                className="pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2 rounded-full border border-line-strong bg-paper px-2 py-px text-[11.5px] leading-[1.6] whitespace-nowrap text-ink"
              >
                {captionText}
              </span>
            )}
          </div>
        )}
      </div>

      {searchOpen && (
        <SearchPanel
          anchor={pos}
          size={size}
          vp={vp}
          inputRef={searchInputRef}
          turns={assistantTurns}
          onTurns={setAssistantTurns}
          onClose={() => {
            setSearchOpen(false);
            modelRef.current?.focus({ preventScroll: true });
          }}
        />
      )}
    </div>
  );
}

function SearchPanel({
  anchor,
  size,
  vp,
  inputRef,
  turns,
  onTurns,
  onClose,
}: {
  anchor: Point;
  size: number;
  vp: Viewport;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  turns: AssistantTurn[];
  onTurns: (next: AssistantTurn[]) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [readingIndex, setReadingIndex] = useState<number | null>(null);

  function toggleRead(index: number, markdown: string) {
    if (readingIndex === index) {
      stopSpeech("assistant");
      return;
    }
    setReadingIndex(index);
    void speak("assistant", speakableText(markdown), { userInitiated: true })
      .catch(() => {})
      .finally(() => setReadingIndex((current) => (current === index ? null : current)));
  }

  useEffect(() => () => stopSpeech("assistant"), []);
  const seq = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  const width = Math.min(PANEL_WIDTH, vp.w - EDGE * 2);
  const height = Math.min(PANEL_MAX_HEIGHT, vp.h - EDGE * 2);
  const fitsRight = anchor.x + size + EDGE + width <= vp.w - EDGE;
  const left = clamp(fitsRight ? anchor.x + size + EDGE : anchor.x - width - EDGE, EDGE, vp.w - width - EDGE);
  const top = clamp(anchor.y + size / 2 - height / 2, EDGE, vp.h - height - EDGE);

  // biome-ignore lint/correctness/useExhaustiveDependencies: keep the newest turn in view
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [turns.length, loading]);

  async function ask(history: AssistantTurn[]) {
    const id = ++seq.current;
    onTurns(history);
    setLoading(true);
    try {
      const messages = history.filter((turn) => !turn.failed).map(({ role, text }) => ({ role, text }));
      const { markdown } = await api.askAssistant(messages.slice(-20));
      if (id === seq.current) onTurns([...history, { role: "assistant", text: markdown }]);
    } catch {
      if (id === seq.current) onTurns([...history, { role: "assistant", text: "", failed: true }]);
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }

  function submit() {
    const text = draft.trim().slice(0, 2000);
    if (!text || loading) return;
    setDraft("");
    void ask([...turns.filter((turn) => !turn.failed), { role: "user", text }]);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit();
  }

  function retry() {
    void ask(turns.filter((turn) => !turn.failed));
  }

  function clear() {
    seq.current += 1;
    setLoading(false);
    onTurns([]);
    inputRef.current?.focus({ preventScroll: true });
  }

  return (
    <section
      role="dialog"
      aria-label={t("companion_search_title")}
      className="anim-fade fixed z-40 flex flex-col overflow-hidden rounded-2xl border border-line-strong bg-paper shadow-lg"
      style={{ left, top, width, height }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <header className="flex items-center gap-1 border-b border-line bg-card py-1 pr-1 pl-3">
        <Sparkles className="size-3.5 text-ember" aria-hidden />
        <h2 className="flex-1 text-[13px] font-semibold text-ink">{t("companion_search_title")}</h2>
        {turns.length > 0 && (
          <button
            type="button"
            aria-label={t("companion_search_clear")}
            title={t("companion_search_clear")}
            className="flex size-7 items-center justify-center rounded-full text-ink-soft hover:bg-paper-deep hover:text-ink focus-visible:outline-2 focus-visible:outline-ember"
            onClick={clear}
          >
            <Trash2 className="size-3.5" aria-hidden />
          </button>
        )}
        <button
          type="button"
          aria-label={t("companion_close")}
          className="flex size-7 items-center justify-center rounded-full text-ink-soft hover:bg-paper-deep hover:text-ink focus-visible:outline-2 focus-visible:outline-ember"
          onClick={onClose}
        >
          <X className="size-4" aria-hidden />
        </button>
      </header>
      <div
        ref={listRef}
        className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3 py-3"
        aria-live="polite"
        aria-busy={loading}
      >
        {turns.length === 0 && !loading && (
          <p className="text-[12.5px] leading-[1.8] text-ink-faint">{t("companion_search_hint")}</p>
        )}
        {turns.map((turn, index) =>
          turn.role === "user" ? (
            <p
              // biome-ignore lint/suspicious/noArrayIndexKey: turns are append-only within one panel session
              key={index}
              className="max-w-[85%] self-end whitespace-pre-wrap rounded-2xl rounded-br-md bg-ember-wash px-3 py-1.5 text-[13px] leading-relaxed text-ink"
            >
              {turn.text}
            </p>
          ) : turn.failed ? (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: turns are append-only within one panel session
              key={index}
              className="flex items-center justify-between gap-2 rounded-xl bg-flag-wash px-3 py-1.5"
            >
              <p className="text-[12.5px] text-flag">{t("companion_search_error")}</p>
              <button
                type="button"
                className="rounded-full border border-line-strong bg-paper px-2.5 py-0.5 text-[12px] text-ink hover:bg-paper-deep focus-visible:outline-2 focus-visible:outline-ember"
                onClick={retry}
              >
                {t("companion_search_retry")}
              </button>
            </div>
          ) : (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: turns are append-only within one panel session
              key={index}
              className="max-w-[92%] rounded-2xl rounded-bl-md bg-card px-3 py-1.5 text-[13px]"
            >
              <Markdown>{turn.text}</Markdown>
              <button
                type="button"
                onClick={() => toggleRead(index, turn.text)}
                aria-pressed={readingIndex === index}
                className="mt-1 flex cursor-pointer items-center gap-1 rounded-full px-1.5 py-0.5 text-[11.5px] text-ink-faint hover:bg-paper-deep hover:text-ink"
              >
                {readingIndex === index ? (
                  <Square className="size-3 fill-current" aria-hidden />
                ) : (
                  <Volume2 className="size-3.5" aria-hidden />
                )}
                {readingIndex === index ? t("companion_stop_speaking") : t("companion_read_aloud")}
              </button>
            </div>
          ),
        )}
        {loading && (
          <p className="flex items-center gap-1.5 text-[12.5px] text-ink-faint">
            <LoaderCircle className="size-3.5 motion-safe:animate-spin" aria-hidden />
            {t("companion_search_loading")}
          </p>
        )}
      </div>
      <form className="flex items-end gap-1.5 border-t border-line p-2" onSubmit={onSubmit}>
        <textarea
          ref={inputRef}
          rows={1}
          value={draft}
          maxLength={2000}
          aria-label={t("companion_search_placeholder")}
          placeholder={t("companion_search_placeholder")}
          className="max-h-24 min-h-8 min-w-0 flex-1 resize-none rounded-2xl border border-line-strong bg-card px-3 py-1.5 text-[13px] leading-5 text-ink placeholder:text-ink-faint focus:border-ember focus:outline-none"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <button
          type="submit"
          aria-label={t("companion_search_submit")}
          disabled={!draft.trim() || loading}
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ember text-on-ember disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ember"
        >
          <Send className="size-3.5" aria-hidden />
        </button>
      </form>
    </section>
  );
}
