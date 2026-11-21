// Removes personal data from error-tracking events before they leave the
// process (#66): no emails, phone numbers, names, request bodies, cookies,
// auth headers or query strings, and the user reduced to a hashed id.
//
// It runs as Sentry's `beforeSend` and `beforeBreadcrumb` in the server,
// the browser and the worker, and again in the tunnel route, so it is pure,
// has no imports, and uses no RegExp lookbehind (client chunks must parse
// on iOS 16.0; scripts/client-bundle.ts).
//
// Names in free text can't be recognised. They are caught by key instead
// (PERSONAL_KEYS), so code that attaches data to an event names its fields.
// Sentry's own server-side scrubbing and "Prevent Storing of IP Addresses"
// stay on as a second line (HR-22).

/** What a removed value becomes. */
export const REDACTED = "[redacted]";

/** What a value nested deeper than MAX_DEPTH becomes. */
export const TRUNCATED = "[truncated]";

const MAX_DEPTH = 8;

/**
 * Keys whose values are personal data or secrets wherever they appear,
 * compared lower-cased with everything but letters and digits removed, so
 * `first_name`, `firstName` and `First-Name` all match `firstname`.
 */
export const PERSONAL_KEYS: ReadonlySet<string> = new Set([
  // Names
  "name",
  "firstname",
  "middlename",
  "lastname",
  "surname",
  "fullname",
  "displayname",
  "username",
  "nickname",
  "guardianname",
  "parentname",
  "childname",
  "studentname",
  "contactname",
  // Contact details
  "email",
  "emailaddress",
  "phone",
  "phonenumber",
  "mobile",
  "mobilenumber",
  "whatsapp",
  "address",
  "addressline1",
  "addressline2",
  "street",
  "pincode",
  "postcode",
  "dob",
  "dateofbirth",
  "birthdate",
  // Identity and payment numbers
  "aadhaar",
  "pan",
  "upi",
  "upiid",
  "vpa",
  "accountnumber",
  "ifsc",
  "cardnumber",
  "cvv",
  // Network identity
  "ip",
  "ipaddress",
  "xforwardedfor",
  "xrealip",
  // Secrets
  "password",
  "passcode",
  "otp",
  "otpcode",
  "verificationcode",
  "token",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "secret",
  "apikey",
  "authorization",
  "cookie",
  "cookies",
  "setcookie",
  "session",
  "sessionid",
  "sessiontoken",
  // Database errors: a query's bound values, Postgres's DETAIL line
  "params",
  "detail",
]);

/** Request headers kept on an event; every other header is dropped. */
const SAFE_REQUEST_HEADERS: ReadonlySet<string> = new Set([
  "accept",
  "content-length",
  "content-type",
  "x-vercel-id",
]);

/**
 * Contexts that describe the platform, not the person, kept as they are.
 * Any other context (including `device`, whose `name` can be a person's)
 * is scrubbed like `extra`.
 */
const PLATFORM_CONTEXTS: ReadonlySet<string> = new Set([
  "app",
  "browser",
  "cloud_resource",
  "culture",
  "os",
  "runtime",
  "trace",
]);

/** A user id as `hashUserId` returns it, left alone on a second pass. */
const HASHED_USER_ID = /^u_[0-9a-f]{16,64}$/;

const EMAIL =
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

/**
 * An Indian mobile number: 10 digits starting 6-9, with an optional +91,
 * 0091, 91 or 0 in front and single spaces or hyphens anywhere. The first
 * group is the character before it, kept, because there is no lookbehind.
 */
const INDIAN_MOBILE =
  /(^|[^\d+])((?:\+|00)?91[ -]?|0)?[6-9]\d{2}(?:[ -]?\d){7}(?!\d)/g;

