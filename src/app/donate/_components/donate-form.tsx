"use client";

import { OctagonAlert } from "lucide-react";
import {
  type FormEvent,
  type ReactNode,
  startTransition,
  useActionState,
  useState,
} from "react";

// From their own files, not the kit's index: /donate keeps a small JS
// budget (#55), and its heading stays the LCP element.
import { FormAlert } from "@/components/form/form-alert";
import { SubmitButton } from "@/components/form/submit-button";
import { TextField } from "@/components/form/text-field";
import { SiteLink } from "@/components/site/site-link";

import { startDonationAction } from "../_lib/actions";
import { PRESET_RUPEES, type DonateField } from "../_lib/donate-input";
import { START_VIEW, type DonateFormView } from "../_lib/form-state";

export type DonateFormLabels = {
  amount: {
    legend: string;
    presets: Record<string, string>;
    other: string;
    otherLabel: string;
    otherHint: string;
  };
  donorType: {
    legend: string;
    individual: string;
    corporate: string;
    csr: string;
  };
  name: { label: string; hint: string };
  contactName: { label: string; hint: string };
  email: { label: string; hint: string };
  organisation: { label: string; hint: string };
  disclose: { legend: string; hint: string; yes: string; no: string };
  wall: { label: string; hint: string; nameLabel: string; nameHint: string };
  declarations: { legend: string; adult: string; indian: string };
  submit: string;
  submitting: string;
  privacy: string;
  privacyLink: string;
  privacyHref: string;
  minor: { title: string; back: string; backHref: string };
  /** common.callout.danger: meaning never by colour alone. */
  problem: string;
};

const CHOICE =
  "flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl border-2 border-border-strong bg-surface px-4 py-2 has-checked:border-link";

const LINK =
  "font-semibold text-link underline decoration-2 underline-offset-4 hover:text-link-hover";

function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="flex items-start gap-2 font-semibold text-danger">
      <OctagonAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/** A fieldset's error id, when it has one, for aria-describedby. */
const describedBy = (
  errors: DonateFormView["errors"],
  field: DonateField,
  ...more: string[]
) =>
  [...more, errors[field] ? `donate-${field}-error` : undefined]
    .filter(Boolean)
    .join(" ") || undefined;

/**
 * The donate form island on the prerendered /donate page (#106). It asks
 * how much and who is giving, sends the form to startDonationAction, and
 * on success the action moves the donor to the donation's checkout page.
 * Every message comes translated from the action; static words come in
 * `labels`. Sent from the submit event, not a form `action`: React
 * prerenders a client action as a javascript: URL, which the CSP blocks.
 */
export function DonateForm({ labels }: { labels: DonateFormLabels }) {
  const [view, formAction, sending] = useActionState(
    startDonationAction,
    START_VIEW
  );
  return (
    <DonateFormRound
      key={view.attempt}
      view={view}
      sending={sending}
      labels={labels}
      onSend={(formData) => startTransition(() => formAction(formData))}
    />
  );
}

