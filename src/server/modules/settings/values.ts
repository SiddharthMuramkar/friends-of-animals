// The rules for setting values (#62), free of the database: which value
// applies, whether a submitted value is allowed, and what a change
// records. The settings use cases and the typed accessor build on these.
//
// Loads under plain Node (the seed script): no "server-only", no "@/"
// imports.

import { isDeepStrictEqual } from "node:util";

import type { z } from "zod";

import {
  SETTING_KEYS,
  SETTINGS,
  type SettingKey,
  type SettingValue,
} from "./catalogue";
import type { SettingDefinition } from "./definition";

/** A setting's value as app code and the settings screen see it. */
export type ResolvedSetting<K extends SettingKey = SettingKey> = {
  key: K;
  /** What applies now: the stored value, or the default. */
  value: SettingValue<K>;
  defaultValue: SettingValue<K>;
  source: "stored" | "default";
  /**
   * A value is stored but no longer passes the schema (the schema changed
   * since), so the default applies instead.
   */
  storedInvalid: boolean;
};

function definitionOf<K extends SettingKey>(
  key: K
): SettingDefinition<SettingValue<K>> {
  return SETTINGS[key] as SettingDefinition<SettingValue<K>>;
}

/**
 * Which value applies for `key`. `stored` is the stored row's value, or
 * undefined when there is no row.
 */
export function resolveSetting<K extends SettingKey>(
  key: K,
  stored: { value: unknown } | undefined
): ResolvedSetting<K> {
  const definition = definitionOf(key);
  const fallback = {
    key,
    value: definition.default,
    defaultValue: definition.default,
    source: "default",
    storedInvalid: false,
  } as const;
  if (stored === undefined) return fallback;
  const parsed = definition.schema.safeParse(stored.value);
  if (!parsed.success) return { ...fallback, storedInvalid: true };
  return { ...fallback, value: parsed.data, source: "stored" };
}

/**
 * Every setting in catalogue order, from the stored rows. Rows for keys no
 * longer in the catalogue are ignored.
 */
export function resolveAllSettings(
  rows: readonly { key: string; value: unknown }[]
): ResolvedSetting[] {
  const stored = new Map(rows.map((row) => [row.key, row] as const));
  return SETTING_KEYS.map((key) => resolveSetting(key, stored.get(key)));
}

/** Why a submitted value was refused, for the screen to explain. */
export type SettingValueProblem =
  | { reason: "wrong_type" }
  | { reason: "too_small"; min: number }
  | { reason: "too_big"; max: number };

export type ParsedSettingValue<K extends SettingKey> =
  | { ok: true; value: SettingValue<K> }
  | { ok: false; error: "invalid_value"; problem: SettingValueProblem };

/** Checks a submitted value for `key` against the setting's schema. */
export function parseSettingValue<K extends SettingKey>(
  key: K,
  raw: unknown
): ParsedSettingValue<K> {
  const parsed = definitionOf(key).schema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  return {
    ok: false,
    error: "invalid_value",
    problem: problemOf(parsed.error.issues),
  };
}

/**
 * Why the schema refused a value. A value can break more than one bound
 * the same way: past 2^53, `z.int()` fails its own safe-integer bound as
 * well as the setting's, and reports it first. The tightest bound is the
 * one to report, since meeting it meets the others; for a setting, that is
 * the setting's own.
 */
function problemOf(issues: readonly z.core.$ZodIssue[]): SettingValueProblem {
  const maxima = issues.flatMap((issue) =>
    issue.code === "too_big" ? [Number(issue.maximum)] : []
  );
  if (maxima.length > 0) {
    return { reason: "too_big", max: Math.min(...maxima) };
  }
  const minima = issues.flatMap((issue) =>
    issue.code === "too_small" ? [Number(issue.minimum)] : []
  );
  if (minima.length > 0) {
    return { reason: "too_small", min: Math.max(...minima) };
  }
  return { reason: "wrong_type" };
}

/** What a change records in the audit log: no personal data, just values. */
export type SettingChangeAudit<K extends SettingKey> = {
  before: { value: SettingValue<K>; source: "stored" | "default" };
  after: { value: SettingValue<K> };
};

export type SettingChangeDecision<K extends SettingKey> =
  | {
      ok: true;
      changed: true;
      value: SettingValue<K>;
      audit: SettingChangeAudit<K>;
    }
  /** The value already applies, from a valid row: store and audit nothing. */
  | { ok: true; changed: false }
  | { ok: false; error: "invalid_value"; problem: SettingValueProblem };

/**
 * Whether submitting `raw` for a setting whose value is now `current`
 * changes it, and if so what to store and what the audit row records. A
 * stored value that no longer passes the schema is always replaced, even
 * by the default that applies in its place.
 */
export function decideSettingChange<K extends SettingKey>(
  current: ResolvedSetting<K>,
  raw: unknown
): SettingChangeDecision<K> {
  const parsed = parseSettingValue(current.key, raw);
  if (!parsed.ok) return parsed;
  if (
    !current.storedInvalid &&
    isDeepStrictEqual(parsed.value, current.value)
  ) {
    return { ok: true, changed: false };
  }
  return {
    ok: true,
    changed: true,
    value: parsed.value,
    audit: {
      before: { value: current.value, source: current.source },
      after: { value: parsed.value },
    },
  };
}
