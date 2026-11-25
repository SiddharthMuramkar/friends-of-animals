"use client";
import { useState, type FormEvent } from "react";
import { buttonStyles } from "@/components/site/button-link";
import { proofKeeper } from "@/app/contact/_lib/proof-keeper";
import { issueChallengeAction } from "@/app/contact/_lib/actions";
import { solveProofOfWork } from "@/lib/proof-of-work";
import { sendGalleryReport } from "./actions";
type Labels = {
  reason: string;
  website: string;
  details: string;
  contact: string;
  send: string;
  sending: string;
  invalid: string;
  reasons: { value: string; label: string }[];
};
export const reportInputStyles =
  "min-h-12 w-full min-w-0 rounded-xl border-2 border-border-strong bg-background p-3 text-ink";
export function ReportFields({
  labels,
  warm,
}: {
  labels: Labels;
  warm?: () => void;
}) {
  return (
    <>
      <label htmlFor="reason">{labels.reason}</label>
      <select
        name="reason"
        id="reason"
        onFocus={warm}
        required
        className={reportInputStyles}
      >
        {labels.reasons.map((r) => (
          <option value={r.value} key={r.value}>
            {r.label}
          </option>
        ))}
      </select>
      <label htmlFor="details">{labels.details}</label>
      <textarea
        name="details"
        id="details"
        onFocus={warm}
        maxLength={1000}
        rows={5}
        className={reportInputStyles}
      />
      <label htmlFor="contact">{labels.contact}</label>
      <input
        type="email"
        autoComplete="email"
        name="contact"
        id="contact"
        onFocus={warm}
        className={reportInputStyles}
        maxLength={254}
      />
      <div hidden aria-hidden="true">
        <label htmlFor="website">{labels.website}</label>
        <input name="website" id="website" autoComplete="off" tabIndex={-1} />
      </div>
    </>
  );
}
export function ReportForm({
  itemId,
  labels,
}: {
  itemId: string;
  labels: Labels;
}) {
  const [keeper] = useState(() =>
    proofKeeper({
      fetchChallenge: issueChallengeAction,
      solve: solveProofOfWork,
      now: () => performance.now(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    })
  );
  const [sending, setSending] = useState(false),
    [failed, setFailed] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;
    setSending(true);
    setFailed(false);
    const data = new FormData(event.currentTarget);
    try {
      const proof = await keeper.forSend();
      data.set("humanCheckToken", proof.token);
      data.set("humanCheckNonce", String(proof.nonce));
      await sendGalleryReport(itemId, data);
    } catch {
      setFailed(true);
      setSending(false);
    }
  }
  return (
    <form onSubmit={submit} className="mt-6 grid max-w-xl gap-3">
      <ReportFields labels={labels} warm={() => void keeper.warm()} />
      {failed ? <p role="alert">{labels.invalid}</p> : null}
      <button disabled={sending} className={buttonStyles()}>
        {sending ? labels.sending : labels.send}
      </button>
    </form>
  );
}
