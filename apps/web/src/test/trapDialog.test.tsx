import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { TrapDialog } from "@/components/ui";
import { stubElementLayout } from "./layout";

stubElementLayout();

function panel(): HTMLElement {
  const node = document.querySelector('[role="dialog"]');
  expect(node).toBeInstanceOf(HTMLElement);
  return node as HTMLElement;
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
  const [first, last] = within(dialog).getAllByRole("button");
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