/** The query string and fragment of an absolute URL. */
const ABSOLUTE_URL_QUERY = /\b(https?:\/\/[^\s?#"'<>]+)[?#][^\s"'<>]*/g;

/** The query string and fragment of a path that starts a word. */
const PATH_QUERY = /(^|[\s"'(=])(\/[^\s?#"'<>]*)[?#][^\s"'<>]*/g;

/**
 * What database errors repeat of the data they were given, each with
 * what it becomes. Drizzle's DrizzleQueryError ends its message with every
 * bound value (`\nparams: a,b,c`); Postgres quotes bad input back
 * (`invalid input syntax for type uuid: "<value>"`) and puts a row's
 * values in its DETAIL line (`Key (email)=(<value>)`, `Failing row
 * contains (<values>)`). Quoted names (`constraint "user_email_key"`)
 * follow no colon, so they stay.
 */
const DATABASE_VALUES: readonly [RegExp, string][] = [
  [/\nparams:[\s\S]*$/, "\nparams: [redacted]"],
  [/Failing row contains [^\n]*/g, "Failing row contains [redacted]"],
  [/(Key \(.*?\)=)\([^\n]*\)/g, "$1[redacted]"],
  [/: "(?:[^"\\\n]|\\.)*"/g, ': "[redacted]"'],
];

/**
 * Hides the values database errors repeat, emails, Indian mobile numbers,
 * and the query strings and fragments of URLs and paths in a piece of text.
 */
export function redactText(text: string): string {
  const withoutValues = DATABASE_VALUES.reduce(
    (redacted, [pattern, replacement]) =>
      redacted.replace(pattern, replacement),
    text
  );
  return withoutValues
    .replace(ABSOLUTE_URL_QUERY, "$1")
    .replace(PATH_QUERY, "$1$2")
    .replace(EMAIL, "[email]")
    .replace(INDIAN_MOBILE, (_match, before: string) => `${before}[phone]`);
}

/** A URL or path without its query string and fragment. */
export function stripQuery(url: string): string {
  return url.split(/[?#]/, 1)[0] ?? "";
}

function isPersonalKey(key: string): boolean {
  return PERSONAL_KEYS.has(key.toLowerCase().replace(/[^a-z0-9]/g, ""));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A copy of `value` with personal keys redacted and every string passed
 * through `redactText`.
 */
function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return TRUNCATED;
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) {
    return value.map((item) => scrubValue(item, depth + 1));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        isPersonalKey(key) ? REDACTED : scrubValue(item, depth + 1),
      ])
    );
  }
  return value;
}

function scrubUrl(url: unknown): unknown {
  return typeof url === "string" ? redactText(stripQuery(url)) : undefined;
}

/** Method, URL without its query and the safe headers; nothing else. */
function scrubRequest(request: unknown): Record<string, unknown> | undefined {
  if (!isRecord(request)) return undefined;
  const scrubbed: Record<string, unknown> = {};
  if (typeof request.method === "string") scrubbed.method = request.method;
  const url = scrubUrl(request.url);
  if (url !== undefined) scrubbed.url = url;
  if (isRecord(request.headers)) {
    const headers = Object.fromEntries(
      Object.entries(request.headers).filter(([name]) =>
        SAFE_REQUEST_HEADERS.has(name.toLowerCase())
      )
    );
    if (Object.keys(headers).length > 0) scrubbed.headers = headers;
  }
  return scrubbed;
}

function scrubUser(
  user: unknown,
  hashUserId: ((id: string) => string) | undefined
): { id: string } | undefined {
  if (!isRecord(user) || hashUserId === undefined) return undefined;
  const { id } = user;
  if (typeof id !== "string" && typeof id !== "number") return undefined;
  const raw = String(id);
  return { id: HASHED_USER_ID.test(raw) ? raw : hashUserId(raw) };
}

/** A stack frame without local variables or URL query strings. */
function scrubFrame(frame: unknown): unknown {
  if (!isRecord(frame)) return frame;
  const { vars: _vars, ...rest } = frame;
  for (const key of ["filename", "abs_path"] as const) {
    if (typeof rest[key] === "string") rest[key] = stripQuery(rest[key]);
  }
  return rest;
}

function scrubStacktrace(stacktrace: unknown): unknown {
  if (!isRecord(stacktrace) || !Array.isArray(stacktrace.frames)) {
    return stacktrace;
  }
  return { ...stacktrace, frames: stacktrace.frames.map(scrubFrame) };
}

/** `{ values: [...] }` as exceptions and threads hold them. */
function scrubValues(
  container: unknown,
  scrubOne: (item: Record<string, unknown>) => Record<string, unknown>
): unknown {
  if (!isRecord(container) || !Array.isArray(container.values)) {
    return container;
  }
  return {
    ...container,
    values: container.values.map((item) =>
      isRecord(item) ? scrubOne(item) : item
    ),
  };
}

