import "server-only";

import { getTranslations } from "next-intl/server";

import type { Messages } from "@/i18n/messages";

import type { Message } from "./form-view";

export type AdminCompetitionsT = Awaited<
  ReturnType<typeof getTranslations<"adminCompetitions">>
>;

/** A message from ./form-view.ts in words, its label placeholders first. */
export function translate(t: AdminCompetitionsT, message: Message): string {
  // The keys come from form-view.ts, whose tests pin them; the messages
  // test checks every key exists.
  const say = t as unknown as (
    key: string,
    values?: Record<string, string | number>
  ) => string;
  const labels = Object.fromEntries(
    Object.entries(message.labels ?? {}).map(([name, key]) => [name, say(key)])
  );
  return say(message.key, { ...message.values, ...labels });
}

/**
 * A subtree of the namespace's messages as it is, for a Client Component
 * that takes its words as props. next-intl types raw() for leaf keys only.
 */
export function rawCopy<Key extends keyof Messages["adminCompetitions"]>(
  t: AdminCompetitionsT,
  key: Key
): Messages["adminCompetitions"][Key] {
  return (t.raw as (key: string) => Messages["adminCompetitions"][Key])(key);
}