function DonateFormRound({
  view,
  sending,
  labels,
  onSend,
}: {
  view: DonateFormView;
  sending: boolean;
  labels: DonateFormLabels;
  onSend: (formData: FormData) => void;
}) {
  const { entered, errors } = view;
  const [amount, setAmount] = useState(entered.amount);
  const [donorType, setDonorType] = useState(entered.donorType);
  const [onWall, setOnWall] = useState(entered.showOnWall);
  const organisation = donorType !== "individual";

  if (view.minor) {
    return (
      <div className="flex flex-col items-start gap-4">
        <FormAlert tone="danger" label={labels.minor.title} className="w-full">
          <p>{view.minor}</p>
        </FormAlert>
        <SiteLink href={labels.minor.backHref} className={LINK}>
          {labels.minor.back}
        </SiteLink>
      </div>
    );
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;
    onSend(new FormData(event.currentTarget));
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-8">
      {view.alert ? (
        <FormAlert tone="danger" label={labels.problem}>
          <p>{view.alert}</p>
        </FormAlert>
      ) : null}

      <fieldset
        aria-describedby={describedBy(errors, "amount")}
        className="flex flex-col gap-3"
      >
        <legend className="mb-2 font-semibold text-ink">
          {labels.amount.legend}
        </legend>
        {errors.amount ? (
          <FieldError id="donate-amount-error">{errors.amount}</FieldError>
        ) : null}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {PRESET_RUPEES.map((rupees) => (
            <label key={rupees} className={CHOICE}>
              <input
                type="radio"
                name="amount"
                value={String(rupees)}
                checked={amount === String(rupees)}
                onChange={() => setAmount(String(rupees))}
                className="size-5 shrink-0 accent-link"
              />
              <span className="font-semibold">
                {labels.amount.presets[String(rupees)]}
              </span>
            </label>
          ))}
        </div>
        <label className={CHOICE}>
          <input
            type="radio"
            name="amount"
            value="other"
            checked={amount === "other"}
            onChange={() => setAmount("other")}
            className="size-5 shrink-0 accent-link"
          />
          <span>{labels.amount.other}</span>
        </label>
        {amount === "other" ? (
          <TextField
            id="donate-other-amount"
            name="otherAmount"
            inputMode="decimal"
            autoComplete="off"
            defaultValue={entered.otherAmount}
            label={labels.amount.otherLabel}
            hint={labels.amount.otherHint}
          />
        ) : null}
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 font-semibold text-ink">
          {labels.donorType.legend}
        </legend>
        <div className="flex flex-col gap-3">
          {(["individual", "corporate", "csr"] as const).map((type) => (
            <label key={type} className={CHOICE}>
              <input
                type="radio"
                name="donorType"
                value={type}
                checked={donorType === type}
                onChange={() => setDonorType(type)}
                className="size-5 shrink-0 accent-link"
              />
              <span>{labels.donorType[type]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {organisation ? (
        <TextField
          id="donate-organisation"
          name="organisationName"
          autoComplete="organization"
          maxLength={120}
          required
          defaultValue={entered.organisationName}
          label={labels.organisation.label}
          hint={labels.organisation.hint}
          error={errors.organisationName}
        />
      ) : null}

      <TextField
        id="donate-name"
        name="name"
        autoComplete="name"
        maxLength={100}
        required
        defaultValue={entered.name}
        label={organisation ? labels.contactName.label : labels.name.label}
        hint={organisation ? labels.contactName.hint : labels.name.hint}
        error={errors.name}
      />
      <TextField
        id="donate-email"
        name="email"
        type="email"
        autoComplete="email"
        maxLength={254}
        required
        defaultValue={entered.email}
        label={labels.email.label}
        hint={labels.email.hint}
        error={errors.email}
      />

      {organisation ? (
        <fieldset
          aria-describedby={describedBy(
            errors,
            "disclose",
            "donate-disclose-hint"
          )}
          className="flex flex-col gap-3"
        >
          <legend className="mb-2 font-semibold text-ink">
            {labels.disclose.legend}
          </legend>
          <p id="donate-disclose-hint" className="text-sm text-ink-muted">
            {labels.disclose.hint}
          </p>
          {errors.disclose ? (
            <FieldError id="donate-disclose-error">
              {errors.disclose}
            </FieldError>
          ) : null}
          {(["yes", "no"] as const).map((choice) => (
            <label key={choice} className={CHOICE}>
              <input
                type="radio"
                name="disclose"
                value={choice}
                defaultChecked={entered.disclose === choice}
                className="size-5 shrink-0 accent-link"
              />
              <span>{labels.disclose[choice]}</span>
            </label>
          ))}
        </fieldset>
      ) : null}

      <div className="flex flex-col gap-3">
        <label className={CHOICE}>
          <input
            type="checkbox"
            name="showOnWall"
            checked={onWall}
            onChange={(event) => setOnWall(event.target.checked)}
            aria-describedby="donate-wall-hint"
            className="size-5 shrink-0 accent-link"
          />
          <span>{labels.wall.label}</span>
        </label>
        <p id="donate-wall-hint" className="text-sm text-ink-muted">
          {labels.wall.hint}
        </p>
        {onWall ? (
          <TextField
            id="donate-wall-name"
            name="wallName"
            maxLength={60}
            defaultValue={entered.wallName}
            label={labels.wall.nameLabel}
            hint={labels.wall.nameHint}
            error={errors.wallName}
          />
        ) : null}
      </div>

      <fieldset
        aria-describedby={describedBy(errors, "declarations")}
        className="flex flex-col gap-3"
      >
        <legend className="mb-2 font-semibold text-ink">
          {labels.declarations.legend}
        </legend>
        {errors.declarations ? (
          <FieldError id="donate-declarations-error">
            {errors.declarations}
          </FieldError>
        ) : null}
        <label className={CHOICE}>
          <input
            type="checkbox"
            name="declaredAdult"
            required
            defaultChecked={entered.declaredAdult}
            className="size-5 shrink-0 accent-link"
          />
          <span>{labels.declarations.adult}</span>
        </label>
        <label className={CHOICE}>
          <input
            type="checkbox"
            name="declaredIndianSource"
            required
            defaultChecked={entered.declaredIndianSource}
            className="size-5 shrink-0 accent-link"
          />
          <span>{labels.declarations.indian}</span>
        </label>
      </fieldset>

      <p className="flex flex-wrap gap-x-1 text-sm text-ink-muted">
        <span>{labels.privacy}</span>
        <SiteLink href={labels.privacyHref} className={LINK}>
          {labels.privacyLink}
        </SiteLink>
      </p>

      <div>
        <SubmitButton pending={sending} pendingLabel={labels.submitting}>
          {labels.submit}
        </SubmitButton>
      </div>
    </form>
  );
}