function scrubException(exception: Record<string, unknown>) {
  return {
    ...exception,
    ...(typeof exception.value === "string"
      ? { value: redactText(exception.value) }
      : {}),
    ...(exception.stacktrace === undefined
      ? {}
      : { stacktrace: scrubStacktrace(exception.stacktrace) }),
  };
}

function scrubThread(thread: Record<string, unknown>) {
  return thread.stacktrace === undefined
    ? thread
    : { ...thread, stacktrace: scrubStacktrace(thread.stacktrace) };
}

function scrubContexts(contexts: unknown): unknown {
  if (!isRecord(contexts)) return contexts;
  return Object.fromEntries(
    Object.entries(contexts).map(([name, context]) => [
      name,
      PLATFORM_CONTEXTS.has(name) ? context : scrubValue(context),
    ])
  );
}

function scrubSpan(span: unknown): unknown {
  if (!isRecord(span)) return span;
  return {
    ...span,
    ...(typeof span.description === "string"
      ? { description: redactText(span.description) }
      : {}),
    ...(span.data === undefined ? {} : { data: scrubValue(span.data) }),
  };
}

export type ScrubOptions = {
  /**
   * Turns a user id into a pseudonymous one matching `u_<16-64 hex>`. Without
   * it the event carries no user at all (the browser never has one).
   */
  hashUserId?: ((id: string) => string) | undefined;
};

/**
 * A copy of a Sentry event with personal data removed. Fields this doesn't
 * know are kept as they are; the ones that carry request, user or free-form
 * data are rebuilt. Running it twice gives the same event.
 */
export function scrubEvent<E extends object>(
  event: E,
  options: ScrubOptions = {}
): E {
  const {
    user,
    request,
    message,
    transaction,
    logentry,
    exception,
    threads,
    breadcrumbs,
    extra,
    tags,
    contexts,
    spans,
    ...rest
  } = event as Record<string, unknown>;
  const scrubbed: Record<string, unknown> = { ...rest };

  const scrubbedUser = scrubUser(user, options.hashUserId);
  if (scrubbedUser) scrubbed.user = scrubbedUser;
  const scrubbedRequest = scrubRequest(request);
  if (scrubbedRequest) scrubbed.request = scrubbedRequest;

  if (message !== undefined) scrubbed.message = scrubValue(message);
  if (transaction !== undefined) scrubbed.transaction = scrubValue(transaction);
  if (logentry !== undefined) scrubbed.logentry = scrubValue(logentry);
  if (exception !== undefined) {
    scrubbed.exception = scrubValues(exception, scrubException);
  }
  if (threads !== undefined)
    scrubbed.threads = scrubValues(threads, scrubThread);
  if (Array.isArray(breadcrumbs)) {
    scrubbed.breadcrumbs = breadcrumbs.map((crumb) =>
      isRecord(crumb) ? scrubBreadcrumb(crumb) : crumb
    );
  }
  if (extra !== undefined) scrubbed.extra = scrubValue(extra);
  if (tags !== undefined) scrubbed.tags = scrubValue(tags);
  if (contexts !== undefined) scrubbed.contexts = scrubContexts(contexts);
  if (Array.isArray(spans)) scrubbed.spans = spans.map(scrubSpan);

  return scrubbed as E;
}

/**
 * Where outgoing-request breadcrumbs keep a URL's query and fragment apart
 * from `url` (Sentry 11 writes `url.*`, older SDKs `http.*`).
 */
const URL_PART_KEYS = [
  "url.query",
  "url.fragment",
  "http.query",
  "http.fragment",
] as const;

/**
 * A copy of a breadcrumb with its message redacted, its data scrubbed and
 * the query strings of navigation and request URLs dropped.
 */
export function scrubBreadcrumb<B extends object>(crumb: B): B {
  const { message, data, ...rest } = crumb as Record<string, unknown>;
  const scrubbed: Record<string, unknown> = { ...rest };
  if (message !== undefined) scrubbed.message = scrubValue(message);
  if (isRecord(data)) {
    const scrubbedData = scrubValue(data) as Record<string, unknown>;
    for (const key of ["url", "from", "to"] as const) {
      if (typeof scrubbedData[key] === "string") {
        scrubbedData[key] = stripQuery(scrubbedData[key]);
      }
    }
    for (const key of URL_PART_KEYS) delete scrubbedData[key];
    scrubbed.data = scrubbedData;
  } else if (data !== undefined) {
    scrubbed.data = scrubValue(data);
  }
  return scrubbed as B;
}
