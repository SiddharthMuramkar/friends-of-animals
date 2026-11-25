"use client";

import { LocateFixed } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent,
} from "react";

import { LOCATION_DECIMALS } from "@/server/modules/directory/domain/geo";

type Labels = {
  useLocation: string;
  locating: string;
  denied: string;
  unavailable: string;
  privacy: string;
};

type Status = "idle" | "locating" | "denied" | "unavailable";

const noop = () => () => {};
const supported = () => "geolocation" in navigator;

const BUTTON =
  "inline-flex min-h-11 items-center gap-2 rounded-full border-2 border-border-strong bg-surface px-5 font-semibold text-ink hover:bg-surface-muted aria-disabled:opacity-70 [&_svg]:size-5";

/** Rounded here, so the precise position never leaves the browser. */
const rounded = (degrees: number) => degrees.toFixed(LOCATION_DECIMALS);

/**
 * "Use my location" on the directory search (#128): asks the browser for
 * the visitor's position, rounds it to about a kilometre, and searches from
 * it with the form's service and distance. Hidden where the browser has no
 * geolocation; the pin code works everywhere.
 */
export function UseMyLocation({
  path,
  labels,
}: {
  path: string;
  labels: Labels;
}) {
  const ok = useSyncExternalStore(noop, supported, () => false);
  const [status, setStatus] = useState<Status>("idle");
  const buttonRef = useRef<HTMLButtonElement>(null);
  const request = useRef(0);
  const router = useRouter();

  useEffect(() => {
    if (!ok) return;
    const form = buttonRef.current?.form;
    const cancel = () => {
      request.current++;
      setStatus("idle");
    };
    // Editing the PIN is a newer choice than a pending location request.
    // Do not clear the previously selected location: the visitor may erase
    // that edit and continue refining the existing search.
    const pinEdited = (event: Event) => {
      if (
        event.target instanceof HTMLInputElement &&
        event.target.name === "pin"
      ) {
        cancel();
      }
    };
    // If a pin was entered, do not send the previous location alongside it.
    const preferPin = (event: FormDataEvent) => {
      const pin = event.formData.get("pin");
      if (typeof pin === "string" && pin.trim()) {
        event.formData.delete("lat");
        event.formData.delete("lng");
      }
    };
    form?.addEventListener("formdata", preferPin);
    form?.addEventListener("submit", cancel);
    form?.addEventListener("input", pinEdited);
    form?.addEventListener("change", pinEdited);
    window.addEventListener("pagehide", cancel);
    return () => {
      form?.removeEventListener("formdata", preferPin);
      form?.removeEventListener("submit", cancel);
      form?.removeEventListener("input", pinEdited);
      form?.removeEventListener("change", pinEdited);
      window.removeEventListener("pagehide", cancel);
      // getCurrentPosition has no abort signal. Ignore any reply after the
      // page was hidden, including when Next keeps the page in an Activity.
      cancel();
    };
  }, [ok]);

  if (!ok) return null;

  function locate(event: MouseEvent<HTMLButtonElement>) {
    if (status === "locating") return;
    const form = event.currentTarget.form;
    const id = ++request.current;
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (id !== request.current) return;
        // Service and distance can change while the permission prompt is
        // open. Use the form's latest values, not the ones at the tap.
        const fields = form ? new FormData(form) : new FormData();
        const query = new URLSearchParams({
          lat: rounded(coords.latitude),
          lng: rounded(coords.longitude),
        });
        for (const name of ["service", "radius"]) {
          const value = fields.get(name);
          if (typeof value === "string" && value !== "") {
            query.set(name, value);
          }
        }
        setStatus("idle");
        router.push(`${path}?${query.toString()}`);
      },
      (error) => {
        if (id !== request.current) return;
        setStatus(
          error.code === error.PERMISSION_DENIED ? "denied" : "unavailable"
        );
      },
      { enableHighAccuracy: false, maximumAge: 600_000, timeout: 15_000 }
    );
  }

  const message =
    status === "locating"
      ? labels.locating
      : status === "denied"
        ? labels.denied
        : status === "unavailable"
          ? labels.unavailable
          : "";

  return (
    <div className="flex flex-col gap-2">
      <button
        ref={buttonRef}
        type="button"
        onClick={locate}
        aria-disabled={status === "locating"}
        aria-describedby="use-my-location-privacy"
        className={BUTTON}
      >
        <LocateFixed aria-hidden="true" />
        {labels.useLocation}
      </button>
      <p id="use-my-location-privacy" className="text-sm text-ink-muted">
        {labels.privacy}
      </p>
      <output className="block font-semibold text-ink empty:hidden">
        {message}
      </output>
    </div>
  );
}
