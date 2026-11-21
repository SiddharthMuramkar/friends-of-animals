"use client";

import { Plus, Trash2 } from "lucide-react";
import {
  useActionState,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";

import {
  FormAlert,
  inputStyles,
  SubmitButton,
  TextField,
} from "@/components/form";
import { buttonStyles } from "@/components/site/button-link";
import type { Messages } from "@/i18n/messages";
import { cn } from "@/lib/utils";
import { KEY_DATE_KINDS } from "@/server/modules/competitions/domain/key-dates";
import {
  DIGITAL_SCOPES,
  DISCIPLINES,
  PARTICIPATIONS,
  PHYSICAL_ARTWORK_KINDS,
  type Discipline,
} from "@/server/modules/competitions/domain/vocabulary";

import type { CompetitionFormView } from "../_lib/form-state";
import type { FieldName } from "../_lib/form-view";

type Labels = Messages["adminCompetitions"]["form"];
type Vocabulary = Messages["adminCompetitions"]["vocabulary"];

/** Fills `{name}` placeholders: these labels hold numbers and names only. */
function fill(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    String(values[name] ?? "")
  );
}

const numberText = (value: number) =>
  Number.isFinite(value) ? String(value) : "";

const CARD =
  "rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";
const CHOICE = "flex min-h-11 items-center gap-3 text-ink";
const BOX = "size-5 shrink-0 accent-primary";

function FieldError({ id, children }: { id: string; children?: string }) {
  if (!children) return null;
  return (
    <p id={id} className="font-semibold text-danger">
      {children}
    </p>
  );
}

function TextArea({
  id,
  name,
  label,
  hint,
  error,
  ...textarea
}: Omit<ComponentProps<"textarea">, "id"> & {
  id: string;
  name: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="font-semibold text-ink">
        {label}
      </label>
      {hint ? (
        <p id={hintId} className="text-sm text-ink-muted">
          {hint}
        </p>
      ) : null}
      <FieldError id={`${id}-error`}>{error}</FieldError>
      <textarea
        {...textarea}
        id={id}
        name={name}
        rows={4}
        aria-describedby={
          [hintId, errorId].filter(Boolean).join(" ") || undefined
        }
        aria-invalid={error ? true : undefined}
        className={cn(inputStyles, "min-h-28")}
      />
    </div>
  );
}

/** A group of radios or checkboxes under one legend. */
function ChoiceGroup({
  id,
  legend,
  hint,
  error,
  children,
}: {
  id: string;
  legend: ReactNode;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  const describedBy =
    [hint ? `${id}-hint` : "", error ? `${id}-error` : ""]
      .filter(Boolean)
      .join(" ") || undefined;
  return (
    <fieldset aria-describedby={describedBy} className="flex flex-col gap-1">
      <legend className="mb-2 font-semibold text-ink">{legend}</legend>
      {hint ? (
        <p id={`${id}-hint`} className="mb-2 text-sm text-ink-muted">
          {hint}
        </p>
      ) : null}
      <FieldError id={`${id}-error`}>{error}</FieldError>
      {children}
    </fieldset>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cn(CARD, "flex flex-col gap-6")}>
      <h2 id={id} className="text-h3">
        {title}
      </h2>
      {children}
    </section>
  );
}

type Row = { key: number; label: string; minAge: string; maxAge: string };

const sameLabel = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

