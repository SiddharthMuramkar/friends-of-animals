"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { FormAlert, SubmitButton } from "@/components/form";
import { buttonStyles } from "@/components/site/button-link";

import {
  IDLE,
  type CheckoutReturn,
  type CheckoutView,
  type PayView,
  type TestCheckoutResult,
} from "./pay-view";

export type CheckoutLabels = {
  /** The button, e.g. "Pay ₹3,000" or "Confirm 3 students". */
  submit: string;
  submitting: string;
  /** While the payment is checked after Checkout closes. */
  confirming: string;
  checkoutName: string;
  checkoutUnavailable: string;
  paymentFailed: string;
  /** common.callout words: meaning never by colour alone. */
  problem: string;
  success: string;
  testCheckout: {
    title: string;
    body: string;
    amount: string;
    pay: string;
    paying: string;
    decline: string;
    declining: string;
  };
};

/** The few Razorpay Checkout options and events this island uses. */
type RazorpayOptions = {
  key: string;
  order_id: string;
  amount: number;
  currency: "INR";
  name: string;
  description: string;
  handler: (response: {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  }) => void;
  modal: { ondismiss: () => void };
};
type RazorpayInstance = {
  open(): void;
  on(event: "payment.failed", handler: () => void): void;
};
type RazorpayWindow = Window & {
  Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
};

const CHECKOUT_SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";

/**
 * Loads Razorpay's checkout.js once. The script carries this request's
 * nonce, and 'strict-dynamic' trusts it because this nonce'd island
 * inserts it.
 */
function loadCheckout(nonce: string | null): Promise<void> {
  const ready = () => (window as RazorpayWindow).Razorpay !== undefined;
  if (ready()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = CHECKOUT_SCRIPT;
    script.async = true;
    if (nonce) script.nonce = nonce;
    script.onload = () => (ready() ? resolve() : reject(new Error("Razorpay")));
    script.onerror = () => reject(new Error("Razorpay"));
    document.head.append(script);
  });
}

/**
 * A pay page's Checkout island (#77): a school's pay page and an adult's
 * (#78). Its button asks the server for the batch's order (`start`), then
 * opens the gateway's checkout: Razorpay's Checkout, or the fallback's test
 * checkout below the button (`answerTestCheckout`). What Checkout hands
 * back goes to the server (`confirm`), which checks it against the gateway
 * and moves on to the page that shows the payment. The three are the
 * page's server actions, bound to what it pays for. Every message comes
 * translated, from the server or in `labels`.
 */
