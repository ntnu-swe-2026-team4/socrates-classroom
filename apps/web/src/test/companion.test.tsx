import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SocratesCompanion } from "@/components/SocratesCompanion";
import { setLocale } from "@/i18n";
import { companion, getCompanion, onExpression } from "@/lib/companion";

const scene = vi.hoisted(() => ({
  setSpeaking: vi.fn(),
  setExpression: vi.fn(),
  dispose: vi.fn(),
}));
const askAssistant = vi.hoisted(() => vi.fn());

vi.mock("@/lib/socrates/scene", () => ({
  createSocratesScene: () => scene,
}));

vi.mock("@/api", () => ({
  api: { askAssistant: (...args: unknown[]) => askAssistant(...args) },
}));

function model() {
  return screen.getByRole("button", { name: /蘇格拉底：/ });
}

function menuItems() {
  return [
    ...screen.queryAllByRole("menuitem"),
    ...screen.queryAllByRole("menuitemcheckbox"),
    ...screen.queryAllByRole("menuitemradio"),
  ].sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
}

function pointer(type: "pointerDown" | "pointerMove" | "pointerUp", x: number, y: number) {
  fireEvent[type](model(), { pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, clientX: x, clientY: y });
}

beforeEach(() => {
  setLocale("zh-TW");
  localStorage.clear();
  askAssistant.mockReset();
  scene.setExpression.mockClear();
  scene.setSpeaking.mockClear();
  act(() => {
    companion.setVisible(true);
    companion.setMuted(false);
    companion.setSpeakingSource(null);
  });
});

describe("companion store", () => {
  it("persists visible and muted flags", () => {
    companion.toggleMuted();
    expect(getCompanion().muted).toBe(true);
    expect(localStorage.getItem("socrates_companion_muted")).toBe("1");
    companion.toggleVisible();
    expect(getCompanion().visible).toBe(false);
    expect(localStorage.getItem("socrates_companion_visible")).toBe("0");
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
    localStorage.setItem("socrates_companion_visible", "0");
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
  it("renders nothing when hidden", () => {
    act(() => companion.setVisible(false));
    const { container } = render(<SocratesCompanion />);
    expect(container.innerHTML).toBe("");
  });

  it("opens the radial menu on double click and closes it with Escape", async () => {
    const user = userEvent.setup();
    render(<SocratesCompanion />);
    expect(screen.queryByRole("menu")).toBeNull();
    await user.dblClick(model());
    expect(screen.getByRole("menu", { name: "蘇格拉底選單" })).toBeTruthy();
    expect(menuItems()).toHaveLength(3);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(model());
  });

  it("does not open the menu when the double click follows a drag, and persists the position", () => {
    render(<SocratesCompanion />);
    pointer("pointerDown", 900, 500);
    pointer("pointerMove", 700, 400);
    pointer("pointerUp", 700, 400);
    fireEvent.click(model());
    pointer("pointerDown", 700, 400);
    pointer("pointerUp", 700, 400);
    fireEvent.click(model());
    fireEvent.doubleClick(model());
    expect(screen.queryByRole("menu")).toBeNull();
    const saved = JSON.parse(localStorage.getItem("socrates_companion_position") ?? "null");
    expect(saved).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
  });

  it("opens with Enter and navigates items with arrow keys", async () => {
    const user = userEvent.setup();
    render(<SocratesCompanion />);
    model().focus();
    await user.keyboard("{Enter}");
    const items = menuItems();
    expect(document.activeElement).toBe(items[0]);
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(screen.getByRole("menuitemcheckbox", { name: "靜音" }));
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "表情" }));
  });

  it("toggles mute from the menu", async () => {
    const user = userEvent.setup();
    render(<SocratesCompanion />);
    await user.dblClick(model());
    const mute = screen.getByRole("menuitemcheckbox", { name: "靜音" });
    expect(mute.getAttribute("aria-checked")).toBe("false");
    await user.click(mute);
    expect(getCompanion().muted).toBe(true);
    expect(screen.getByRole("menuitemcheckbox", { name: "靜音" }).getAttribute("aria-checked")).toBe("true");
  });

  it("plays a picked expression once (no loop) from the expression sub-menu", async () => {
    const user = userEvent.setup();
    render(<SocratesCompanion />);
    await user.dblClick(model());
    await user.click(screen.getByRole("menuitem", { name: "表情" }));
    expect(screen.queryAllByRole("menuitemradio")).toHaveLength(0);
    await user.click(screen.getByRole("menuitem", { name: "開心" }));
    expect(scene.setExpression).toHaveBeenLastCalledWith("Happy", { loop: false });
    expect(screen.queryByRole("menu")).toBeNull();

    act(() => companion.playExpression("Confused"));
    expect(scene.setExpression).toHaveBeenLastCalledWith("Confused", { loop: false });
  });

  it("asks the AI, keeps the conversation for follow-ups, retries failures and clears", async () => {
    const user = userEvent.setup();
    render(<SocratesCompanion />);
    await user.dblClick(model());
    await user.click(screen.getByRole("menuitem", { name: "問 AI" }));
    const input = await screen.findByRole("textbox", { name: "想知道什麼？直接問…" });

    askAssistant.mockRejectedValueOnce(new Error("llm_unavailable"));
    await user.type(input, "光速是多少？{Enter}");
    await screen.findByText("暫時無法回答，請再試一次。");

    askAssistant.mockResolvedValueOnce({ markdown: "約每秒 **30 萬公里**" });
    await user.click(screen.getByRole("button", { name: "重試" }));
    await waitFor(() => expect(screen.getByText("30 萬公里")).toBeTruthy());
    expect(askAssistant).toHaveBeenNthCalledWith(2, [{ role: "user", text: "光速是多少？" }]);

    askAssistant.mockResolvedValueOnce({ markdown: "約每秒 343 公尺" });
    await user.type(input, "那聲速呢？{Enter}");
    await waitFor(() => expect(screen.getByText("約每秒 343 公尺")).toBeTruthy());
    expect(askAssistant).toHaveBeenLastCalledWith([
      { role: "user", text: "光速是多少？" },
      { role: "assistant", text: "約每秒 **30 萬公里**" },
      { role: "user", text: "那聲速呢？" },
    ]);

    await user.click(screen.getByRole("button", { name: "清除對話" }));
    expect(screen.queryByText("約每秒 343 公尺")).toBeNull();
    await user.click(screen.getByRole("button", { name: "關閉" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
