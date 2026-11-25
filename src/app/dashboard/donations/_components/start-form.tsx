"use client";
import { useActionState } from "react";
import { SubmitButton } from "@/components/form";
import { startMonthlyAction } from "../_lib/actions";
type Labels = {
  title: string;
  amount: string;
  amountHelp: string;
  adult: string;
  indian: string;
  wall: string;
  submit: string;
  submitting: string;
};
export function StartForm({ labels }: { labels: Labels }) {
  const [state, action] = useActionState(startMonthlyAction, {});
  return (
    <form
      action={action}
      className="space-y-4 rounded-3xl border-2 border-border bg-surface p-6"
    >
      <h2 className="text-h3">{labels.title}</h2>
      <label className="block font-semibold" htmlFor="monthly-amount">
        {labels.amount}
      </label>
      <p id="monthly-amount-hint" className="text-sm text-ink-muted">
        {labels.amountHelp}
      </p>
      <input
        id="monthly-amount"
        name="amount"
        type="number"
        min={100}
        max={15000}
        step={1}
        defaultValue={1000}
        required
        aria-describedby="monthly-amount-hint"
        className="w-full rounded-xl border-2 border-border-strong bg-surface px-4 py-3 text-ink"
      />
      <label htmlFor="monthly-adult" className="flex items-start gap-3">
        <input
          id="monthly-adult"
          type="checkbox"
          name="adult"
          required
          className="size-5 shrink-0"
        />
        {labels.adult}
      </label>
      <label htmlFor="monthly-indian" className="flex items-start gap-3">
        <input
          id="monthly-indian"
          type="checkbox"
          name="indian"
          required
          className="size-5 shrink-0"
        />
        {labels.indian}
      </label>
      <label htmlFor="monthly-wall" className="flex items-start gap-3">
        <input
          id="monthly-wall"
          type="checkbox"
          name="wall"
          className="size-5 shrink-0"
        />
        {labels.wall}
      </label>
      {state.error && (
        <p role="alert" className="text-ink font-semibold">
          {state.error}
        </p>
      )}
      <SubmitButton pendingLabel={labels.submitting}>
        {labels.submit}
      </SubmitButton>
    </form>
  );
}
