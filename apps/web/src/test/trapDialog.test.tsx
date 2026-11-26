import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { HoverPopoverPanel, TrapDialog, useHoverPopover } from "@/components/ui";
import { stubElementLayout } from "./layout";
import { must } from "./helpers";

stubElementLayout();

function panel(): HTMLElement {
  const node = document.querySelector('[role="dialog"]');
  if (!(node instanceof HTMLElement)) throw new Error("trap dialog not rendered");
  return node;
}

afterEach(cleanup);

test("traps focus, inerts the background and restores focus on close", () => {
  const page = render(<button type="button">outside</button>);
  const outside = page.getByRole("button");
  outside.focus();
  const view = render(
    <TrapDialog className="relative" onClose={() => {}}>
      <button type="button">first</button>
      <button type="button">last</button>
    </TrapDialog>,
  );
  const dialog = panel();
  const buttons = within(dialog).getAllByRole("button");
  const first = must(buttons[0], "trap dialog first button");
  const last = must(buttons.at(-1), "trap dialog last button");
  expect(document.activeElement).toBe(first);
  expect(page.container.getAttribute("inert")).toBe("");
  expect(view.container.getAttribute("inert")).toBe(null);
  last.focus();
  fireEvent.keyDown(last, { key: "Tab" });
  expect(document.activeElement).toBe(first);
  first.focus();
  fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(last);
  view.unmount();
  expect(document.activeElement).toBe(outside);
  expect(page.container.getAttribute("inert")).toBe(null);
});

test("closes on Escape without leaking the keydown to the page", () => {
  const leaked: string[] = [];
  document.addEventListener("keydown", (event) => leaked.push(event.key));
  const onClose = vi.fn();
  render(
    <TrapDialog className="relative" onClose={onClose}>
      <button type="button">only</button>
    </TrapDialog>,
  );
  fireEvent.keyDown(panel(), { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(leaked).toEqual([]);
});

test("keeps the background inert while a second dialog is still open after the first closes", () => {
  const page = render(<button type="button">outside</button>);
  const bottom = render(
    <TrapDialog className="relative" onClose={() => {}}>
      <button type="button">bottom</button>
    </TrapDialog>,
  );
  const top = render(
    <TrapDialog className="relative" onClose={() => {}}>
      <button type="button">top</button>
    </TrapDialog>,
  );
  expect(page.container.getAttribute("inert")).toBe("");
  bottom.unmount();
  expect(page.container.getAttribute("inert")).toBe("");
  top.unmount();
  expect(page.container.getAttribute("inert")).toBe(null);
});

function HoverHarness({ onOpen }: { onOpen: () => void }) {
  const popover = useHoverPopover(onOpen);
  return (
    <>
      <button type="button" {...popover.hoverProps} onClick={popover.pin}>
        trigger
      </button>
      <HoverPopoverPanel popover={popover} ariaLabelledBy="hover-title" className="relative">
        <h2 id="hover-title">panel</h2>
      </HoverPopoverPanel>
    </>
  );
}

test("hover popover opens on mouse hover, survives the trip to the panel and closes after leaving", () => {
  vi.useFakeTimers();
  try {
    const onOpen = vi.fn();
    const view = render(<HoverHarness onOpen={onOpen} />);
    const trigger = view.getByRole("button", { name: "trigger" });
    fireEvent.pointerOver(trigger, { pointerType: "mouse" });
    act(() => vi.advanceTimersByTime(100));
    expect(document.querySelector('[role="dialog"]')).toBe(null);
    act(() => vi.advanceTimersByTime(100));
    expect(panel().getAttribute("aria-modal")).toBe(null);
    expect(onOpen).toHaveBeenCalledTimes(1);
    fireEvent.pointerOut(trigger, { pointerType: "mouse", relatedTarget: panel() });
    fireEvent.pointerOver(panel(), { pointerType: "mouse", relatedTarget: trigger });
    act(() => vi.advanceTimersByTime(500));
    expect(panel()).toBeInstanceOf(HTMLElement);
    fireEvent.pointerOut(panel(), { pointerType: "mouse" });
    act(() => vi.advanceTimersByTime(250));
    expect(panel().classList.contains("anim-rise-out")).toBe(true);
    fireEvent.pointerOver(panel(), { pointerType: "mouse" });
    expect(panel().classList.contains("anim-rise-out")).toBe(false);
    fireEvent.pointerOut(panel(), { pointerType: "mouse" });
    act(() => vi.advanceTimersByTime(250));
    expect(panel().classList.contains("anim-rise-out")).toBe(true);
    act(() => vi.advanceTimersByTime(107));
    expect(document.querySelector('[role="dialog"]')).toBe(null);
    expect(onOpen).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

test("hover popover ignores touch hover, pins on click and dismisses hover with Escape", () => {
  vi.useFakeTimers();
  try {
    const view = render(<HoverHarness onOpen={() => {}} />);
    const trigger = view.getByRole("button", { name: "trigger" });
    fireEvent.pointerOver(trigger, { pointerType: "touch" });
    act(() => vi.advanceTimersByTime(500));
    expect(document.querySelector('[role="dialog"]')).toBe(null);
    fireEvent.pointerOver(trigger, { pointerType: "mouse" });
    act(() => vi.advanceTimersByTime(500));
    fireEvent.keyDown(document, { key: "Escape" });
    act(() => vi.advanceTimersByTime(107));
    expect(document.querySelector('[role="dialog"]')).toBe(null);
    fireEvent.click(trigger);
    expect(panel().getAttribute("aria-modal")).toBe("true");
    fireEvent.pointerOut(trigger, { pointerType: "mouse" });
    act(() => vi.advanceTimersByTime(500));
    expect(panel().getAttribute("aria-modal")).toBe("true");
  } finally {
    vi.useRealTimers();
  }
});