function Fields({
  view,
  labels,
  vocabulary,
}: {
  view: CompetitionFormView;
  labels: Labels;
  vocabulary: Vocabulary;
}) {
  const { values } = view;
  const error = (field: FieldName) => view.errors[field];

  const [disciplines, setDisciplines] = useState<ReadonlySet<Discipline>>(
    () => new Set(values.disciplines)
  );
  const [rows, setRows] = useState<Row[]>(() =>
    values.ageGroups.map((group, key) => ({
      key,
      label: group.label,
      minAge: numberText(group.minAge),
      maxAge: numberText(group.maxAge),
    }))
  );
  const nextKey = useRef(values.ageGroups.length);
  // Categories are on unless unticked, so a new pairing starts on.
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(() => {
    const off = new Set<string>();
    values.disciplines.forEach((discipline) => {
      values.ageGroups.forEach((group, key) => {
        const kept = values.categories.some(
          (c) =>
            c.discipline === discipline && sameLabel(c.ageGroup, group.label)
        );
        if (!kept) off.add(`${discipline}:${key}`);
      });
    });
    return off;
  });

  const toggle = <T,>(set: ReadonlySet<T>, item: T, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(item);
    else next.delete(item);
    return next;
  };
  const updateRow = (key: number, change: Partial<Row>) =>
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...change } : row))
    );
  const chosen = DISCIPLINES.filter((d) => disciplines.has(d));

  return (
    <>
      <Section title={labels.basics}>
        <TextField
          id="code"
          name="code"
          required
          maxLength={12}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          defaultValue={values.code}
          label={labels.code}
          hint={labels.codeHint}
          error={error("code")}
        />
        <TextField
          id="name"
          name="name"
          required
          maxLength={120}
          defaultValue={values.name}
          label={labels.name}
          error={error("name")}
        />
        <TextField
          id="theme"
          name="theme"
          maxLength={300}
          defaultValue={values.theme}
          label={labels.theme}
          error={error("theme")}
        />
        <TextArea
          id="welfareMessage"
          name="welfareMessage"
          maxLength={10_000}
          defaultValue={values.welfareMessage}
          label={labels.welfareMessage}
          hint={labels.welfareMessageHint}
          error={error("welfareMessage")}
        />
      </Section>

      <Section title={labels.whoAndWhat}>
        <ChoiceGroup
          id="participation"
          legend={labels.participation}
          error={error("participation")}
        >
          {PARTICIPATIONS.map((participation) => (
            <label key={participation} className={CHOICE}>
              <input
                type="radio"
                name="participation"
                value={participation}
                defaultChecked={values.participation === participation}
                className={BOX}
              />
              <span>{vocabulary.participation[participation]}</span>
            </label>
          ))}
        </ChoiceGroup>

        <ChoiceGroup
          id="disciplines"
          legend={labels.disciplines}
          error={error("disciplines")}
        >
          {DISCIPLINES.map((discipline) => (
            <label key={discipline} className={CHOICE}>
              <input
                type="checkbox"
                name="disciplines"
                value={discipline}
                checked={disciplines.has(discipline)}
                onChange={(event) =>
                  setDisciplines(
                    toggle(disciplines, discipline, event.target.checked)
                  )
                }
                className={BOX}
              />
              <span>{vocabulary.discipline[discipline]}</span>
            </label>
          ))}
        </ChoiceGroup>

        <ChoiceGroup
          id="ageGroups"
          legend={labels.ageGroups}
          hint={labels.ageGroupsHint}
          error={error("ageGroups")}
        >
          <ol className="flex flex-col gap-4">
            {rows.map((row, index) => {
              const name = fill(labels.ageGroupRow, { row: index + 1 });
              const stem = `ageGroup-${row.key}`;
              return (
                <li key={row.key}>
                  <fieldset className="rounded-2xl border-2 border-border p-4">
                    <legend className="px-1 font-semibold text-ink">
                      {name}
                    </legend>
                    <div className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr]">
                      <TextField
                        id={`${stem}-label`}
                        name="ageGroup.label"
                        maxLength={60}
                        value={row.label}
                        onChange={(event) =>
                          updateRow(row.key, { label: event.target.value })
                        }
                        label={labels.ageGroupLabel}
                      />
                      <TextField
                        id={`${stem}-min`}
                        name="ageGroup.minAge"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={3}
                        value={row.minAge}
                        onChange={(event) =>
                          updateRow(row.key, { minAge: event.target.value })
                        }
                        label={labels.minAge}
                      />
                      <TextField
                        id={`${stem}-max`}
                        name="ageGroup.maxAge"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={3}
                        value={row.maxAge}
                        onChange={(event) =>
                          updateRow(row.key, { maxAge: event.target.value })
                        }
                        label={labels.maxAge}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setRows((current) =>
                          current.filter((r) => r.key !== row.key)
                        )
                      }
                      className={cn(buttonStyles({ variant: "quiet" }), "mt-3")}
                    >
                      <Trash2 aria-hidden="true" />
                      {fill(labels.removeAgeGroup, { row: index + 1 })}
                    </button>
                  </fieldset>
                </li>
              );
            })}
          </ol>
          <div className="mt-3">
            <button
              type="button"
              onClick={() => {
                const key = nextKey.current++;
                setRows((current) => [
                  ...current,
                  { key, label: "", minAge: "", maxAge: "" },
                ]);
              }}
              className={buttonStyles({ variant: "secondary" })}
            >
              <Plus aria-hidden="true" />
              {labels.addAgeGroup}
            </button>
          </div>
        </ChoiceGroup>

        <TextField
          id="ageCutoffDate"
          name="ageCutoffDate"
          type="date"
          defaultValue={values.ageCutoffDate}
          label={labels.ageCutoffDate}
          error={error("ageCutoffDate")}
        />

        <ChoiceGroup
          id="categories"
          legend={labels.categories}
          hint={labels.categoriesHint}
          error={error("categories")}
        >
          {chosen.length === 0 || rows.length === 0 ? (
            <p className="text-ink-muted">{labels.categoriesEmpty}</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {chosen.map((discipline) => (
                <fieldset
                  key={discipline}
                  className="rounded-2xl border-2 border-border p-4"
                >
                  <legend className="px-1 font-semibold text-ink">
                    {vocabulary.discipline[discipline]}
                  </legend>
                  {rows.map((row, index) => {
                    const id = `${discipline}:${row.key}`;
                    return (
                      <label key={row.key} className={CHOICE}>
                        <input
                          type="checkbox"
                          name="categories"
                          value={`${discipline}:${index}`}
                          checked={!unticked.has(id)}
                          onChange={(event) =>
                            setUnticked(
                              toggle(unticked, id, !event.target.checked)
                            )
                          }
                          className={BOX}
                        />
                        <span className="wrap-anywhere">
                          {row.label.trim() ||
                            fill(labels.ageGroupRow, { row: index + 1 })}
                        </span>
                      </label>
                    );
                  })}
                </fieldset>
              ))}
            </div>
          )}
        </ChoiceGroup>
      </Section>

      <Section title={labels.keyDates}>
        <p className="text-ink-muted">{labels.keyDatesHint}</p>
        {KEY_DATE_KINDS.map((kind) => (
          <TextField
            key={kind}
            id={`keyDates-${kind}`}
            name={`keyDates.${kind}`}
            type="datetime-local"
            defaultValue={values.keyDates[kind] ?? ""}
            label={fill(labels.keyDateIst, { kind: vocabulary.keyDate[kind] })}
            hint={
              kind === "school_round_closes"
                ? labels.schoolRoundHint
                : undefined
            }
            error={error(`keyDates.${kind}`)}
          />
        ))}
      </Section>

      <Section title={labels.rulesSection}>
        <TextArea
          id="rules"
          name="rules"
          maxLength={10_000}
          defaultValue={values.rules}
          label={labels.rules}
          error={error("rules")}
        />
        <TextArea
          id="permittedMaterials"
          name="permittedMaterials"
          maxLength={10_000}
          defaultValue={values.permittedMaterials}
          label={labels.permittedMaterials}
          error={error("permittedMaterials")}
        />
        <TextField
          id="duration"
          name="duration"
          maxLength={120}
          defaultValue={values.duration}
          label={labels.duration}
          hint={labels.durationHint}
          error={error("duration")}
        />
      </Section>

      <Section title={labels.judging}>
        <ChoiceGroup
          id="digitalScope"
          legend={labels.digitalScope}
          error={error("digitalScope")}
        >
          {DIGITAL_SCOPES.map((scope) => (
            <label key={scope} className={CHOICE}>
              <input
                type="radio"
                name="digitalScope"
                value={scope}
                defaultChecked={values.digitalScope === scope}
                className={BOX}
              />
              <span>{labels.digitalScopeOptions[scope]}</span>
            </label>
          ))}
        </ChoiceGroup>
        <TextField
          id="shortlistPerCategory"
          name="shortlistPerCategory"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={4}
          defaultValue={numberText(values.shortlistPerCategory)}
          label={labels.shortlistPerCategory}
          error={error("shortlistPerCategory")}
        />
        <TextField
          id="schoolPositions"
          name="schoolPositions"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={3}
          defaultValue={numberText(values.schoolPositions)}
          label={labels.schoolPositions}
          error={error("schoolPositions")}
        />
        <ChoiceGroup
          id="physicalArtwork"
          legend={labels.physicalArtwork}
          error={error("physicalArtwork")}
        >
          {PHYSICAL_ARTWORK_KINDS.map((kind) => (
            <label key={kind} className={CHOICE}>
              <input
                type="radio"
                name="physicalArtwork"
                value={kind}
                defaultChecked={values.physicalArtwork.kind === kind}
                className={BOX}
              />
              <span>{labels.physicalArtworkOptions[kind]}</span>
            </label>
          ))}
          <TextField
            id="physicalArtworkTopN"
            name="physicalArtworkTopN"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            defaultValue={
              values.physicalArtwork.kind === "top_n"
                ? numberText(values.physicalArtwork.count)
                : ""
            }
            label={labels.physicalArtworkTopN}
            className="mt-2"
          />
        </ChoiceGroup>
        <label className={CHOICE}>
          <input
            type="checkbox"
            name="publicDisplay"
            defaultChecked={values.publicDisplay}
            className={BOX}
          />
          <span>{labels.publicDisplay}</span>
        </label>
        <label className={CHOICE}>
          <input
            type="checkbox"
            name="auctionPermitted"
            defaultChecked={values.auctionPermitted}
            className={BOX}
          />
          <span>{labels.auctionPermitted}</span>
        </label>
      </Section>
    </>
  );
}

