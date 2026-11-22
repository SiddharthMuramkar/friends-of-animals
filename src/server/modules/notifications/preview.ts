// A template rendered for the editor's preview: each variable it declares
// filled with a sample value. Pure.

import { renderTemplate } from "./domain/template";

export function renderTemplateWith(
  template: { subject: string | null; body: string; variables: string[] },
  sample: (name: string) => string
): { subject: string | null; body: string } {
  const values = Object.fromEntries(
    template.variables.map((name) => [name, sample(name)])
  );
  return {
    subject:
      template.subject === null
        ? null
        : renderTemplate(template.subject, values),
    body: renderTemplate(template.body, values),
  };
}

/** How a variable is written in a template: `{{recipient.name}}`. */
export function placeholderFor(name: string): string {
  return `{{${name}}}`;
}
