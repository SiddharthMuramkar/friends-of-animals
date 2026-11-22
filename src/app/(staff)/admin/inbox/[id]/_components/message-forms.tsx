"use client";

import { useActionState } from "react";

import { FormAlert, inputStyles, SubmitButton } from "@/components/form";
import { cn } from "@/lib/utils";

import {
  addNoteAction,
  assignAction,
  changeStatusAction,
} from "../../_lib/actions";
import { IDLE, type InboxFormState } from "../../_lib/form-state";

// The staff forms on one contact message: its status, its assignee and a
// new note. Each sends to its Server Action, so it works before the page
// hydrates, and shows what the use case said. Every word comes in props.

/** common.callout words: meaning never by colour alone. */
export type CalloutLabels = { problem: string; done: string };

type Option = { value: string; label: string };

const LABEL = "font-semibold text-ink";

function Outcome({
  state,
  labels,
}: {
  state: InboxFormState;
  labels: CalloutLabels;
}) {
  if (state.message === null) return null;
  return state.status === "refused" ? (
    <FormAlert tone="danger" label={labels.problem}>
      <p>{state.message}</p>
    </FormAlert>
  ) : (
    <FormAlert tone="success" label={labels.done}>
      <p>{state.message}</p>
    </FormAlert>
  );
}

/**
 * The buttons a message's status allows: a new one can start or close, one
 * in progress can close, and a closed one can reopen. Closing asks why.
 */
export function StatusForm({
  messageId,
  status,
  closeReasons,
  labels,
}: {
  messageId: string;
  status: "new" | "in_progress" | "closed";
  closeReasons: readonly Option[];
  labels: CalloutLabels & {
    start: string;
    reopen: string;
    reason: string;
    chooseReason: string;
    close: string;
    saving: string;
  };
}) {
  const [state, formAction] = useActionState(changeStatusAction, IDLE);
  return (
    <form action={formAction} noValidate className="flex flex-col gap-5">
      <input type="hidden" name="messageId" value={messageId} />
      <Outcome state={state} labels={labels} />
      {status === "closed" ? (
        <div>
          <SubmitButton
            name="status"
            value="in_progress"
            variant="secondary"
            pendingLabel={labels.saving}
          >
            {labels.reopen}
          </SubmitButton>
        </div>
      ) : (
        <>
          {status === "new" ? (
            <div>
              <SubmitButton
                name="status"
                value="in_progress"
                variant="secondary"
                pendingLabel={labels.saving}
              >
                {labels.start}
              </SubmitButton>
            </div>
          ) : null}
          <div className="flex flex-col gap-2">
            <label htmlFor="close-reason" className={LABEL}>
              {labels.reason}
            </label>
            <select
              id="close-reason"
              name="closeReason"
              defaultValue=""
              className={inputStyles}
            >
              <option value="">{labels.chooseReason}</option>
              {closeReasons.map((reason) => (
                <option key={reason.value} value={reason.value}>
                  {reason.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <SubmitButton
              name="status"
              value="closed"
              pendingLabel={labels.saving}
            >
              {labels.close}
            </SubmitButton>
          </div>
        </>
      )}
    </form>
  );
}

/** Who handles the message: staff who handle its team, or nobody. */
export function AssignForm({
  messageId,
  assigneeId,
  staff,
  labels,
}: {
  messageId: string;
  assigneeId: string | null;
  staff: readonly Option[];
  labels: CalloutLabels & {
    label: string;
    nobody: string;
    save: string;
    saving: string;
  };
}) {
  const [state, formAction] = useActionState(assignAction, IDLE);
  return (
    <form action={formAction} noValidate className="flex flex-col gap-5">
      <input type="hidden" name="messageId" value={messageId} />
      <Outcome state={state} labels={labels} />
      <div className="flex flex-col gap-2">
        <label htmlFor="assignee" className={LABEL}>
          {labels.label}
        </label>
        <select
          id="assignee"
          name="assigneeId"
          defaultValue={assigneeId ?? ""}
          className={inputStyles}
        >
          <option value="">{labels.nobody}</option>
          {staff.map((person) => (
            <option key={person.value} value={person.value}>
              {person.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <SubmitButton pendingLabel={labels.saving}>{labels.save}</SubmitButton>
      </div>
    </form>
  );
}

/** A new note. Notes are never edited, so the hint says so up front. */
export function NoteForm({
  messageId,
  maxLength,
  labels,
}: {
  messageId: string;
  maxLength: number;
  labels: CalloutLabels & {
    label: string;
    hint: string;
    save: string;
    saving: string;
  };
}) {
  const [state, formAction] = useActionState(addNoteAction, IDLE);
  return (
    <form action={formAction} noValidate className="flex flex-col gap-5">
      <input type="hidden" name="messageId" value={messageId} />
      <Outcome state={state} labels={labels} />
      <div className="flex flex-col gap-2">
        <label htmlFor="note-body" className={LABEL}>
          {labels.label}
        </label>
        <p id="note-hint" className="text-sm text-ink-muted">
          {labels.hint}
        </p>
        <textarea
          id="note-body"
          name="body"
          rows={4}
          required
          maxLength={maxLength}
          aria-describedby="note-hint"
          aria-invalid={state.status === "refused" || undefined}
          defaultValue={state.typed}
          className={cn(inputStyles, "min-h-28")}
        />
      </div>
      <div>
        <SubmitButton pendingLabel={labels.saving}>{labels.save}</SubmitButton>
      </div>
    </form>
  );
}
