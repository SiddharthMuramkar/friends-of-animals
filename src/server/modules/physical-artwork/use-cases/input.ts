// Refusing input that fails its schema, as the identity use cases do: the
// fields at fault, never the values.
//
// Loads under plain Node: relative imports only, no "server-only".

import { z } from "zod";

export type InvalidInput = {
  ok: false;
  error: "invalid_input";
  fields: string[];
};

export function invalidInput(error: z.ZodError): InvalidInput {
  const fields = new Set(error.issues.map((issue) => String(issue.path[0])));
  return { ok: false, error: "invalid_input", fields: [...fields] };
}

/** A list of distinct ids, as many as one form may send. */
export function idList(max: number) {
  return z
    .array(z.uuid())
    .min(1)
    .max(max)
    .refine((ids) => new Set(ids).size === ids.length, "ids_repeated");
}
