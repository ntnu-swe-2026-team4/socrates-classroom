import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMPANION_DOCK_ATTR, SocratesCompanion } from "@/components/SocratesCompanion";
import { setLocale } from "@/i18n";
import { companion, getCompanion, onExpression } from "@/lib/companion";

const scene = vi.hoisted(() => ({
  setSpeaking: vi.fn(),
  setExpression: vi.fn(),
  dispose: vi.fn(),
}));
const stopSpeech = vi.hoisted(() => vi.fn());

vi.mock("@/lib/socrates/scene", () => ({
  createSocratesScene: () => scene,
}));

vi.mock("@/lib/speech", () => ({
  stopSpeech: () => stopSpeech(),
}));

function model() {
  return screen.getByRole("img", { name: "蘇格拉底" });
}

function renderDocked() {
  return render(
    <>
      <div {...{ [COMPANION_DOCK_ATTR]: "" }} />
      <SocratesCompanion />
    </>,
  );
}

beforeEach(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    return this.hasAttribute(COMPANION_DOCK_ATTR) ? new DOMRect(40, 60, 240, 240) : new DOMRect();
  });
  setLocale("zh-TW");
  localStorage.clear();
  scene.setExpression.mockClear();
  scene.setSpeaking.mockClear();
  stopSpeech.mockClear();
  act(() => {
    companion.setVisible(true);
    companion.setMuted(false);
    companion.setSpeakingSource(null);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("companion store", () => {
  it("persists visible and muted flags", () => {
    companion.toggleMuted();
    expect(getCompanion().muted).toBe(true);
    expect(localStorage.getItem("socrates_companion_muted")).toBe("1");
    companion.toggleVisible();
    expect(getCompanion().visible).toBe(false);
    expect(localStorage.getItem("socrates_model_enabled")).toBe("0");
  });

  it("expressions are one-shot events: each call notifies once, neutral maps to no clip", () => {
    const heard: Array<string | null> = [];
    const stop = onExpression((name) => heard.push(name));
    companion.playExpression("Happy");
    companion.playExpression("Happy");
    companion.playExpression("neutral");
    stop();
    companion.playExpression("Angry");
    expect(heard).toEqual(["Happy", "Happy", null]);
  });

  it("reads persisted flags on load and survives a throwing storage", async () => {
    localStorage.setItem("socrates_companion_muted", "1");
    localStorage.setItem("socrates_model_enabled", "0");
    vi.resetModules();
    const fresh = await import("@/lib/companion");
    expect(fresh.getCompanion()).toMatchObject({ muted: true, visible: false });

    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.resetModules();
    const blocked = await import("@/lib/companion");
    expect(blocked.getCompanion()).toMatchObject({ muted: false, visible: true });
    spy.mockRestore();
  });
});

describe("SocratesCompanion", () => {
  it("renders nothing when the model is turned off", () => {
    act(() => companion.setVisible(false));
    renderDocked();
    expect(screen.queryByRole("img", { name: "蘇格拉底" })).toBeNull();
  });

  it("renders nothing when no panel offers a dock", () => {
    const { container } = render(<SocratesCompanion />);
    expect(container.innerHTML).toBe("");
  });

  it("sits on the dock and is display only", () => {
    renderDocked();
    const box = model().parentElement as HTMLElement;
    expect(box.style).toMatchObject({ left: "40px", top: "60px", width: "240px", height: "240px" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("plays an expression once when the dialogue asks for it", () => {
    renderDocked();
    act(() => companion.playExpression("Confused"));
    expect(scene.setExpression).toHaveBeenLastCalledWith("Confused", { loop: false });
  });

  it("shows a reading label with a stop button while a reply is read aloud", async () => {
    const user = userEvent.setup();
    renderDocked();
    expect(screen.queryByRole("status")).toBeNull();
    act(() => companion.setSpeakingSource("dialogue"));
    expect(screen.getByRole("status").textContent).toBe("正在朗讀");
    expect(scene.setSpeaking).toHaveBeenLastCalledWith(true);
    await user.click(screen.getByRole("button", { name: "停止朗讀" }));
    expect(stopSpeech).toHaveBeenCalledTimes(1);
  });

  it("settles the dock tracker after stable frames and re-wakes on layout change", async () => {
    let rect = new DOMRect(40, 60, 240, 240);
    let reads = 0;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      if (this.hasAttribute(COMPANION_DOCK_ATTR)) {
        reads += 1;
        return rect;
      }
      return new DOMRect();
    });
    const queue: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      queue.push(callback);
      return queue.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const pump = (frames: number) => {
      act(() => {
        for (let i = 0; i < frames; i += 1) {
          const batch = queue.splice(0, queue.length);
          for (const callback of batch) callback(performance.now());
        }
      });
    };
    const mutate = async () => {
      await act(async () => {
        document.body.classList.toggle("settle-test");
      });
    };

    renderDocked();
    await act(async () => {});
    pump(10);

    const asleep = reads;
    pump(10);
    expect(reads).toBe(asleep);

    rect = new DOMRect(80, 120, 240, 240);
    await mutate();
    pump(4);
    const box = model().parentElement as HTMLElement;
    expect(box.style).toMatchObject({ left: "80px", top: "120px" });

    const settled = reads;
    pump(10);
    expect(reads).toBe(settled);
  });
});
