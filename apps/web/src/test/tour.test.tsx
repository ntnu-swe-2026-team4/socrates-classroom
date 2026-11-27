import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { OnboardingTour, TOUR_RAIL_ATTR } from "@/components/OnboardingTour";
import { setLocale } from "@/i18n";
import { TOUR_STEPS, finishTour, resetTourMemory, startTour, useTourActive } from "@/lib/tour";

function Harness({ userId, onStep = () => {} }: { userId: string | undefined; onStep?: (step: string) => void }) {
  const active = useTourActive(userId);
  return (
    <>
      <nav {...{ [TOUR_RAIL_ATTR]: "" }}>
        {TOUR_STEPS.map((step) => (
          <button key={step} type="button" data-tour={step}>
            {step}
          </button>
        ))}
      </nav>
      {active && userId ? <OnboardingTour userId={userId} onStep={onStep} /> : <p>no tour</p>}
    </>
  );
}

beforeEach(() => {
  localStorage.clear();
  act(() => resetTourMemory());
  setLocale("zh-TW");
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const order = TOUR_STEPS.map(String).indexOf(this.dataset.tour ?? "");
    return order < 0 ? new DOMRect() : new DOMRect(6, 100 + order * 80, 76, 60);
  });
});

test("opens by itself for an account that has not seen it and walks the rail one button at a time", async () => {
  const user = userEvent.setup();
  const onStep = vi.fn();
  const { container } = render(<Harness userId="u1" onStep={onStep} />);

  const dialog = screen.getByRole("dialog", { name: "首頁" });
  expect(dialog.textContent).toContain(`1 / ${TOUR_STEPS.length}`);
  expect(container.querySelector('[data-tour-spot="home"][data-located="true"]')).not.toBeNull();
  expect(screen.queryByRole("button", { name: "上一步" })).toBeNull();

  await user.click(screen.getByRole("button", { name: "下一步" }));
  await user.click(screen.getByRole("button", { name: "下一步" }));
  expect(screen.getByRole("dialog", { name: "教室" })).toBeTruthy();
  expect(onStep).toHaveBeenLastCalledWith("classrooms");
  expect(container.querySelector('[data-tour-spot="classrooms"]')).not.toBeNull();

  await user.click(screen.getByRole("button", { name: "上一步" }));
  expect(screen.getByRole("dialog", { name: "提問" })).toBeTruthy();
});

test("finishing on the last step remembers the account and does not open again", async () => {
  const user = userEvent.setup();
  const view = render(<Harness userId="u1" />);
  for (let step = 1; step < TOUR_STEPS.length; step += 1) {
    await user.click(screen.getByRole("button", { name: "下一步" }));
  }
  await user.click(screen.getByRole("button", { name: "完成" }));
  expect(screen.getByText("no tour")).toBeTruthy();
  expect(localStorage.getItem("tour-seen:u1")).toBe("1");

  view.unmount();
  render(<Harness userId="u1" />);
  expect(screen.getByText("no tour")).toBeTruthy();
});

test("skip and Escape both close it, and each account is tracked separately", async () => {
  const user = userEvent.setup();
  const first = render(<Harness userId="u1" />);
  await user.click(screen.getByRole("button", { name: "略過" }));
  expect(screen.getByText("no tour")).toBeTruthy();
  first.unmount();

  render(<Harness userId="u2" />);
  screen.getByRole("dialog", { name: "首頁" }).focus();
  await user.keyboard("{Escape}");
  expect(screen.getByText("no tour")).toBeTruthy();
});

test("replaying from settings shows it again from the first step, and guests never see it", () => {
  act(() => finishTour("u1"));
  const view = render(<Harness userId="u1" />);
  expect(screen.getByText("no tour")).toBeTruthy();
  act(() => startTour());
  expect(screen.getByRole("dialog", { name: "首頁" })).toBeTruthy();
  view.unmount();

  act(() => resetTourMemory());
  render(<Harness userId={undefined} />);
  expect(screen.getByText("no tour")).toBeTruthy();
});

test("falls back to a centred card when the button is not on screen", () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => new DOMRect());
  const { container } = render(<Harness userId="u1" />);
  expect(screen.getByRole("dialog", { name: "首頁" })).toBeTruthy();
  expect(container.querySelector('[data-tour-spot][data-located="false"]')).not.toBeNull();
});
