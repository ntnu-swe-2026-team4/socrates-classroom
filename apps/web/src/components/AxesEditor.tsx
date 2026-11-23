import { AXES_MAX, TopicAxesInputSchema, type Axis } from "@socrates/shared";
import { Button, Field, Input } from "@/components/ui";
import { useT } from "@/i18n";

export type AxisDraft = Axis & { key: number };
let nextDraftKey = 0;

export function draftOf(axis: Axis = { name: "", left: "", right: "" }): AxisDraft {
  nextDraftKey += 1;
  return { ...axis, key: nextDraftKey };
}

export function draftsOf(axes: Axis[]): AxisDraft[] {
  return axes.length > 0 ? axes.map((axis) => draftOf(axis)) : [draftOf()];
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

export function axesValid(drafts: AxisDraft[], optional = false): boolean {
  return (optional || drafts.length > 0) && TopicAxesInputSchema.safeParse(axesOf(drafts)).success;
}

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
      <p className="text-[12.5px] leading-relaxed text-ink-soft">{t("setup_axes_hint")}</p>
      {axes.map((axis, index) => (
        <div key={axis.key} className="flex flex-col gap-2 rounded-xl border border-line p-3">
          <Field label={t("setup_axis_name")}>
            <Input
              aria-label={`${t("setup_axis_name")} ${index + 1}`}
              value={axis.name}
              maxLength={40}
              disabled={disabled}
              onChange={(event) => edit(index, "name", event.target.value)}
            />
          </Field>
          <div className="grid gap-2 sm:grid-cols-2">
            {(["left", "right"] as const).map((end) => {
              const label = t(`setup_axis_${end}`);
              return (
                <Field key={end} label={label}>
                  <Input
                    aria-label={`${label} ${index + 1}`}
                    value={axis[end]}
                    maxLength={40}
                    disabled={disabled}
                    onChange={(event) => edit(index, end, event.target.value)}
                  />
                </Field>
              );
            })}
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
