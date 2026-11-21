// What a use case returns for input that fails its schema: the names of
// the top-level fields at fault, so an edge can point at them.

import type { z } from "zod";

export type InvalidInput = {
  ok: false;
  error: "invalid_input";
  fields: string[];
};

export function invalidInput(error: z.ZodError): InvalidInput {
  const fields = new Set(error.issues.map((issue) => String(issue.path[0])));
  return { ok: false, error: "invalid_input", fields: [...fields] };
}
