// The self-hosted human check for public forms (#113): the browser must
// find a nonce whose SHA-256 with the server's salt starts with
// `difficulty` zero bits. That costs a person's phone a moment and a bot
// sending thousands of messages real work, with no third-party script,
// no cookie and nothing added to the Content Security Policy.
//
// Shared by the form island (which solves) and the server (which checks),
// so it uses only WebCrypto, which both have. Pure: no database here.

/** Harder than this takes too long on an older phone. */
export const MAX_DIFFICULTY = 24;

function checkDifficulty(difficulty: number): void {
  if (
    !Number.isInteger(difficulty) ||
    difficulty < 0 ||
    difficulty > MAX_DIFFICULTY
  ) {
    throw new RangeError(
      `Proof-of-work difficulty is a whole number from 0 to ${MAX_DIFFICULTY}, not ${difficulty}`
    );
  }
}

const encoder = new TextEncoder();

async function hash(salt: string, nonce: number): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`${salt}:${nonce}`)
  );
  return new Uint8Array(digest);
}

/** How many zero bits `bytes` starts with, most significant first. */
export function leadingZeroBits(bytes: Uint8Array): number {
  let bits = 0;
  for (const byte of bytes) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    return bits + Math.clz32(byte) - 24;
  }
  return bits;
}

/** Whether `nonce` proves the work for `salt` at `difficulty`. */
export async function verifyProofOfWork(proof: {
  salt: string;
  difficulty: number;
  nonce: number;
}): Promise<boolean> {
  checkDifficulty(proof.difficulty);
  if (!Number.isSafeInteger(proof.nonce) || proof.nonce < 0) return false;
  return (
    leadingZeroBits(await hash(proof.salt, proof.nonce)) >= proof.difficulty
  );
}

/**
 * The first nonce that proves the work for `salt` at `difficulty`. Each
 * try awaits the hash, so the page stays responsive; `signal` stops it.
 */
export async function solveProofOfWork(challenge: {
  salt: string;
  difficulty: number;
  signal?: AbortSignal;
}): Promise<number> {
  checkDifficulty(challenge.difficulty);
  for (let nonce = 0; ; nonce++) {
    challenge.signal?.throwIfAborted();
    if (
      leadingZeroBits(await hash(challenge.salt, nonce)) >= challenge.difficulty
    ) {
      return nonce;
    }
  }
}
