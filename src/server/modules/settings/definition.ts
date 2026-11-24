// What one runtime setting is (#62): a schema its value must pass, the
// default that applies while nothing is stored, and the kind of input the
// settings screen shows for it. Labels and descriptions are visible copy,
// so they live in messages/en-IN, not here.
//
// Loads under plain Node (the seed script): no "server-only", no "@/"
// imports.

import { z } from "zod";

/** What a whole-number setting counts. */
export type SettingUnit =
  | "hours"
  | "texts"
  | "reports"
  | "days"
  | "months"
  | "years";

/** How the settings screen asks for a value. */
export type SettingInput =
  | { kind: "boolean" }
  | {
      kind: "integer";
      min: number;
      max: number;
      unit: SettingUnit;
    }
  | { kind: "text"; maxLength: number };

export type SettingDefinition<T> = {
  /** Every stored and submitted value must pass it. */
  schema: z.ZodType<T>;
  /** Applies while no value is stored. Passes `schema`. */
  default: T;
  input: SettingInput;
};

/** An on/off switch. */
export function booleanSetting(options: {
  default: boolean;
}): SettingDefinition<boolean> {
  return {
    schema: z.boolean(),
    default: options.default,
    input: { kind: "boolean" },
  };
}

/** A whole number from `min` to `max`, both included. */
export function integerSetting(options: {
  default: number;
  min: number;
  max: number;
  unit: SettingUnit;
}): SettingDefinition<number> {
  const { min, max, unit } = options;
  return {
    schema: z.int().min(min).max(max),
    default: options.default,
    input: { kind: "integer", min, max, unit },
  };
}

/**
 * One line of text, up to `maxLength` characters once trimmed. An empty
 * value means "not set yet" (e.g. an organisation fact FOA hasn't
 * confirmed), so the default is usually "".
 */
export function textSetting(options: {
  default: string;
  maxLength: number;
}): SettingDefinition<string> {
  const { maxLength } = options;
  return {
    schema: z.string().trim().max(maxLength),
    default: options.default,
    input: { kind: "text", maxLength },
  };
}
