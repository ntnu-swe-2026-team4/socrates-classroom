import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Topic } from "@socrates/shared";
import { AddTopic, StartActivity } from "@/components/ClassroomTopics";
import { ApiError } from "@/api/http";
import { clientConfigOptions } from "@/api/queries";
import { setLocale } from "@/i18n";

const listClassroomTopics = vi.fn();
const listTopics = vi.fn();
const copyTopic = vi.fn();
const startActivity = vi.fn();
const config = vi.fn();
const createClassroomTopic = vi.fn();

vi.mock("@/api", async (importOriginal) => ({
  ApiError: (await importOriginal<typeof import("@/api")>()).ApiError,
  api: {
    createClassroomTopic: (...args: unknown[]) => createClassroomTopic(...args),
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

function renderStart(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
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
  config.mockReset().mockResolvedValue({ reportAxes: "teacher" });
  listClassroomTopics.mockResolvedValue([withAxes, legacy]);
  listTopics.mockResolvedValue([]);
  createClassroomTopic.mockReset();
  copyTopic.mockReset();
  startActivity.mockReset();
});
afterEach(cleanup);

describe("StartActivity: the picked topic's axes", () => {
  it("unchanged axes start the topic itself, with no copy", async () => {
    startActivity.mockResolvedValue(started);
    const onStarted = renderStart();
    fireEvent.click(await screen.findByRole("button", { name: /Topic with axes/ }));
    expect(await screen.findByRole("textbox", { name: "What this axis asks 1" })).toHaveProperty("value", "Justice");
    fireEvent.click(screen.getByRole("button", { name: "Start activity" }));
    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    expect(copyTopic).not.toHaveBeenCalled();
    expect(startActivity).toHaveBeenCalledWith("c1", "t_axes", "live", "teacher", undefined);
  });

  it("sends edited axes in the start request and keeps them after a failed start", async () => {
    startActivity.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(started);
    const onStarted = renderStart();
    fireEvent.click(await screen.findByRole("button", { name: /Old topic/ }));
    const start = screen.getByRole("button", { name: "Start activity" });
    expect(start).toHaveProperty("disabled", true);
    fireEvent.change(await screen.findByRole("textbox", { name: "What this axis asks 1" }), { target: { value: "Q" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Left end 1" }), { target: { value: "L" } });
    fireEvent.change(await screen.findByRole("textbox", { name: "Right end 1" }), { target: { value: "R" } });
    await waitFor(() => expect(start).toHaveProperty("disabled", false));
    fireEvent.click(start);
    await waitFor(() => expect(startActivity).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(start).toHaveProperty("disabled", false));
    fireEvent.click(start);
    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    expect(copyTopic).not.toHaveBeenCalled();
    expect(startActivity).toHaveBeenCalledTimes(2);
    expect(startActivity).toHaveBeenNthCalledWith(1, "c1", "t_legacy", "live", "teacher", [
      { name: "Q", left: "L", right: "R" },
    ]);
    expect(startActivity.mock.calls[1]).toEqual(startActivity.mock.calls[0]);
  });

  it("re-clicking the picked topic keeps the teacher's edits", async () => {
    renderStart();
    fireEvent.click(await screen.findByRole("button", { name: /Topic with axes/ }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Right end 1" }), { target: { value: "Results" } });
    fireEvent.click(screen.getByRole("button", { name: /Topic with axes/ }));
    expect(await screen.findByRole("textbox", { name: "Right end 1" })).toHaveProperty("value", "Results");
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
    expect(startActivity).toHaveBeenCalledWith("c1", "t_legacy", "live", "ai", undefined);
  });
});

describe("StartActivity when the backend lets the teacher choose (report axes = both)", () => {
  it("offers the choice, set by the teacher first; choosing AI hides the axes and starts the topic as it is", async () => {
    config.mockResolvedValue({ reportAxes: "both" });
    startActivity.mockResolvedValue(started);
    const onStarted = renderStart();
    fireEvent.click(await screen.findByRole("button", { name: /Old topic/ }));
    expect(await screen.findByRole("radio", { name: "Set by me" })).toHaveProperty("checked", true);
    expect(await screen.findByRole("textbox", { name: "What this axis asks 1" })).toBeTruthy();
    const start = screen.getByRole("button", { name: "Start activity" });
    expect(start).toHaveProperty("disabled", true);

    fireEvent.click(screen.getByRole("radio", { name: "AI, from the class's dialogues" }));
    await waitFor(() => expect(start).toHaveProperty("disabled", false));
    expect(screen.queryByRole("textbox", { name: "What this axis asks 1" })).toBeNull();
    fireEvent.click(start);
    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    expect(copyTopic).not.toHaveBeenCalled();
    expect(startActivity).toHaveBeenCalledWith("c1", "t_legacy", "live", "ai", undefined);
  });

  it("refreshes the policy after a rejection and retains unsaved axes", async () => {
    config.mockResolvedValueOnce({ reportAxes: "both" }).mockResolvedValueOnce({ reportAxes: "ai" });
    startActivity.mockRejectedValueOnce(new ApiError("report_axes_not_allowed", "Policy locked"));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onStarted = renderStart(client);
    fireEvent.click(await screen.findByRole("button", { name: /Topic with axes/ }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Right end 1" }), { target: { value: "Results" } });
    fireEvent.click(screen.getByRole("button", { name: "Start activity" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("The value-axis setting changed.");
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Right end 1" })).toBeNull());
    expect(startActivity).toHaveBeenCalledTimes(1);
    expect(onStarted).not.toHaveBeenCalled();

    config.mockResolvedValue({ reportAxes: "both" });
    await client.invalidateQueries({ queryKey: clientConfigOptions.queryKey });
    expect(await screen.findByRole("textbox", { name: "Right end 1" })).toHaveProperty("value", "Results");
  });

  it("does not offer the choice when the backend locks one", async () => {
    config.mockResolvedValue({ reportAxes: "teacher" });
    renderStart();
    fireEvent.click(await screen.findByRole("button", { name: /Topic with axes/ }));
    await screen.findByRole("textbox", { name: "What this axis asks 1" });
    expect(screen.queryByRole("radio", { name: "Set by me" })).toBeNull();
  });
});

it("saves value axes with a custom classroom topic", async () => {
  config.mockResolvedValue({ reportAxes: "both" });
  createClassroomTopic.mockResolvedValue(withAxes);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AddTopic classroomId="c1" />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Custom topic title" }), { target: { value: "Fairness" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Statement under discussion" }), {
    target: { value: "What is fair?" },
  });
  fireEvent.click(await screen.findByRole("button", { name: "Add an axis" }));
  fireEvent.change(screen.getByRole("textbox", { name: "What this axis asks 1" }), { target: { value: " Justice " } });
  fireEvent.change(screen.getByRole("textbox", { name: "Left end 1" }), { target: { value: "Rules" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Right end 1" }), { target: { value: "Outcomes" } });
  fireEvent.click(screen.getByRole("button", { name: "Add to topics" }));
  await waitFor(() =>
    expect(createClassroomTopic).toHaveBeenCalledWith("c1", {
      title: "Fairness",
      statement: "What is fair?",
      prompts: [],
      axes: [{ name: "Justice", left: "Rules", right: "Outcomes" }],
    }),
  );
});
