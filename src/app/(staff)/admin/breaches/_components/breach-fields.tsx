import { getTranslations } from "next-intl/server";

import { SelectField, TextAreaField, TextField } from "@/components/form";
import {
  BREACH_AFFECTED_COUNT_MAX,
  BREACH_IMPACT_MAX,
  BREACH_SEVERITIES,
  BREACH_TITLE_MAX,
} from "@/server/modules/breaches/domain/breach-status";
import type { BreachView } from "@/server/modules/breaches/read";

export function BreachCheckbox({
  name,
  label,
  checked,
  required,
}: {
  name: string;
  label: string;
  checked?: boolean;
  required?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <input
        id={name}
        name={name}
        type="checkbox"
        defaultChecked={checked}
        required={required}
        className="size-5 shrink-0 accent-current"
      />
      <label
        htmlFor={name}
        className="flex min-h-11 items-center font-semibold"
      >
        {label}
      </label>
    </div>
  );
}

export async function BreachFields({ breach }: { breach?: BreachView }) {
  const t = await getTranslations("adminBreaches");
  return (
    <>
      <TextField
        id="breach-title"
        name="title"
        label={t("fields.title")}
        hint={t("fields.titleHint")}
        defaultValue={breach?.title}
        maxLength={BREACH_TITLE_MAX}
        required
      />
      {breach ? null : (
        <TextField
          id="breach-aware-at"
          name="awareAt"
          type="datetime-local"
          label={t("fields.awareAtInput")}
          required
        />
      )}
      <SelectField
        id="breach-severity"
        name="severity"
        label={t("fields.severity")}
        placeholder={t("fields.chooseSeverity")}
        options={BREACH_SEVERITIES.map((value) => ({
          value,
          label: t(`severities.${value}`),
        }))}
        defaultValue={breach?.severity ?? ""}
        required
      />
      <TextField
        id="breach-affected-count"
        name="affectedCount"
        type="number"
        min={0}
        max={BREACH_AFFECTED_COUNT_MAX}
        step={1}
        label={t("fields.count")}
        defaultValue={breach?.affectedCount}
        required
      />
      <div className="flex flex-col">
        <BreachCheckbox
          name="personalDataInvolved"
          label={t("fields.personalData")}
          checked={breach?.personalDataInvolved}
        />
        <BreachCheckbox
          name="minorsAffected"
          label={t("fields.minors")}
          checked={breach?.minorsAffected}
        />
      </div>
      <TextAreaField
        id="breach-impact"
        name="impact"
        label={t("fields.impact")}
        defaultValue={breach?.impact}
        maxLength={BREACH_IMPACT_MAX}
        rows={4}
        required
      />
    </>
  );
}
