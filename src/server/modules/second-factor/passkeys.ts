// Passkeys as a second factor (WebAuthn, through @simplewebauthn/server).
//
//   startPasskeyRegistration()                     → creation options
//   finishPasskeyRegistration({ label, response }) → enrolled, verified
//   startPasskeyVerification()                     → request options
//   finishPasskeyVerification({ response })        → session verified
//
// A passkey counts for staff only if it verified its user (a PIN or
// biometrics, `userVerification: "required"`), not just their presence.
// The relying party is the host of APP_URL, so each preview host has its
// own passkeys (HR-11). A challenge is answered once, within 5 minutes,
// by the session that asked for it. Loads under plain Node: relative
// imports only.

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../access/can";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import {
  secondFactor,
  user,
  webauthnChallenge,
  type WebauthnPurpose,
} from "../../db/schema";
import { uuidv7 } from "../../ids";
import { invalidInput, type InvalidInput } from "../../input";
import { accountName } from "./account-name";
import { guardedAttempt, type Locked } from "./attempts";
import {
  lockFactorSession,
  signedInUser,
  stampSession,
  type SignedInUser,
} from "./session-factor";
import { SECOND_FACTOR_SETTINGS } from "./settings";
import {
  authorizeEnrolment,
  dropPendingAuthenticators,
  factorLabel,
  type SecondFactorContext,
} from "./enrolment";

/**
 * EdDSA, ES256 and RS256 (COSE ids): what platform authenticators use.
 * Named, so the library doesn't probe for experimental post-quantum ones.
 */
const ALGORITHMS = [-8, -7, -257];

function relyingParty(baseUrl: string) {
  const url = new URL(baseUrl);
  return { id: url.hostname, origin: url.origin };
}

/** Any object: @simplewebauthn checks the shape and refuses a bad one. */
const credentialResponse = <T>() =>
  z.custom<T>((value) => typeof value === "object" && value !== null);

const finishRegistrationInput = z.object({
  label: factorLabel,
  response: credentialResponse<RegistrationResponseJSON>(),
});
const finishVerificationInput = z.object({
  response: credentialResponse<AuthenticationResponseJSON>(),
});

/** Keeps `challenge` as the one this session's ceremony must sign. */
async function storeChallenge(
  tx: AppDb,
  ctx: SecondFactorContext,
  actor: SignedInUser,
  purpose: WebauthnPurpose,
  challenge: string
): Promise<void> {
  const expiresAt = new Date(
    ctx.clock.now().getTime() + SECOND_FACTOR_SETTINGS.passkeyChallengeMs
  );
  await tx
    .insert(webauthnChallenge)
    .values({ sessionId: actor.sessionId, purpose, challenge, expiresAt })
    .onConflictDoUpdate({
      target: [webauthnChallenge.sessionId, webauthnChallenge.purpose],
      set: { challenge, expiresAt },
    });
}

/** Takes the session's challenge, so it can't be answered twice. */
async function takeChallenge(
  tx: AppDb,
  ctx: SecondFactorContext,
  actor: SignedInUser,
  purpose: WebauthnPurpose
): Promise<string | null> {
  const [taken] = await tx
    .delete(webauthnChallenge)
    .where(
      and(
        eq(webauthnChallenge.sessionId, actor.sessionId),
        eq(webauthnChallenge.purpose, purpose)
      )
    )
    .returning({
      challenge: webauthnChallenge.challenge,
      expiresAt: webauthnChallenge.expiresAt,
    });
  return taken && ctx.clock.now().getTime() <= taken.expiresAt.getTime()
    ? taken.challenge
    : null;
}

function passkeysOf(db: AppDb, userId: string) {
  return db
    .select({
      id: secondFactor.id,
      credentialId: secondFactor.credentialId,
      transports: secondFactor.transports,
    })
    .from(secondFactor)
    .where(
      and(eq(secondFactor.userId, userId), eq(secondFactor.kind, "passkey"))
    )
    .orderBy(asc(secondFactor.id));
}

/** Transports as WebAuthn names them. */
type Transport = NonNullable<
  NonNullable<
    PublicKeyCredentialRequestOptionsJSON["allowCredentials"]
  >[number]["transports"]
>[number];

