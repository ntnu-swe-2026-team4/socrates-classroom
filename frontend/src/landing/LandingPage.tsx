import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Pause, Play, SkipForward } from "lucide-react";
import { api, type Role } from "@/api";
import { keys } from "@/api/queries";
import { BackgroundPaths } from "@/components/BackgroundPaths";
import { LandAnimation } from "./LandAnimation";
import { STORY_SCENES } from "./story";
import { useStoryTour } from "./useStoryTour";
import "./landing.css";

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}

/** 進場動畫：元素第一次捲進畫面時加上 is-visible（樣式在 landing.css） */
function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("is-visible"); io.unobserve(e.target); } }), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}

/** Keep the currently focused story panel slightly behind the scroll position, then ease it into place. */
function useStoryDamping(scroller: { current: HTMLDivElement | null }, reduced: boolean) {
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;

    const panels = Array.from(root.querySelectorAll<HTMLElement>(".land-group"));
    const focus = new Map<HTMLElement, number>();
    panels.forEach((panel) => focus.set(panel, 0));
    let frame = 0;
    let previousTime = 0;

    const clearMotion = () => panels.forEach((panel) => {
      panel.dataset.scrollActive = "false";
      panel.dataset.storyCurrent = "true";
      panel.style.removeProperty("--story-offset-y");
      panel.style.removeProperty("--story-scale");
    });
    if (reduced) {
      clearMotion();
      return;
    }

    const update = (time: number) => {
      frame = 0;
      const viewport = root.getBoundingClientRect();
      const center = viewport.top + root.clientHeight / 2;
      const fadeDistance = Math.max(root.clientHeight * 0.68, 1);
      let active: HTMLElement | null = null;
      let nearest = Number.POSITIVE_INFINITY;

      for (const panel of panels) {
        const rect = panel.getBoundingClientRect();
        const distance = Math.abs(rect.top + rect.height / 2 - center);
        if (distance < nearest) {
          nearest = distance;
          active = panel;
        }
      }

      const elapsed = previousTime ? Math.min(time - previousTime, 64) : 16;
      previousTime = time;
      const damping = 1 - Math.exp(-elapsed / 210);
      let settling = false;

      for (const panel of panels) {
        const rect = panel.getBoundingClientRect();
        const distance = Math.abs(rect.top + rect.height / 2 - center);
        const target = panel === active ? Math.max(0, 1 - distance / fadeDistance) : 0;
        const current = focus.get(panel) ?? 0;
        const next = current + (target - current) * damping;
        focus.set(panel, next);
        panel.style.setProperty("--story-offset-y", `${((1 - next) * 10).toFixed(2)}px`);
        panel.style.setProperty("--story-scale", (0.996 + next * 0.004).toFixed(4));
        panel.dataset.scrollActive = String(next > 0.015 || target > 0.015);
        panel.dataset.storyCurrent = String(panel === active && target > 0.015);
        if (Math.abs(target - next) > 0.002) settling = true;
      }

      if (settling) frame = requestAnimationFrame(update);
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    root.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    schedule();

    return () => {
      root.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
      clearMotion();
    };
  }, [scroller, reduced]);
}

/** 標題拆成一個字一個字，滑鼠靠近時會微微跳起來 */
function LogoTitle({ text }: { text: string }) {
  const reduced = useReducedMotion();
  const words = text.split(" ");
  const ref = useRef<HTMLHeadingElement>(null);
  const move = (e: React.MouseEvent) => {
    if (reduced) return;
    ref.current?.querySelectorAll<HTMLElement>(".char").forEach((span) => {
      const r = span.getBoundingClientRect();
      const d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
      const k = Math.max(0, 1 - d / 90);
      span.style.transform = k > 0 ? `translateY(${-k * 10}px) scale(${1 + k * 0.18})` : "";
    });
  };
  const leave = () => ref.current?.querySelectorAll<HTMLElement>(".char").forEach((s) => { s.style.transform = ""; });
  return (
    <h1 className="logo-title" ref={ref} onMouseMove={move} onMouseLeave={leave} aria-label={text}>
      {words.map((word, wordIndex) => (
        <span className="logo-title-word" key={wordIndex} aria-hidden="true">
          {Array.from(word).map((ch, i) => <span key={i} className="char" style={{ ["--i" as string]: words.slice(0, wordIndex).join(" ").length + i }}>{ch}</span>)}
        </span>
      ))}
    </h1>
  );
}

