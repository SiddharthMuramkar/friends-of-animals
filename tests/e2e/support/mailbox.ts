import { expect, type APIRequestContext } from "@playwright/test";

function mailboxToken(): string {
  const token = process.env.CAPTURE_MAILBOX_TOKEN;
  if (!token) {
    throw new Error(
      "Set CAPTURE_MAILBOX_TOKEN to the deployment's token to read sign-in codes."
    );
  }
  return token;
}

/**
 * The newest sign-in code sent to `email` (an email address, or a phone
 * number for a text), from the deployment's capture mailbox
 * (GET /api/capture-mailbox), or undefined if none was sent. The address
 * goes in a header, so it stays out of request logs.
 */
async function latestCode(
  request: APIRequestContext,
  email: string
): Promise<string | undefined> {
  const response = await request.get("/api/capture-mailbox", {
    headers: {
      "x-capture-mailbox-token": mailboxToken(),
      "x-capture-mailbox-to": email,
    },
  });
  expect(response.status(), "capture mailbox status").toBe(200);
  const { messages } = (await response.json()) as {
    messages: { text: string }[];
  };
  return /\b(\d{6})\b/.exec(messages[0]?.text ?? "")?.[1];
}

/**
 * Waits briefly for a code to `email` other than `after` (one already
 * used), and returns it. The code is stored before the form moves on, so it
 * is normally there on the first try.
 */
export async function readCode(
  request: APIRequestContext,
  email: string,
  after?: string
): Promise<string> {
  let code: string | undefined;
  await expect
    .poll(
      async () => {
        code = await latestCode(request, email);
        return code !== undefined && code !== after;
      },
      { message: `a new sign-in code for ${email}`, timeout: 10_000 }
    )
    .toBe(true);
  return code!;
}

function uniqueId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** An address nobody has used: one per test, project and run. */
export function freshEmail(project: string): string {
  return `e2e+${project}-${uniqueId()}@example.test`;
}

/**
 * A fresh address of about 55 characters with no hyphen, so a browser has
 * nowhere to break it: for checking that long addresses wrap.
 */
export function freshLongEmail(project: string): string {
  return `e2e.longaddress.narrowscreen.${project}${uniqueId()}@example.test`;
}

/**
 * An Indian mobile number nobody has used, as "+91 9xxxx xxxxx": one per
 * test, so runs and projects don't share codes or the 5-per-phone limit.
 */
export function freshPhone(): string {
  const digits = `${Date.now() % 1e9}`.padStart(9, "0");
  const random = Math.floor(Math.random() * 1e4)
    .toString()
    .padStart(4, "0");
  const national = `9${(Number(digits) + Number(random)).toString().padStart(9, "0").slice(-9)}`;
  return `+91 ${national.slice(0, 5)} ${national.slice(5)}`;
}
