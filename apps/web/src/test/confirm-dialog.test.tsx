import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";

function Scene({
  onConfirm,
  confirmLabel,
  cancelLabel,
}: {
  onConfirm: () => void;
  confirmLabel: string;
  cancelLabel: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        trigger
      </button>
      {open ? (
        <ConfirmDialog
          title={"Remove OpenRouter?"}
          message={"This deletes the key and all of its model legs."}
          confirmLabel={confirmLabel}
          cancelLabel={cancelLabel}
          onConfirm={() => {
            onConfirm();
            setOpen(false);
          }}
          onCancel={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

const labels = {
  title: "Remove OpenRouter?",
  message: "This deletes the key and all of its model legs.",
  confirm: "Remove",
  cancel: "Cancel",
};

afterEach(() => {
  cleanup();
});

function harness(onConfirm = vi.fn(), onCancel = vi.fn()) {
  return render(
    <ConfirmDialog
      title={labels.title}
      message={labels.message}
      confirmLabel={labels.confirm}
      cancelLabel={labels.cancel}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  );
}

test("renders an alertdialog with labelled title and description", () => {
  harness();
  const dialog = screen.getByRole("alertdialog");
  expect(dialog.getAttribute("aria-modal")).toBe("true");
  expect(dialog.getAttribute("aria-labelledby")).toBeTruthy();
  expect(dialog.getAttribute("aria-describedby")).toBeTruthy();
  expect(screen.getByText(labels.title).tagName).toBe("H3");
  expect(screen.getByText(labels.message).tagName).toBe("P");
  expect(screen.getByRole("button", { name: labels.confirm })).toBeTruthy();
  expect(screen.getByRole("button", { name: labels.cancel })).toBeTruthy();
});

test("initial focus lands on the cancel button", () => {
  harness();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: labels.cancel }));
});

test("confirm button fires onConfirm", () => {
  const onConfirm = vi.fn();
  harness(onConfirm);
  fireEvent.click(screen.getByRole("button", { name: labels.confirm }));
  expect(onConfirm).toHaveBeenCalledTimes(1);
});

test("Escape and backdrop clicks cancel without confirming", () => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  harness(onConfirm, onCancel);
  fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onConfirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("alertdialog").parentElement!);
  expect(onCancel).toHaveBeenCalledTimes(2);
});

test("Tab stays trapped inside the dialog", () => {
  harness();
  const dialog = screen.getByRole("alertdialog");
  for (let i = 0; i < 4; i += 1) fireEvent.keyDown(dialog, { key: "Tab" });
  expect(document.activeElement).not.toBe(document.body);
});

test("closing restores focus to the element that was focused before opening", () => {
  const onConfirm = vi.fn();
  const confirmLabel = labels.confirm;
  const cancelLabel = labels.cancel;
  render(
    <Scene
      onConfirm={() => {
        onConfirm();
      }}
      confirmLabel={confirmLabel}
      cancelLabel={cancelLabel}
    />,
  );
  const trigger = screen.getByRole("button", { name: "trigger" });
  trigger.focus();
  fireEvent.click(trigger);
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: labels.cancel }));
  expect(document.activeElement).toBe(trigger);
});
