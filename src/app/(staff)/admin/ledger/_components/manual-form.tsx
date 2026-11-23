"use client";

import { useActionState, useRef, useState } from "react";

import { SelectField } from "@/components/form/select-field";
import { SubmitButton } from "@/components/form/submit-button";
import { TextAreaField } from "@/components/form/text-area-field";
import { TextField } from "@/components/form/text-field";
import { buttonStyles } from "@/components/site/button-link";
import { MAX_LINES } from "@/server/modules/ledger/domain/posting";

import { createEntryAction } from "../_lib/actions";
import { copy } from "../_lib/copy";
import { initialFormState } from "../_lib/form-state";
import { LedgerFormFeedback } from "./form-feedback";

function emptyLine(id: number, side = "") {
  return { id, accountCode: "", side, amount: "", memo: "" };
}

const sideOptions = [
  { value: "debit", label: copy.debit },
  { value: "credit", label: copy.credit },
];

export function ManualEntryForm({
  today,
  accounts,
}: {
  today: string;
  accounts: { value: string; label: string }[];
}) {
  const t = copy.manual;
  const [state, action, pending] = useActionState(
    createEntryAction,
    initialFormState
  );
  const [date, setDate] = useState(today);
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState([
    emptyLine(0, "debit"),
    emptyLine(1, "credit"),
  ]);
  const nextId = useRef(2);

  function updateLine(
    id: number,
    field: "accountCode" | "side" | "amount" | "memo",
    value: string
  ) {
    setLines((current) =>
      current.map((line) =>
        line.id === id ? { ...line, [field]: value } : line
      )
    );
  }

  function addLine() {
    const id = nextId.current++;
    setLines((current) => [...current, emptyLine(id)]);
  }

  return (
    <form action={action} className="max-w-4xl space-y-5">
      <LedgerFormFeedback state={state} />
      <TextField
        id="ledger-entry-date"
        name="date"
        label={t.date}
        type="date"
        value={date}
        onChange={(event) => setDate(event.target.value)}
        max={today}
        required
      />
      <TextAreaField
        id="ledger-entry-description"
        name="description"
        label={t.description}
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        rows={3}
        maxLength={500}
        required
      />
      {lines.map((line, index) => (
        <fieldset
          key={line.id}
          className="space-y-3 rounded-2xl border border-border bg-surface p-4"
        >
          <legend className="px-2 font-semibold">
            {t.line} {index + 1}
          </legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              id={`ledger-account-${line.id}`}
              name="accountCode"
              label={t.account}
              options={accounts}
              placeholder={t.chooseAccount}
              value={line.accountCode}
              onChange={(event) =>
                updateLine(line.id, "accountCode", event.target.value)
              }
              required
            />
            <SelectField
              id={`ledger-side-${line.id}`}
              name="side"
              label={t.side}
              options={sideOptions}
              placeholder={t.chooseSide}
              value={line.side}
              onChange={(event) =>
                updateLine(line.id, "side", event.target.value)
              }
              required
            />
            <TextField
              id={`ledger-amount-${line.id}`}
              name="amount"
              label={t.amount}
              inputMode="decimal"
              maxLength={32}
              value={line.amount}
              onChange={(event) =>
                updateLine(line.id, "amount", event.target.value)
              }
              required
            />
            <TextField
              id={`ledger-memo-${line.id}`}
              name="memo"
              label={t.memo}
              maxLength={200}
              value={line.memo}
              onChange={(event) =>
                updateLine(line.id, "memo", event.target.value)
              }
            />
          </div>
          {lines.length > 2 ? (
            <button
              type="button"
              className={buttonStyles({ variant: "quiet" })}
              disabled={pending}
              aria-label={`${t.remove} ${index + 1}`}
              onClick={() =>
                setLines((current) =>
                  current.filter(({ id }) => id !== line.id)
                )
              }
            >
              {t.remove}
            </button>
          ) : null}
        </fieldset>
      ))}
      <div className="flex flex-wrap gap-3">
        <SubmitButton pendingLabel={copy.saving}>{t.submit}</SubmitButton>
        <button
          type="button"
          className={buttonStyles({ variant: "secondary" })}
          disabled={pending || lines.length >= MAX_LINES}
          onClick={addLine}
        >
          {t.add}
        </button>
      </div>
    </form>
  );
}