const TRANSPORTS: ReadonlySet<string> = new Set<Transport>([
  "ble",
  "cable",
  "hybrid",
  "internal",
  "nfc",
  "smart-card",
  "usb",
]);

/** The stored transports WebAuthn names; unknown strings are dropped. */
function knownTransports(stored: string[] | null): Transport[] {
  return (stored ?? []).filter((each): each is Transport =>
    TRANSPORTS.has(each)
  );
}

function allowed(
  rows: { credentialId: string | null; transports: string[] | null }[]
) {
  return rows.flatMap((row) =>
    row.credentialId
      ? [
          {
            id: row.credentialId,
            transports: knownTransports(row.transports),
          },
        ]
      : []
  );
}

export type StartPasskeyRegistrationResult = {
  ok: true;
  options: PublicKeyCredentialCreationOptionsJSON;
};

/** Options for the browser to create a passkey for the signed-in user. */
export async function startPasskeyRegistration(
  ctx: SecondFactorContext
): Promise<StartPasskeyRegistrationResult> {
  await authorize(ctx, "second-factor.enrol");
  const actor = signedInUser(ctx.actor);

  return ctx.db.transaction(async (tx) => {
    await authorizeEnrolment(tx, ctx, actor);
    const [account] = await tx
      .select({
        email: user.email,
        phoneCiphertext: user.phoneCiphertext,
        name: user.name,
      })
      .from(user)
      .where(eq(user.id, actor.userId));
    if (!account) throw new Error("The signed-in user has no account row");
    const rp = relyingParty(ctx.auth.baseUrl);
    const options = await generateRegistrationOptions({
      rpName: SECOND_FACTOR_SETTINGS.issuer,
      rpID: rp.id,
      userName: accountName(ctx, account),
      userDisplayName: account.name,
      userID: Buffer.from(actor.userId.replaceAll("-", ""), "hex"),
      attestationType: "none",
      excludeCredentials: allowed(await passkeysOf(tx, actor.userId)),
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "required",
      },
      supportedAlgorithmIDs: ALGORITHMS,
    });
    await storeChallenge(tx, ctx, actor, "register", options.challenge);
    return { ok: true, options } as const;
  });
}

export type FinishPasskeyRegistrationResult =
  | { ok: true }
  | InvalidInput
  | {
      ok: false;
      error: "challenge_expired" | "not_verified" | "already_registered";
    };

/**
 * Checks the browser's new passkey against the challenge and keeps it as
 * a factor. This session has then passed its second factor. If the user
 * holds another factor by now, this needs step-up, however adding started.
 */
export async function finishPasskeyRegistration(
  ctx: SecondFactorContext,
  input: { label: string; response: RegistrationResponseJSON }
): Promise<FinishPasskeyRegistrationResult> {
  await authorize(ctx, "second-factor.enrol");
  const actor = signedInUser(ctx.actor);
  const parsed = finishRegistrationInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const rp = relyingParty(ctx.auth.baseUrl);

  return ctx.db.transaction(async (tx) => {
    await authorizeEnrolment(tx, ctx, actor);
    const now = ctx.clock.now();
    const challenge = await takeChallenge(tx, ctx, actor, "register");
    if (!challenge) return { ok: false, error: "challenge_expired" } as const;

    let info;
    try {
      const verified = await verifyRegistrationResponse({
        response: parsed.data.response,
        expectedChallenge: challenge,
        expectedOrigin: rp.origin,
        expectedRPID: rp.id,
        requireUserVerification: true,
        supportedAlgorithmIDs: ALGORITHMS,
      });
      info = verified.verified ? verified.registrationInfo : undefined;
    } catch {
      info = undefined;
    }
    if (!info) return { ok: false, error: "not_verified" } as const;

    const factorId = uuidv7(now);
    const [inserted] = await tx
      .insert(secondFactor)
      .values({
        id: factorId,
        userId: actor.userId,
        kind: "passkey",
        label: parsed.data.label,
        confirmedAt: now,
        credentialId: info.credential.id,
        publicKey: Buffer.from(info.credential.publicKey).toString("base64url"),
        signCount: info.credential.counter,
        transports: info.credential.transports ?? [],
        createdAt: now,
      })
      .onConflictDoNothing({ target: secondFactor.credentialId })
      .returning({ id: secondFactor.id });
    if (!inserted) {
      return { ok: false, error: "already_registered" } as const;
    }
    await dropPendingAuthenticators(tx, actor.userId);
    await stampSession(tx, actor.sessionId, now, "passkey");
    await recordAudit(tx, ctx, {
      action: "second_factor.enrolled",
      entity: { type: "user", id: actor.userId },
      before: null,
      after: { factorId, kind: "passkey", label: parsed.data.label },
      actorRole: null,
    });
    return { ok: true } as const;
  });
}

