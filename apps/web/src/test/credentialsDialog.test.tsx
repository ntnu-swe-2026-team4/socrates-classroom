import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { StudentCredential } from "@socrates/shared";
import { CredentialsDialog } from "@/components/ClassroomCommunity";
import { setLocale } from "@/i18n";
import { stubElementLayout } from "./layout";

stubElementLayout();

const credentials: StudentCredential[] = [
  { id: "u_1", name: "Ada", username: "ethics-01", password: "demo-one" },
  { id: "u_2", name: "Ben", username: "ethics-02", password: "demo-two" },
];

function dialogRoot(): HTMLElement {
  const node = document.querySelector('[role="dialog"]');
  expect(node).toBeInstanceOf(HTMLElement);
  return node as HTMLElement;
}

beforeEach(() => {
  setLocale("en");
});

afterEach(cleanup);

test("renders through a portal, moves focus in and inerts the page behind it", () => {
  const page = render(<button type="button">outside</button>);
  const outside = page.getByRole("button");
  outside.focus();
  const view = render(<CredentialsDialog credentials={credentials} onClose={() => {}} />);
  const dialog = dialogRoot();
  const [copy] = within(dialog).getAllByRole("button");
  expect(document.activeElement).toBe(copy);
  expect(view.container.contains(dialog)).toBe(false);
  expect(document.body.contains(dialog)).toBe(true);
  expect(page.container.getAttribute("inert")).toBe("");
  view.unmount();
  expect(document.activeElement).toBe(outside);
  expect(page.container.getAttribute("inert")).toBe(null);
});

test("closes on Escape without leaking the keydown to the page", () => {
  const leaked: string[] = [];
  document.addEventListener("keydown", (event) => leaked.push(event.key));
  const onClose = vi.fn();
  render(<CredentialsDialog credentials={credentials} onClose={onClose} />);
  fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(leaked).toEqual([]);
});

test("wraps Tab focus inside the dialog", () => {
  render(<CredentialsDialog credentials={credentials} onClose={() => {}} />);
  const dialog = dialogRoot();
  const [copy, done] = within(dialog).getAllByRole("button");
  done.focus();
  fireEvent.keyDown(done, { key: "Tab" });
  expect(document.activeElement).toBe(copy);
  copy.focus();
  fireEvent.keyDown(copy, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(done);
});