export function Checkout({
  start,
  confirm: confirmAction,
  answerTestCheckout,
  nonce,
  labels,
}: {
  /** Opens (or reuses) the order, or confirms a free place at once. */
  start: () => Promise<PayView>;
  /** Checks what Checkout handed back; comes back only with a problem. */
  confirm: (batchId: string, paid: CheckoutReturn) => Promise<PayView>;
  /** The fallback's test checkout: pays or declines the batch's order. */
  answerTestCheckout: (
    batchId: string,
    outcome: "pay" | "decline"
  ) => Promise<TestCheckoutResult>;
  /** This request's CSP nonce, for checkout.js. */
  nonce: string | null;
  labels: CheckoutLabels;
}) {
  const [view, setView] = useState<PayView>(IDLE);
  const [confirming, startConfirming] = useTransition();

  function confirm(batchId: string, paid: CheckoutReturn) {
    startConfirming(async () => {
      // Comes back only with a problem: success redirects.
      setView(await confirmAction(batchId, paid));
    });
  }

  async function openRazorpay(batchId: string, checkout: CheckoutView) {
    try {
      await loadCheckout(nonce);
    } catch {
      setView({ kind: "error", message: labels.checkoutUnavailable });
      return;
    }
    const Razorpay = (window as RazorpayWindow).Razorpay!;
    const rzp = new Razorpay({
      key: checkout.publicKey!,
      order_id: checkout.orderId,
      amount: Number(checkout.amountMinor),
      currency: "INR",
      name: labels.checkoutName,
      description: checkout.description,
      handler: (response) =>
        confirm(batchId, {
          paymentId: response.razorpay_payment_id,
          signature: response.razorpay_signature,
        }),
      modal: { ondismiss: () => setView(IDLE) },
    });
    rzp.on("payment.failed", () =>
      setView({ kind: "error", message: labels.paymentFailed })
    );
    rzp.open();
  }

  async function pay() {
    const next = await start();
    if (next.kind !== "checkout") {
      setView(next);
      return;
    }
    const { batchId, checkout } = next;
    if (checkout.gateway === "fallback") {
      setView(next);
    } else if (checkout.publicKey && checkout.gateway.startsWith("razorpay")) {
      setView(IDLE);
      await openRazorpay(batchId, checkout);
    } else {
      setView({ kind: "error", message: labels.checkoutUnavailable });
    }
  }

  const testing =
    view.kind === "checkout" && view.checkout.gateway === "fallback"
      ? view
      : null;

  return (
    <div className="flex flex-col gap-5">
      {view.kind === "error" ? (
        <FormAlert tone="danger" label={labels.problem}>
          <p>{view.message}</p>
        </FormAlert>
      ) : null}
      {view.kind === "confirmed_free" ? (
        <FormAlert tone="success" label={labels.success}>
          <p>{view.message}</p>
        </FormAlert>
      ) : null}
      {confirming ? (
        <output className="block font-semibold text-ink">
          {labels.confirming}
        </output>
      ) : null}

      {view.kind === "confirmed_free" ? null : (
        <form action={pay}>
          <SubmitButton
            size="lg"
            pendingLabel={labels.submitting}
            pending={confirming || undefined}
          >
            {labels.submit}
          </SubmitButton>
        </form>
      )}

      {testing ? (
        <TestCheckout
          key={testing.checkout.orderId}
          answer={(outcome) => answerTestCheckout(testing.batchId, outcome)}
          checkout={testing.checkout}
          labels={labels.testCheckout}
          disabled={confirming}
          onPaid={(paid) => confirm(testing.batchId, paid)}
          onRefused={(message) => setView({ kind: "error", message })}
        />
      ) : null}
    </div>
  );
}

/**
 * The fallback gateway's test checkout, in place of Razorpay's: the tester
 * pays the order or declines it. It hands back what Razorpay's Checkout
 * would, so the rest of the flow is the same.
 */
function TestCheckout({
  answer: answerAction,
  checkout,
  labels,
  disabled,
  onPaid,
  onRefused,
}: {
  answer: (outcome: "pay" | "decline") => Promise<TestCheckoutResult>;
  checkout: CheckoutView;
  labels: CheckoutLabels["testCheckout"];
  disabled: boolean;
  onPaid: (paid: CheckoutReturn) => void;
  onRefused: (message: string) => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [busy, setBusy] = useState<"pay" | "decline" | null>(null);

  // Like Razorpay's window, it takes focus when it opens.
  useEffect(() => heading.current?.focus(), []);

  async function answer(outcome: "pay" | "decline") {
    setBusy(outcome);
    const result = await answerAction(outcome);
    setBusy(null);
    if (result.ok) {
      onPaid({ paymentId: result.paymentId, signature: result.signature });
    } else {
      onRefused(result.message);
    }
  }

  const locked = disabled || busy !== null;
  return (
    <section
      aria-labelledby="test-checkout"
      className="rounded-3xl border-2 border-dashed border-border-strong bg-surface p-5 shadow-warm sm:p-6"
    >
      <h2 id="test-checkout" ref={heading} tabIndex={-1} className="text-h3">
        {labels.title}
      </h2>
      <p className="mt-2 text-ink-muted">{labels.body}</p>
      <p className="mt-3 text-ink">{checkout.description}</p>
      <dl className="mt-3 flex flex-wrap gap-x-2 text-ink">
        <dt>{labels.amount}</dt>
        <dd className="font-display font-semibold">{checkout.amountText}</dd>
      </dl>
      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          disabled={locked}
          aria-busy={busy === "pay" || undefined}
          onClick={() => void answer("pay")}
          className={buttonStyles({ variant: "primary" })}
        >
          {busy === "pay" ? labels.paying : labels.pay}
        </button>
        <button
          type="button"
          disabled={locked}
          aria-busy={busy === "decline" || undefined}
          onClick={() => void answer("decline")}
          className={buttonStyles({ variant: "secondary" })}
        >
          {busy === "decline" ? labels.declining : labels.decline}
        </button>
      </div>
    </section>
  );
}
