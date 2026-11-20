import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "vitest";
import { StanceConstellation } from "@/components/StanceConstellation";
import { dictionaries, setLocale } from "@/i18n";
import type { StanceAxis } from "@/lib/stance";

const zh = dictionaries["zh-TW"];

const axis = (name: string, positions: Record<string, number>): StanceAxis => ({
  name,
  low: `${name}低`,
  high: `${name}高`,
  why: "",
  positions: Object.entries(positions).map(([id, at]) => ({
    id,
    at,
    turns: [1],
    view: `${id}對${name}的想法`,
    end: at < 50 ? "low" : at > 50 ? "high" : "middle",
  })),
});

const axes = [
  axis("後果", { 學生1: 0, 學生2: 10, 學生3: 90, 學生4: 100, 學生5: 50 }),
  axis("手段", { 學生1: 0, 學生2: 0, 學生3: 100, 學生4: 100 }),
  axis("責任", { 學生1: 25, 學生2: 25, 學生3: 75, 學生4: 75 }),
];

const stage = () => document.querySelector("[data-stance-stage]") as SVGSVGElement;
const points = () => [...document.querySelectorAll("[data-stance-point]")];
const pointOf = (id: string) => document.querySelector(`[data-stance-point="${id}"]`) as SVGGElement;

beforeEach(() => setLocale("zh-TW"));
afterEach(cleanup);

test("opens on the first two axes with every student who sits on one of them", () => {
  render(<StanceConstellation axes={axes} />);
  expect(stage().dataset.stanceStage).toBe("2");
  expect(points()).toHaveLength(5);
  expect(screen.getByRole("button", { name: /後果/ }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("button", { name: /責任/ }).getAttribute("aria-pressed")).toBe("false");
});

test("groups students from the report positions and leaves out those missing an axis", () => {
  render(<StanceConstellation axes={axes} />);
  expect(pointOf("學生1").dataset.stanceCluster).toBe("0");
  expect(pointOf("學生2").dataset.stanceCluster).toBe("0");
  expect(pointOf("學生3").dataset.stanceCluster).toBe("1");
  expect(pointOf("學生5").dataset.stanceCluster).toBe("");
  const groups = document.querySelectorAll("[data-stance-group]");
  expect(groups).toHaveLength(2);
  expect(within(groups[0] as HTMLElement).getByText("學生1、學生2")).toBeTruthy();
  expect(screen.getByText(zh.stance_partial_note)).toBeTruthy();
});

test("unfolds from nothing to a line, a plane and a cube as axes are picked", () => {
  render(<StanceConstellation axes={axes} />);
  fireEvent.click(screen.getByRole("button", { name: /後果/ }));
  fireEvent.click(screen.getByRole("button", { name: /手段/ }));
  expect(stage().dataset.stanceStage).toBe("0");
  expect(screen.getByText(zh.stance_empty)).toBeTruthy();
  expect(points()).toHaveLength(5);

  fireEvent.click(screen.getByRole("button", { name: /手段/ }));
  expect(stage().dataset.stanceStage).toBe("1");
  expect(points()).toHaveLength(4);

  fireEvent.click(screen.getByRole("button", { name: /後果/ }));
  fireEvent.click(screen.getByRole("button", { name: /責任/ }));
  expect(stage().dataset.stanceStage).toBe("3");
  expect(stage().getAttribute("tabindex")).toBe("0");
  expect(screen.getByRole("button", { name: zh.stance_reset_view })).toBeTruthy();
});

test("turning off grouping removes the group cards", () => {
  render(<StanceConstellation axes={axes} />);
  fireEvent.click(screen.getByRole("tab", { name: zh.stance_cluster_off }));
  expect(document.querySelectorAll("[data-stance-group]")).toHaveLength(0);
  expect(pointOf("學生1").dataset.stanceCluster).toBe("");
});

test("says so when too few students took a position to group", () => {
  render(<StanceConstellation axes={[axis("後果", { 學生1: 0, 學生2: 100 })]} />);
  expect(screen.getByText(zh.stance_cluster_few)).toBeTruthy();
});

test("picking a dot shows that student's thinking on each picked axis", () => {
  render(<StanceConstellation axes={axes} />);
  expect(screen.getByText(zh.stance_select_hint)).toBeTruthy();
  fireEvent.click(pointOf("學生5"));
  expect(screen.getByText(/學生5對後果的想法/)).toBeTruthy();
  expect(screen.getByText(new RegExp(zh.stance_not_on_axis))).toBeTruthy();
});

test("the dots are reachable by keyboard: one tab stop, arrows move, Enter picks", () => {
  render(<StanceConstellation axes={axes} />);
  const stops = points().filter((node) => node.getAttribute("tabindex") === "0");
  expect(stops).toHaveLength(1);
  expect(stops[0]).toBe(pointOf("學生1"));
  pointOf("學生1").focus();
  fireEvent.keyDown(pointOf("學生1"), { key: "ArrowRight" });
  expect(document.activeElement).toBe(pointOf("學生2"));
  expect(pointOf("學生2").getAttribute("tabindex")).toBe("0");
  fireEvent.keyDown(pointOf("學生2"), { key: "Enter" });
  expect(pointOf("學生2").getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByText(/學生2對後果的想法/)).toBeTruthy();
  fireEvent.keyDown(pointOf("學生1"), { key: "ArrowLeft" });
  expect(document.activeElement).toBe(pointOf("學生5"));
});

test("says so when asked for more groups than there are students", () => {
  render(<StanceConstellation axes={[axis("後果", { 學生1: 0, 學生2: 50, 學生3: 100 })]} />);
  fireEvent.click(screen.getByRole("tab", { name: zh.stance_cluster_count.replace("{n}", "4") }));
  expect(screen.getByText(zh.stance_cluster_short.replace("{n}", "3"))).toBeTruthy();
});
