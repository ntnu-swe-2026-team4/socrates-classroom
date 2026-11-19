import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { AXES_MAX, AxisSchema, type Axis } from "@socrates/shared";
import { api, type Topic } from "@/api";
import { Button, Input } from "@/components/ui";
import { useT } from "@/i18n";

/** An axis being edited; key keeps each row's identity when another row is removed. */
export type AxisDraft = Axis & { key: number };
let nextDraftKey = 0;

export function draftOf(axis: Axis = { name: "", left: "", right: "" }): AxisDraft {
  nextDraftKey += 1;
  return { ...axis, key: nextDraftKey };
}

/** A topic's axes as editable rows; a topic without any starts with one empty row unless the axes are optional. */
export function draftsOf(axes: Axis[], optional = false): AxisDraft[] {
  return axes.length > 0 || optional ? axes.map((axis) => draftOf(axis)) : [draftOf()];
}

export function axesOf(drafts: AxisDraft[]): Axis[] {
  return drafts.map((axis) => ({ name: axis.name.trim(), left: axis.left.trim(), right: axis.right.trim() }));
}

function duplicateNames(drafts: AxisDraft[]): boolean {
  const names = axesOf(drafts)
    .map((axis) => axis.name)
    .filter(Boolean);
  return new Set(names).size !== names.length;
}

/** Complete axes with different names, as the server requires: 1-3, or 0-3 when they are optional. */
export function axesValid(drafts: AxisDraft[], optional = false): boolean {
  return (
    drafts.length >= (optional ? 0 : 1) &&
    drafts.length <= AXES_MAX &&
    axesOf(drafts).every((axis) => AxisSchema.safeParse(axis).success) &&
    !duplicateNames(drafts)
  );
}

function sameAxes(a: Axis[], b: Axis[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The topic to start with these axes: the topic itself when its axes are unchanged, otherwise a copy of it in the
 * classroom with these axes (a saved topic never changes, so running activities and their reports keep the axes
 * students saw).
 * A copy is remembered, so retrying after a later step failed reuses it instead of saving another one.
 */
export function useTopicWithAxes(classroomId: string): (topic: Topic, axes: Axis[]) => Promise<string> {
  const saved = useRef(new Map<string, string>());
  return async (topic, axes) => {
    if (sameAxes(topic.axes, axes)) return topic.id;
    const key = JSON.stringify([classroomId, topic.id, axes]);
    const known = saved.current.get(key);
    if (known) return known;
    const copy = await api.copyTopic(topic.id, classroomId, axes);
    saved.current.set(key, copy.id);
    return copy.id;
  };
}

/**
 * The teacher's value axes for a topic (1-3, as in the main project): what each asks and its two ends. Optional, the
 * teacher may leave none (a topic used when the model sets the axes).
 */
export function AxesEditor({
  axes,
  onChange,
  disabled = false,
  optional = false,
}: {
  axes: AxisDraft[];
  onChange: (axes: AxisDraft[]) => void;
  disabled?: boolean;
  optional?: boolean;
}) {
  const t = useT();
  const edit = (index: number, key: keyof Axis, value: string) =>
    onChange(axes.map((axis, i) => (i === index ? { ...axis, [key]: value } : axis)));
  return (
    <fieldset className="flex flex-col gap-2 border-t border-line pt-4">
      <legend className="text-[13px] font-medium text-ink">
        {t(optional ? "setup_axes_label_optional" : "setup_axes_label")}
      </legend>
      <p className="text-[12.5px] leading-relaxed text-ink-faint">{t("setup_axes_hint")}</p>
      {axes.map((axis, index) => (
        <div key={axis.key} className="flex flex-col gap-2 rounded-xl border border-line p-3">
          <Input
            aria-label={`${t("setup_axis_name")} ${index + 1}`}
            placeholder={t("setup_axis_name")}
            value={axis.name}
            maxLength={40}
            disabled={disabled}
            onChange={(event) => edit(index, "name", event.target.value)}
          />
          <div className="flex items-center gap-2">
            <Input
              aria-label={`${t("setup_axis_left")} ${index + 1}`}
              placeholder={t("setup_axis_left")}
              value={axis.left}
              maxLength={40}
              disabled={disabled}
              onChange={(event) => edit(index, "left", event.target.value)}
            />
            <span className="text-ink-faint">↔</span>
            <Input
              aria-label={`${t("setup_axis_right")} ${index + 1}`}
              placeholder={t("setup_axis_right")}
              value={axis.right}
              maxLength={40}
              disabled={disabled}
              onChange={(event) => edit(index, "right", event.target.value)}
            />
          </div>
          {axes.length > (optional ? 0 : 1) && (
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              aria-label={`${t("setup_axis_remove")} ${index + 1}`}
              onClick={() => onChange(axes.filter((_, i) => i !== index))}
            >
              {t("setup_axis_remove")}
            </Button>
          )}
        </div>
      ))}
      {duplicateNames(axes) && (
        <p role="alert" className="text-[12.5px] text-flag">
          {t("setup_axis_duplicate")}
        </p>
      )}
      {axes.length < AXES_MAX && (
        <Button variant="outline" size="sm" disabled={disabled} onClick={() => onChange([...axes, draftOf()])}>
          {t("setup_axis_add")}
        </Button>
      )}
    </fieldset>
  );
}

/**
 * Who decides the class report's value axes, as the backend is set now (an admin can switch it): "teacher" or "ai" only,
 * or "both" (the teacher chooses when starting an activity). Undefined until the server has answered; read again after
 * a minute or when the page comes back into view.
 */
export function useReportAxes(): "teacher" | "ai" | "both" | undefined {
  return useQuery({ queryKey: ["config"], queryFn: () => api.config(), staleTime: 60_000 }).data?.reportAxes;
}