/**
 * The competition form, for a new draft and for edits. The server action
 * saves it; a refused save comes back with what was typed, an alert and
 * a message on each field to fix. Age groups and categories update as
 * the manager adds rows and ticks disciplines.
 */
export function CompetitionForm({
  action,
  initial,
  labels,
  vocabulary,
  problemLabel,
  submit,
}: {
  action: (
    state: CompetitionFormView,
    formData: FormData
  ) => Promise<CompetitionFormView>;
  initial: CompetitionFormView;
  labels: Labels;
  vocabulary: Vocabulary;
  /** common.callout.danger: meaning never by colour alone. */
  problemLabel: string;
  submit: { label: string; pending: string };
}) {
  const [view, formAction] = useActionState(action, initial);
  return (
    <form action={formAction} noValidate className="flex flex-col gap-8">
      {view.alert ? (
        <FormAlert tone="danger" label={problemLabel}>
          <p>{view.alert}</p>
        </FormAlert>
      ) : null}
      {/* A new key on every refused save re-reads the answers it returns. */}
      <Fields
        key={view.attempt}
        view={view}
        labels={labels}
        vocabulary={vocabulary}
      />
      <div>
        <SubmitButton size="lg" pendingLabel={submit.pending}>
          {submit.label}
        </SubmitButton>
      </div>
    </form>
  );
}
