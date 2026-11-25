"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  TextField,
  TextAreaField,
  SelectField,
  FormAlert,
} from "@/components/form";
import { buttonStyles } from "@/components/site/button-link";
import { putHeaders } from "@/app/account/files/_lib/upload";
import { ENTRY_TEXT_LIMITS } from "@/server/modules/entries/domain/entry-text";
import {
  acceptAttribute,
  checkUpload,
} from "@/server/modules/entries/domain/upload-rules";
import type { UploadRule } from "@/server/modules/entries/domain/upload-rules";
import { SHORTLIST_ONLY_DECLARATIONS } from "@/server/modules/school-round/domain/shortlist-only";
import type { RoundStudent } from "@/server/modules/school-round/use-cases/get-school-round";
import {
  startShortlistedEntryAction,
  completeShortlistedEntryAction,
} from "../_lib/actions";

export type ShortlistedLabels = {
  heading: string;
  discipline: string;
  choose: string;
  title: string;
  description: string;
  statement: string;
  position: string;
  noPosition: string;
  declarations: string;
  declarationLabels: Record<
    (typeof SHORTLIST_ONLY_DECLARATIONS)[number],
    string
  >;
  file: string;
  photoHint: string;
  submit: string;
  busy: string;
  problem: string;
  errors: Record<string, string>;
};

type Choice = { value: string; label: string; rule: UploadRule; hint: string };

export function ShortlistedEntryForm({
  student,
  institutionId,
  reference,
  choices,
  positions,
  canEdit,
  labels,
}: {
  student: RoundStudent;
  institutionId: string;
  reference: string;
  choices: Choice[];
  positions: number;
  canEdit: boolean;
  labels: ShortlistedLabels;
}) {
  const id = useId();
  const router = useRouter();
  const [discipline, setDiscipline] = useState<string>(
    student.entry?.discipline ?? (choices.length === 1 ? choices[0]!.value : "")
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notice = useRef<HTMLDivElement>(null);
  const choice = choices.find((each) => each.value === discipline);
  const text = student.entry;
  const fail = (code: string) => {
    setError(code);
    requestAnimationFrame(() => notice.current?.focus());
  };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    const field = (name: string) => {
      const value = data.get(name);
      return typeof value === "string" ? value : "";
    };
    const file = data.get("file");
    if (!choice) {
      fail("discipline_required");
      return;
    }
    if (!(file instanceof File)) {
      fail("empty");
      return;
    }
    const check = checkUpload(
      { name: file.name, type: file.type, size: file.size },
      choice.rule
    );
    if (!check.ok) {
      fail(check.reason);
      return;
    }
    setError(null);
    setBusy(true);
    const target = {
      institutionId,
      reference,
      registrationId: student.registrationId,
      discipline,
    };
    try {
      const grant = await startShortlistedEntryAction({
        ...target,
        file: { name: file.name, type: file.type, size: file.size },
        restartPendingUpload: true,
      });
      if (!grant.ok) {
        fail(
          grant.error === "shortlist_invalid"
            ? (grant.problems[0]?.code ?? grant.error)
            : grant.error
        );
        return;
      }
      // If the PUT response is lost, the completion still checks whether the bytes arrived.
      await fetch(grant.uploadUrl, {
        method: "PUT",
        headers: putHeaders(grant.headers),
        body: file,
      }).catch(() => null);
      const result = await completeShortlistedEntryAction({
        ...target,
        fileId: grant.fileId,
        title: field("title"),
        description: field("description"),
        statement: field("statement"),
        position: canEdit
          ? data.get("position")
            ? Number(field("position"))
            : null
          : (text?.position ?? null),
        declarations: data
          .getAll("declarations")
          .filter((value): value is string => typeof value === "string"),
      });
      if (!result.ok) {
        fail(
          result.error === "shortlist_invalid"
            ? (result.problems[0]?.code ?? result.error)
            : result.error
        );
        return;
      }
      router.refresh();
    } catch {
      fail("unknown");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="mt-4">
      <summary className="cursor-pointer font-semibold text-ink min-h-11">
        {labels.heading}
      </summary>
      <form
        aria-label={labels.heading}
        onSubmit={submit}
        className="mt-3 flex flex-col gap-4"
      >
        {error ? (
          <FormAlert
            ref={notice}
            tabIndex={-1}
            tone="danger"
            label={labels.problem}
          >
            {labels.errors[error] ?? labels.errors.unknown}
          </FormAlert>
        ) : null}
        {text ? (
          <p className="font-semibold text-ink">
            {labels.discipline}: {choice?.label}
          </p>
        ) : (
          <SelectField
            id={`${id}-discipline`}
            name="discipline"
            label={labels.discipline}
            options={choices}
            placeholder={labels.choose}
            required
            value={discipline}
            onChange={(event) => setDiscipline(event.target.value)}
          />
        )}
        <TextField
          id={`${id}-title`}
          name="title"
          label={labels.title}
          defaultValue={text?.title}
          required
          maxLength={ENTRY_TEXT_LIMITS.title}
        />
        <TextAreaField
          id={`${id}-description`}
          name="description"
          label={labels.description}
          defaultValue={text?.description}
          required
          maxLength={ENTRY_TEXT_LIMITS.description}
          rows={3}
        />
        <TextAreaField
          id={`${id}-statement`}
          name="statement"
          label={labels.statement}
          defaultValue={text?.statement ?? ""}
          maxLength={ENTRY_TEXT_LIMITS.statement}
          rows={2}
        />
        {canEdit && positions > 0 ? (
          <SelectField
            id={`${id}-position`}
            name="position"
            label={labels.position}
            options={Array.from({ length: positions }, (_, n) => ({
              value: String(n + 1),
              label: String(n + 1),
            }))}
            defaultValue={text?.position?.toString() ?? ""}
            placeholder={labels.noPosition}
          />
        ) : null}
        <TextField
          id={`${id}-file`}
          name="file"
          type="file"
          required
          label={labels.file}
          accept={choice ? acceptAttribute(choice.rule) : undefined}
          hint={
            choice
              ? `${choice.hint} ${choice.rule.kind === "image" ? labels.photoHint : ""}`
              : labels.photoHint
          }
        />
        <fieldset className="flex flex-col gap-2">
          <legend className="font-semibold text-ink">
            {labels.declarations}
          </legend>
          {SHORTLIST_ONLY_DECLARATIONS.map((key) => (
            <label
              key={key}
              className="flex min-h-11 items-start gap-3 text-ink"
            >
              <input
                type="checkbox"
                name="declarations"
                value={key}
                required
                className="mt-1 size-5 shrink-0 accent-green-700"
              />
              {labels.declarationLabels[key]}
            </label>
          ))}
        </fieldset>
        <div>
          <button
            type="submit"
            className={buttonStyles({ variant: "primary" })}
            disabled={busy}
          >
            {busy ? labels.busy : labels.submit}
          </button>
        </div>
      </form>
    </details>
  );
}
