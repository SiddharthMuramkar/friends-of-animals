"use client";

import { LocateFixed } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, type MouseEvent } from "react";

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
  "inline-flex min-h-11 items-center gap-2 rounded-full border-2 border-border-strong bg-surface px-5 font-semibold text-ink hover:bg-surface-muted disabled:opacity-70 [&_svg]:size-5";

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
  const router = useRouter();
  if (!ok) return null;

  function locate(event: MouseEvent<HTMLButtonElement>) {
    const form = event.currentTarget.form;
    const fields = form ? new FormData(form) : new FormData();
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
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
        type="button"
        onClick={locate}
        disabled={status === "locating"}
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
