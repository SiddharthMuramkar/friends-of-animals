// The SES adapter for the email port: production's sender once FOA's SES
// account is set up (HR-12). It sends each message with SESv2's
// SendEmail (https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html)
// in FOA's region, ap-south-1, as plain text with an optional HTML part,
// from SES_FROM, through SES_CONFIGURATION_SET when one is set.
//
// `transport` is injected (SESv2Client's requestHandler), so tests run
// the real SDK against a fake SES and never touch the network.
//
// Loads under plain Node (the worker): no "server-only", no Next imports.

import {
  SendEmailCommand,
  SESv2Client,
  SESv2ServiceException,
  type SESv2ClientConfig,
} from "@aws-sdk/client-sesv2";

import {
  EmailNotSentError,
  normaliseEmailAddress,
  subjectHasBreak,
  type EmailSender,
} from "./email";

export type SesConfig = {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** The sender, e.g. "Friends of Animals <no-reply@friendsofanimals.dev>". */
  from: string;
  /** SES's configuration set for these messages (event publishing). */
  configurationSet?: string | undefined;
};

/**
 * How long to wait for SES, retries included, before telling the visitor
 * it failed.
 */
const TIMEOUT_MS = 10_000;

/**
 * SES didn't take the message. The message never holds an address, the
 * text or a key: SES's own reason is kept with every address and long
 * digit run masked, and the SDK's error, which keeps SES's raw reply, is
 * dropped.
 */
export class SesEmailError extends Error {
  constructor(problem: string) {
    super(`SES email failed: ${problem}`);
    this.name = "SesEmailError";
  }
}

const ADDRESS = /[^\s<>()[\]\\,;:"']+@[^\s<>()[\]\\,;:"']+/g;

function masked(reason: string): string {
  return reason
    .replace(ADDRESS, "[address]")
    .replace(/\d{6,}/g, "[number]")
    .slice(0, 300);
}

/** The adapter's own error for whatever the SDK threw. */
function sesFailure(error: unknown, tracked: boolean): Error {
  if (error instanceof SESv2ServiceException) {
    const { httpStatusCode, requestId } = error.$metadata;
    const where = [
      `HTTP ${httpStatusCode ?? "?"}`,
      ...(requestId ? [`request ${requestId}`] : []),
    ].join(", ");
    const failure = new SesEmailError(
      `SES refused the message: ${error.name} (${where}). ${masked(error.message)}`.trim()
    );
    if (tracked && [400, 401, 403, 404, 429].includes(httpStatusCode ?? 0)) {
      return new EmailNotSentError(failure.message);
    }
    return failure;
  }
  // Without `cause`: a network error can carry the request.
  const kind = error instanceof Error ? error.name : typeof error;
  const code = (error as { code?: unknown } | null)?.code;
  const detail =
    typeof code === "string" && /^[A-Z_]{1,32}$/.test(code)
      ? `${kind} ${code}`
      : kind;
  return new SesEmailError(`could not reach SES (${detail})`);
}

/** SESv2Client's request handler: a fake SES in tests. */
export type SesTransport = SESv2ClientConfig["requestHandler"];

export function sesEmailSender(
  config: SesConfig,
  transport?: SesTransport
): EmailSender {
  const clientConfig = {
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    ...(transport ? { requestHandler: transport } : {}),
  } satisfies SESv2ClientConfig;
  const client = new SESv2Client(clientConfig);
  let trackedClient: SESv2Client | undefined;
  return {
    async send(message, options) {
      if (options && !config.configurationSet) {
        throw new EmailNotSentError(
          "Tracked SES email requires a configuration set with event publishing"
        );
      }
      // Refused before SES sees it: SES would take it, and a subject is
      // one header line.
      if (subjectHasBreak(message.subject)) {
        const problem = "the subject has a line break or control character";
        throw options
          ? new EmailNotSentError(problem)
          : new SesEmailError(problem);
      }
      const command = new SendEmailCommand({
        FromEmailAddress: config.from,
        Destination: { ToAddresses: [normaliseEmailAddress(message.to)] },
        Content: {
          Simple: {
            Subject: utf8(message.subject),
            Body: {
              Text: utf8(message.text),
              ...(message.html ? { Html: utf8(message.html) } : {}),
            },
          },
        },
        ...(config.configurationSet
          ? { ConfigurationSetName: config.configurationSet }
          : {}),
        ...(options
          ? {
              EmailTags: [
                { Name: "outbox_delivery_id", Value: options.deliveryId },
              ],
            }
          : {}),
      });
      let messageId: string | undefined;
      try {
        // The worker reconciles an uncertain tracked send. An SDK retry
        // after a lost response could otherwise send the email twice.
        const sender = options
          ? (trackedClient ??= new SESv2Client({
              ...clientConfig,
              maxAttempts: 1,
            }))
          : client;
        ({ MessageId: messageId } = await sender.send(command, {
          abortSignal: AbortSignal.timeout(TIMEOUT_MS),
        }));
      } catch (error) {
        throw sesFailure(error, options !== undefined);
      }
      // Only SES's id, to follow a bounce or a complaint: never the
      // address, the subject or the text, which can hold a code.
      console.info(`SES accepted an email: message ${messageId ?? "?"}`);
    },
  };
}

/**
 * A part of the message in UTF-8. Without a charset SES assumes 7-bit
 * ASCII, and FOA's copy has "…", "₹" and names in Indian scripts.
 */
function utf8(data: string) {
  return { Data: data, Charset: "UTF-8" };
}
