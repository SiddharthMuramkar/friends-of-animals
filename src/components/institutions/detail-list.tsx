import type { ReactNode } from "react";

/** Label and value pairs, as a description list that wraps on a phone. */
export function DetailList({
  items,
}: {
  items: ReadonlyArray<{ label: ReactNode; value: ReactNode }>;
}) {
  return (
    <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-[minmax(10rem,auto)_1fr]">
      {items.map(({ label, value }, index) => (
        <div key={index} className="contents">
          <dt className="font-semibold text-ink">{label}</dt>
          {/* Addresses and emails are long words: let them break. */}
          <dd className="-mt-3 text-ink wrap-anywhere sm:mt-0">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