function Word({ className, children, standalone }: { className?: string; children: ReactNode; standalone?: boolean }) {
  const ref = useReveal<HTMLDivElement>();
  return <div ref={ref} className={`land-word ${standalone ? "land-word-standalone" : ""} ${className ?? ""}`}>{children}</div>;
}

const ICON_STUDENT = <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4L3 8.5 12 13l9-4.5L12 4Z" /><path d="M6.5 10.6V15c0 1.4 2.5 3 5.5 3s5.5-1.6 5.5-3v-4.4" /></svg>;
const ICON_TEACHER = <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5.5C6 4.4 8.4 4 12 4.9V19c-3.6-.9-6-.5-8 .6z" /><path d="M20 5.5C18 4.4 15.6 4 12 4.9V19c3.6-.9 6-.5 8 .6z" /></svg>;

export function LandingPage() {
  const scroller = useRef<HTMLDivElement>(null);
  const signInCard = useRef<HTMLDivElement>(null);
  const storyPlayer = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  useStoryDamping(scroller, reducedMotion);
  const logo = useReveal<HTMLDivElement>();
  const [role, setRole] = useState<Role | null>(null);
  const [tab, setTab] = useState<"login" | "signup">("login");
  const [busy, setBusy] = useState(false);
  const [entryError, setEntryError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [animationDurations, setAnimationDurations] = useState<Record<number, number>>({});
  const recordAnimation = useCallback((n: number, duration: number) => {
    setAnimationDurations((current) => current[n] === duration ? current : { ...current, [n]: duration });
  }, []);
  const { tour, ready: sceneReady, startTour, goToLogin, goToTop, togglePause, nextScene } = useStoryTour(scroller, reducedMotion, animationDurations);
  const navigate = useNavigate();
  const qc = useQueryClient();

  useEffect(() => {
    if (!tour) return;
    const frame = requestAnimationFrame(() => storyPlayer.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [tour?.session]);

  function tiltSignInCard(e: React.MouseEvent<HTMLDivElement>) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const card = e.currentTarget;
    const rect = card.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    card.dataset.tilting = "true";
    card.style.setProperty("--signin-tilt-x", `${-y * 2.4}deg`);
    card.style.setProperty("--signin-tilt-y", `${x * 2.4}deg`);
  }

  function resetSignInCardTilt(e: React.MouseEvent<HTMLDivElement>) {
    const card = e.currentTarget;
    card.dataset.tilting = "false";
    card.style.setProperty("--signin-tilt-x", "0deg");
    card.style.setProperty("--signin-tilt-y", "0deg");
  }

  useEffect(() => {
    const card = signInCard.current;
    if (!card) return;
    let inView = false;
    const sync = () => { card.dataset.running = String(inView && !document.hidden); };
    const observer = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; sync(); }, { threshold: .15 });
    observer.observe(card);
    document.addEventListener("visibilitychange", sync);
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", sync); };
  }, []);

  async function enter() {
    if (!role || busy) return;
    setEntryError("");
    setBusy(true);
    try {
      const user = await api.login({ role, name: "" });
      qc.setQueryData(keys.me, user);
      navigate({ to: "/" });
    } catch {
      setEntryError("暫時無法進入教室，請稍後再試。");
    } finally { setBusy(false); }
  }

  return (
    <div className="landing-root" id="site-scroll" ref={scroller} data-story-tour={Boolean(tour)} data-tour-phase={tour?.phase ?? "idle"}>
      <div id="top-nav">
        <button className="top-nav-btn" title="回到頂端" onClick={goToTop}>
          <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg><span>回到頂端</span>
        </button>
        <button className="top-nav-btn" title="前往登入" onClick={goToLogin}>
          <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg><span>進入教室</span>
        </button>
      </div>

      <section className="land-hero" id="land-hero" inert={Boolean(tour)}>
        <BackgroundPaths variant="hero" />
        <div className="land-logo" ref={logo}>
          <div className="logo-mark">Σ</div>
          <p className="hero-eyebrow">詰問 · 蘇格拉底對話教室</p>
          <LogoTitle text="Socratic Dialogue Classroom" />
          <p className="logo-sub">think out loud. never told the answer.</p>
          <button className="pill-btn primary hero-enter" onClick={startTour}>開始一場對話 <span aria-hidden="true">↓</span></button>
        </div>
      </section>

      {STORY_SCENES.map((scene, index) => (
        <section className="land-group" id={`land-group-${index + 1}`} key={scene.title}
          aria-labelledby={`story-title-${index}`} data-tour-active={tour?.scene === index} inert={Boolean(tour && tour.scene !== index)}>
          <BackgroundPaths variant="story" mirrored={index % 2 === 1} />
          <div className="story-stage">
            <header className="story-chapter"><span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><h2 id={`story-title-${index}`}>{scene.title}</h2></header>
            <div className="land-cluster">
              {scene.animations.map((n, part) => (
                <LandAnimation key={n} n={n} label={scene.title} className={part === 0 ? `is-primary pos-p${index + 1}` : `is-secondary pos-s${index + 1}`}
                  reducedMotion={reducedMotion} tourMode={Boolean(tour)} active={tour?.scene === index}
                  playing={tour?.scene === index && tour.phase === "playing" && sceneReady}
                  preload={Boolean(tour && index >= tour.scene && index <= tour.scene + 1)} session={tour?.session ?? 0} onReady={recordAnimation} />
              ))}
              <Word className={`pos-w${index + 1}`}>{scene.text}</Word>
            </div>
            {scene.aside && <Word standalone>{scene.aside}</Word>}
          </div>
        </section>
      ))}

      {tour && <div className="story-player" ref={storyPlayer} tabIndex={-1} aria-label="故事播放控制">
        <span className="story-player-count" aria-hidden="true">{String(tour.scene + 1).padStart(2, "0")} / 04</span>
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">第 {tour.scene + 1} 幕，共 4 幕。{STORY_SCENES[tour.scene].title}。{!sceneReady ? "載入故事" : tour.phase === "paused" ? "已暫停" : ""}</p>
        <div className="story-player-actions">
          {reducedMotion ? <button className="story-next" onClick={nextScene} disabled={tour.phase === "moving" || tour.phase === "leaving"}>{tour.scene === 3 ? "進入教室" : "下一幕"}<ArrowRight size={16} aria-hidden="true" /></button>
            : <button className="story-pause" onClick={togglePause} disabled={tour.phase === "moving" || tour.phase === "leaving"} aria-label={tour.phase === "paused" ? "繼續播放故事" : "暫停故事"} title={tour.phase === "paused" ? "繼續播放" : "暫停"}>{tour.phase === "paused" ? <Play size={18} aria-hidden="true" /> : <Pause size={18} aria-hidden="true" />}</button>}
          <button className="story-skip" onClick={goToLogin} aria-label="跳過故事，前往登入">跳過<SkipForward size={16} aria-hidden="true" /></button>
        </div>
      </div>}

      <section id="login-screen" aria-labelledby="login-title">
        <BackgroundPaths />
        <div className="login-wrap">
          <div ref={signInCard} className="login-card login-card-split" data-running="false" data-tilting="false" onMouseMove={tiltSignInCard} onMouseLeave={resetSignInCardTilt}>
            <div className="login-card-left">
              <div className="mark">Σ</div>
              <p className="login-eyebrow">詰問 · 蘇格拉底對話教室</p>
              <h2 id="login-title" tabIndex={-1}>從一個好問題開始。</h2>
              <p className="sub">選擇你的身分，展開提問與論證的練習。</p>
              <fieldset className="role-picker" disabled={busy}>
                <legend>我想以這個身分體驗</legend>
                <div className="role-options">
                {([["student", "學生", "進入對話教室，練習提問與論證", ICON_STUDENT], ["teacher", "教師", "管理議題、教室與學生名單", ICON_TEACHER]] as const).map(([r, t, d, icon]) => (
                  <label key={r} className={`role-card${role === r ? " selected" : ""}`}>
                    <input className="role-input" type="radio" name="entry-role" value={r} checked={role === r} onChange={() => { setRole(r); setEntryError(""); }} />
                    <span className="role-indicator" aria-hidden="true">{role === r ? "✓" : ""}</span>
                    <span className="role-icon" aria-hidden="true">{icon}</span><span className="rc-title">{t}</span><span className="rc-desc">{d}</span>
                  </label>
                ))}
                </div>
              </fieldset>
              <button className="pill-btn primary" id="btn-enter" disabled={!role || busy} onClick={enter} aria-busy={busy}>
                {busy ? "正在進入教室…" : role ? `以${role === "student" ? "學生" : "教師"}身分進入` : "選擇身分後進入"}<span aria-hidden="true">→</span>
              </button>
              <p className="entry-note">免帳號體驗 · 重新整理後，示範資料會重置</p>
              {entryError && <p className="entry-error" role="alert">{entryError}</p>}
            </div>
            <div className="login-card-divider" />
            <div className="login-card-right">
              <div className="auth-heading"><h3>帳號服務</h3><span>即將開放</span></div>
              <p className="auth-intro">目前可先選擇身分，免帳號進入示範教室。</p>
              <div className="auth-tabs" role="group" aria-label="帳號服務預覽">
                <button className={`auth-tab${tab === "login" ? " active" : ""}`} type="button" aria-pressed={tab === "login"} onClick={() => { setTab("login"); setShowPassword(false); }}>登入</button>
                <button className={`auth-tab${tab === "signup" ? " active" : ""}`} type="button" aria-pressed={tab === "signup"} onClick={() => { setTab("signup"); setShowPassword(false); }}>註冊帳號</button>
              </div>
              <form key={tab} className="auth-form" onSubmit={(e) => e.preventDefault()} aria-label={tab === "login" ? "登入表單預覽" : "註冊表單預覽"}>
                {tab === "signup" && <div className="field"><label htmlFor="account-name">姓名</label><input id="account-name" autoComplete="name" type="text" placeholder="你的姓名" /></div>}
                <div className="field"><label htmlFor="account-email">電子郵件</label><input id="account-email" autoComplete="email" type="email" placeholder="you@example.com" /></div>
                <div className="field"><label htmlFor="account-password">密碼</label><div className="password-field">
                  <input id="account-password" autoComplete={tab === "login" ? "current-password" : "new-password"} type={showPassword ? "text" : "password"} placeholder={tab === "login" ? "輸入密碼" : "設定一組密碼"} />
                  <button type="button" className="password-toggle" aria-label={showPassword ? "隱藏密碼" : "顯示密碼"} aria-pressed={showPassword} onClick={() => setShowPassword((v) => !v)}>{showPassword ? "隱藏" : "顯示"}</button>
                </div></div>
                {tab === "login" && <button className="auth-forgot" type="button" disabled>忘記密碼？</button>}
                <button className="pill-btn full account-submit" type="submit" disabled aria-describedby="account-availability">{tab === "login" ? "登入" : "建立帳號"}</button>
              </form>
              <p className="auth-note" id="account-availability">帳號登入、註冊與密碼重設尚未開放。</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
