"use client";

import { useRef, useState, type FormEvent } from "react";
import { FormAlert, inputStyles, TextField } from "@/components/form";
import { buttonStyles } from "@/components/site/button-link";
import {
  completeDonationProofAction,
  recordOfflineDonationAction,
  requestDonationProofAction,
} from "./actions";

export type OfflineLabels = {
  method: string;
  methods: Record<"cheque" | "bank_transfer" | "cash", string>;
  donorType: string;
  types: Record<"individual" | "corporate" | "csr", string>;
  reference: string;
  referenceHint: string;
  receivedOn: string;
  amount: string;
  name: string;
  email: string;
  organisation: string;
  pan: string;
  panHint: string;
  proof: string;
  proofHint: string;
  declarations: string;
  adult: string;
  indian: string;
  save: string;
  saving: string;
  problem: string;
  errors: Record<string, string>;
};

export function OfflineDonationForm({
  labels,
  today,
  has80G,
}: {
  labels: OfflineLabels;
  today: string;
  has80G: boolean;
}) {
  const [type, setType] = useState("individual");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const proofInput = useRef<HTMLInputElement>(null);
  const uploaded = useRef<{ file: File; id: string } | null>(null);
  const alert = useRef<HTMLDivElement>(null);
  function problem(message: string) {
    setError(message);
    requestAnimationFrame(() => alert.current?.focus());
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    const file = proofInput.current?.files?.item(0);
    data.delete("proof");
    try {
      if (!(file instanceof File) || file.size === 0) {
        problem(labels.errors.proof_invalid!);
        return;
      }
      if (uploaded.current?.file !== file) {
        const upload = await requestDonationProofAction({
          contentType: file.type,
          sizeBytes: file.size,
        });
        if (!upload.ok) {
          if ("next" in upload && upload.next) {
            window.location.assign(upload.next);
            return;
          }
          problem(labels.errors[upload.error] ?? labels.errors.failed!);
          return;
        }
        const put = await fetch(upload.uploadUrl, {
          method: "PUT",
          headers: upload.headers,
          body: file,
        });
        if (!put.ok || !(await completeDonationProofAction(upload.fileId)).ok) {
          problem(labels.errors.upload_failed!);
          return;
        }
        uploaded.current = { file, id: upload.fileId };
      }
      data.set("proofFileId", uploaded.current.id);
      const saved = await recordOfflineDonationAction(data);
      if ("next" in saved && saved.next) {
        window.location.assign(saved.next);
        return;
      }
      if (!saved.ok) {
        const fields = "fields" in saved ? saved.fields : [];
        problem(
          fields
            .map((field) => labels.errors[field])
            .filter(Boolean)
            .join(" ") ||
            labels.errors[saved.error] ||
            labels.errors.failed!
        );
      }
    } catch {
      problem(labels.errors.failed!);
    } finally {
      setBusy(false);
    }
  }
  const choice =
    "flex min-h-12 items-center gap-3 rounded-2xl border-2 border-border-strong p-3 has-checked:border-link";
  return (
    <form
      onSubmit={submit}
      method="post"
      className="max-w-2xl space-y-5 rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-8"
    >
      {error ? (
        <FormAlert
          ref={alert}
          tabIndex={-1}
          tone="danger"
          label={labels.problem}
        >
          <p>{error}</p>
        </FormAlert>
      ) : null}
      <fieldset className="space-y-2">
        <legend className="font-semibold text-ink">{labels.method}</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {Object.entries(labels.methods).map(([value, label]) => (
            <label key={value} className={choice}>
              <input
                type="radio"
                name="method"
                value={value}
                defaultChecked={value === "cheque"}
                required
                className="size-5 accent-link"
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <TextField
        id="offline-reference"
        name="reference"
        label={labels.reference}
        hint={labels.referenceHint}
        maxLength={60}
        autoComplete="off"
        spellCheck={false}
        required
      />
      <TextField
        id="offline-amount"
        name="amount"
        label={labels.amount}
        inputMode="decimal"
        maxLength={20}
        autoComplete="off"
        required
      />
      <TextField
        id="offline-date"
        name="receivedOn"
        label={labels.receivedOn}
        type="date"
        defaultValue={today}
        max={today}
        required
      />
      <fieldset className="space-y-2">
        <legend className="font-semibold text-ink">{labels.donorType}</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {Object.entries(labels.types).map(([value, label]) => (
            <label key={value} className={choice}>
              <input
                type="radio"
                name="donorType"
                value={value}
                checked={type === value}
                onChange={() => setType(value)}
                className="size-5 accent-link"
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      {type !== "individual" ? (
        <TextField
          id="offline-organisation"
          name="organisationName"
          label={labels.organisation}
          autoComplete="off"
          maxLength={120}
          required
        />
      ) : null}
      <TextField
        id="offline-name"
        name="name"
        label={labels.name}
        autoComplete="off"
        maxLength={100}
        required
      />
      <TextField
        id="offline-email"
        name="email"
        label={labels.email}
        autoComplete="off"
        type="email"
        maxLength={254}
        required
      />
      {has80G ? (
        <TextField
          id="offline-pan"
          name="pan"
          label={labels.pan}
          hint={labels.panHint}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          minLength={10}
          maxLength={10}
          required
        />
      ) : null}
      <div className="space-y-2">
        <label htmlFor="offline-proof" className="font-semibold text-ink">
          {labels.proof}
        </label>
        <p id="offline-proof-hint" className="text-sm text-ink-muted">
          {labels.proofHint}
        </p>
        <input
          id="offline-proof"
          ref={proofInput}
          name="proof"
          type="file"
          required
          accept="application/pdf,image/png,image/jpeg,image/webp"
          aria-describedby="offline-proof-hint"
          className={inputStyles}
        />
      </div>
      <fieldset className="space-y-2">
        <legend className="font-semibold text-ink">
          {labels.declarations}
        </legend>
        <label className={choice}>
          <input
            type="checkbox"
            name="declaredAdult"
            required
            className="size-5 shrink-0 accent-link"
          />
          {labels.adult}
        </label>
        <label className={choice}>
          <input
            type="checkbox"
            name="declaredIndianSource"
            required
            className="size-5 shrink-0 accent-link"
          />
          {labels.indian}
        </label>
      </fieldset>
      <button
        type="submit"
        className={buttonStyles({ variant: "primary" })}
        disabled={busy}
      >
        {busy ? labels.saving : labels.save}
      </button>
    </form>
  );
}
