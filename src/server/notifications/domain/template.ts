// Message templates are plain text with logic-less `{{name}}` placeholders.
// Staff edit the text; code declares which variables each template may use,
// so an edit can never reach data the message was not meant to carry. There
// is no raw HTML: the email HTML part is built from the rendered text with
// everything escaped, so neither staff copy nor variable values become
// markup.
//
// Pure: no database, no clock. Loads under plain Node.

/** Why a template's text cannot be saved. */
export type TemplateProblem =
  /** A placeholder names a variable the template does not declare. */
  | { code: "unknown_variable"; name: string }
  /** `{{` with no `}}` after it; `at` is the index of the `{{`. */
  | { code: "unclosed_placeholder"; at: number }
  /** `{{ … }}` whose inside is not a variable name. */
  | { code: "invalid_placeholder"; text: string };

/** Thrown when a template cannot be rendered with the values given. */
export class TemplateRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateRenderError";
  }
}

/** `recipient.name`, `code`, `competitionTitle`: camelCase, dot-separated. */
const VARIABLE_NAME = /^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)*$/;

type Token =
  | { kind: "text"; text: string }
  | { kind: "variable"; name: string }
  | { kind: "problem"; problem: TemplateProblem };

function tokenise(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const open = source.indexOf("{{", index);
    if (open === -1) {
      tokens.push({ kind: "text", text: source.slice(index) });
      break;
    }
    if (open > index) {
      tokens.push({ kind: "text", text: source.slice(index, open) });
    }
    const close = source.indexOf("}}", open + 2);
    if (close === -1) {
      tokens.push({
        kind: "problem",
        problem: { code: "unclosed_placeholder", at: open },
      });
      break;
    }
    const inside = source.slice(open + 2, close).trim();
    tokens.push(
      VARIABLE_NAME.test(inside)
        ? { kind: "variable", name: inside }
        : {
            kind: "problem",
            problem: { code: "invalid_placeholder", text: inside },
          }
    );
    index = close + 2;
  }
  return tokens;
}

/** The variable names a template uses, each once, in order of first use. */
export function templatePlaceholders(source: string): string[] {
  const names = new Set<string>();
  for (const token of tokenise(source)) {
    if (token.kind === "variable") names.add(token.name);
  }
  return [...names];
}

/**
 * Everything wrong with `source` given the variables it may use. An empty
 * list means it can be saved and will render whenever every declared
 * variable has a value.
 */
export function checkTemplate(
  source: string,
  declared: readonly string[]
): TemplateProblem[] {
  const allowed = new Set(declared);
  const problems: TemplateProblem[] = [];
  const reported = new Set<string>();
  for (const token of tokenise(source)) {
    if (token.kind === "problem") {
      problems.push(token.problem);
    } else if (
      token.kind === "variable" &&
      !allowed.has(token.name) &&
      !reported.has(token.name)
    ) {
      reported.add(token.name);
      problems.push({ code: "unknown_variable", name: token.name });
    }
  }
  return problems;
}

/**
 * Replaces each placeholder with its value, inserted literally (a value
 * that looks like a placeholder stays as text). Throws
 * `TemplateRenderError` if the template is malformed or a used variable has
 * no value, so a half-filled message is never sent.
 */
export function renderTemplate(
  source: string,
  values: Readonly<Record<string, string>>
): string {
  const parts: string[] = [];
  const missing: string[] = [];
  for (const token of tokenise(source)) {
    if (token.kind === "problem") {
      throw new TemplateRenderError(
        `Template is malformed: ${token.problem.code}`
      );
    }
    if (token.kind === "text") {
      parts.push(token.text);
    } else if (Object.hasOwn(values, token.name)) {
      parts.push(values[token.name]!);
    } else {
      missing.push(token.name);
    }
  }
  if (missing.length > 0) {
    throw new TemplateRenderError(
      `No value for ${[...new Set(missing)].join(", ")}`
    );
  }
  return parts.join("");
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]!);
}

/**
 * The HTML part of an email from its rendered text: one `<p>` per
 * paragraph (blank-line separated), `<br>` for single line breaks, and
 * every character escaped.
 */
export function renderEmailHtml(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
    .map(
      (paragraph) =>
        `<p>${paragraph.split("\n").map(escapeHtml).join("<br>\n")}</p>`
    )
    .join("\n");
}
