import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Topic } from "@socrates/shared";
import { StartActivity } from "@/components/ClassroomTopics";
import { setLocale } from "@/i18n";

const listClassroomTopics = vi.fn();
const listTopics = vi.fn();
const copyTopic = vi.fn();
const startActivity = vi.fn();
const config = vi.fn();

vi.mock("@/api", () => ({
  api: {
    config: (...args: unknown[]) => config(...args),
    listClassroomTopics: (...args: unknown[]) => listClassroomTopics(...args),
    listTopics: (...args: unknown[]) => listTopics(...args),
    copyTopic: (...args: unknown[]) => copyTopic(...args),
    startActivity: (...args: unknown[]) => startActivity(...args),
  },
}));

const withAxes: Topic = {
  id: "t_axes",
  classroomId: "c1",
  title: "Topic with axes",
  statement: "s",
  prompts: [],
  axes: [{ name: "Justice", left: "Rules", right: "Outcomes" }],
};
const legacy: Topic = { ...withAxes, id: "t_legacy", title: "Old topic", axes: [] };
const started = { classroomId: "c1", code: "abcdef", url: "u", activityId: "a1", mode: "live" as const };

function renderStart() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onStarted = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <StartActivity classroomId="c1" allowTest={false} onStarted={onStarted} />
    </QueryClientProvider>,
  );
  return onStarted;
}

beforeEach(() => {
  setLocale("en");
  config.mockResolvedValue({ reportAxes: "teacher" });
  listClassroomTopics.mockResolvedValue([withAxes, legacy]);
  listTopics.mockResolvedValue([]);
  copyTopic.mockReset();
  startActivity.mockReset();
});
afterEach(cleanup);

describe("StartActivity: the picked topic's axes", () => {
  it("unchanged axes start the topic itself, with no copy", async () => {
    startActivity.mockResolvedValue(started);
    const onStarted = renderStart();
    fireEvent.click(await screen.findByRole("button", { name: /Topic with axes/ }));
    expect(screen.getByRole("textbox", { name: "What this axis asks 1" })).toHaveProperty("value", "Justice");
    fireEvent.click(screen.getByRole("button", { name: "Start activity" }));
    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    expect(copyTopic).not.toHaveBeenCalled();
    expect(startActivity).toHaveBeenCalledWith("c1", "t_axes", "live", "teacher");
  });

  it("a topic without axes needs them; it starts on a copy with those axes, saved once across a retry", async () => {
    copyTopic.mockResolvedValue({ ...legacy, id: "t_copy", axes: [{ name: "Q", left: "L", right: "R" }] });
    startActivity.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(started);
    const onStarted = renderStart();
    fireEvent.click(await screen.findByRole("button", { name: /Old topic/ }));
    const start = screen.getByRole("button", { name: "Start activity" });
    expect(start).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByRole("textbox", { name: "What this axis asks 1" }), { target: { value: "Q" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Left end 1" }), { target: { value: "L" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Right end 1" }), { target: { value: "R" } });
    await waitFor(() => expect(start).toHaveProperty("disabled", false));
    fireEvent.click(start);
    await waitFor(() => expect(startActivity).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(start).toHaveProperty("disabled", false));
    fireEvent.click(start);
    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    expect(copyTopic).toHaveBeenCalledTimes(1);
    expect(copyTopic).toHaveBeenCalledWith("t_legacy", "c1", [{ name: "Q", left: "L", right: "R" }]);
    expect(startActivity).toHaveBeenLastCalledWith("c1", "t_copy", "live", "teacher");
  });

  it("re-clicking the picked topic keeps the teacher's edits", async () => {
    renderStart();
    fireEvent.click(await screen.findByRole("button", { name: /Topic with axes/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Right end 1" }), { target: { value: "Results" } });
    fireEvent.click(screen.getByRole("button", { name: /Topic with axes/ }));
    expect(screen.getByRole("textbox", { name: "Right end 1" })).toHaveProperty("value", "Results");
  });
});

describe("StartActivity when the model sets the axes (report.axes = ai)", () => {
  it("shows no axes editor and starts any topic as it is, with no copy", async () => {
    config.mockResolvedValue({ reportAxes: "ai" });
    startActivity.mockResolvedValue(started);
    const onStarted = renderStart();
    fireEvent.click(await screen.findByRole("button", { name: /Old topic/ }));
    const start = screen.getByRole("button", { name: "Start activity" });
    await waitFor(() => expect(start).toHaveProperty("disabled", false));
    expect(screen.queryByRole("textbox", { name: "What this axis asks 1" })).toBeNull();
    expect(screen.queryByText("Justice: Rules ↔ Outcomes")).toBeNull();
    fireEvent.click(start);
    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    expect(copyTopic).not.toHaveBeenCalled();
    expect(startActivity).toHaveBeenCalledWith("c1", "t_legacy", "live", "ai");
  });
});

describe("StartActivity when the backend lets the teacher choose (report axes = both)", () => {
  it("offers the choice, set by the teacher first; choosing AI hides the axes and starts the topic as it is", async () => {
    config.mockResolvedValue({ reportAxes: "both" });
    startActivity.mockResolvedValue(started);
    const onStarted = renderStart();
    fireEvent.click(await screen.findByRole("button", { name: /Old topic/ }));
    expect(await screen.findByRole("tab", { name: "Set by me" })).toHaveProperty("ariaSelected", "true");
    // set by the teacher: this topic has no axes, so it cannot start yet
    expect(screen.getByRole("textbox", { name: "What this axis asks 1" })).toBeTruthy();
    const start = screen.getByRole("button", { name: "Start activity" });
    expect(start).toHaveProperty("disabled", true);

    fireEvent.click(screen.getByRole("tab", { name: "AI, from the class's dialogues" }));
    await waitFor(() => expect(start).toHaveProperty("disabled", false));
    expect(screen.queryByRole("textbox", { name: "What this axis asks 1" })).toBeNull();
    fireEvent.click(start);
    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    expect(copyTopic).not.toHaveBeenCalled();
    expect(startActivity).toHaveBeenCalledWith("c1", "t_legacy", "live", "ai");
  });

  it("does not offer the choice when the backend locks one", async () => {
    config.mockResolvedValue({ reportAxes: "teacher" });
    renderStart();
    fireEvent.click(await screen.findByRole("button", { name: /Topic with axes/ }));
    expect(screen.queryByRole("tab", { name: "Set by me" })).toBeNull();
  });
});