export type StartPasskeyVerificationResult =
  | { ok: true; options: PublicKeyCredentialRequestOptionsJSON }
  | { ok: false; error: "not_enrolled" };

/** Options for the browser to sign in with one of the user's passkeys. */
export async function startPasskeyVerification(
  ctx: SecondFactorContext
): Promise<StartPasskeyVerificationResult> {
  await authorize(ctx, "second-factor.verify");
  const actor = signedInUser(ctx.actor);

  return ctx.db.transaction(async (tx) => {
    await lockFactorSession(tx, actor, ctx.clock);
    const passkeys = await passkeysOf(tx, actor.userId);
    if (passkeys.length === 0) {
      return { ok: false, error: "not_enrolled" } as const;
    }
    const options = await generateAuthenticationOptions({
      rpID: relyingParty(ctx.auth.baseUrl).id,
      allowCredentials: allowed(passkeys),
      userVerification: "required",
    });
    await storeChallenge(tx, ctx, actor, "verify", options.challenge);
    return { ok: true, options } as const;
  });
}

export type FinishPasskeyVerificationResult =
  | { ok: true }
  | InvalidInput
  | { ok: false; error: "challenge_expired" | "not_verified" }
  | Locked;

/**
 * Checks the browser's passkey signature and, if good, records that this
 * session passed its second factor now. A bad one counts towards the
 * lockout, as a wrong code does.
 */
export async function finishPasskeyVerification(
  ctx: SecondFactorContext,
  input: { response: AuthenticationResponseJSON }
): Promise<FinishPasskeyVerificationResult> {
  await authorize(ctx, "second-factor.verify");
  const actor = signedInUser(ctx.actor);
  const parsed = finishVerificationInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { response } = parsed.data;
  const rp = relyingParty(ctx.auth.baseUrl);

  return ctx.db.transaction(async (tx) => {
    await lockFactorSession(tx, actor, ctx.clock);
    const challenge = await takeChallenge(tx, ctx, actor, "verify");
    if (!challenge) return { ok: false, error: "challenge_expired" } as const;
    // The factor's row before the lockout row (see guardedAttempt).
    const [factor] = await tx
      .select({
        id: secondFactor.id,
        publicKey: secondFactor.publicKey,
        signCount: secondFactor.signCount,
        transports: secondFactor.transports,
      })
      .from(secondFactor)
      .where(
        and(
          eq(secondFactor.userId, actor.userId),
          eq(secondFactor.kind, "passkey"),
          eq(secondFactor.credentialId, String(response.id))
        )
      )
      .for("update");

    return guardedAttempt<"not_verified">(
      tx,
      { ...ctx, actor },
      "passkey",
      async () => {
        if (!factor?.publicKey) {
          return { ok: false, error: "not_verified" } as const;
        }
        let newCounter: number | undefined;
        try {
          const verified = await verifyAuthenticationResponse({
            response,
            expectedChallenge: challenge,
            expectedOrigin: rp.origin,
            expectedRPID: rp.id,
            credential: {
              id: String(response.id),
              publicKey: new Uint8Array(
                Buffer.from(factor.publicKey, "base64url")
              ),
              counter: factor.signCount ?? 0,
              transports: knownTransports(factor.transports),
            },
            requireUserVerification: true,
          });
          if (verified.verified) {
            newCounter = verified.authenticationInfo.newCounter;
          }
        } catch {
          newCounter = undefined;
        }
        if (newCounter === undefined) {
          return { ok: false, error: "not_verified" } as const;
        }
        await tx
          .update(secondFactor)
          .set({ signCount: newCounter })
          .where(eq(secondFactor.id, factor.id));
        return { ok: true } as const;
      }
    );
  });
}
