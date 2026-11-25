// How an auction sale's money is shared, and the ledger lines one captured
// payment posts. FOA keeps everything unless the competition's proceeds
// policy sets a creator share, in basis points (1 bps = 0.01 %). The
// creator's share is rounded down to the paisa and the remainder stays with
// FOA, so the two parts always add back up to the amount paid.
//
// The creator's share is a liability until finance pays it out by hand; it
// is never income.
//
// Pure: money is bigint paise (#55). Loads under plain Node: no imports.

/** 100 %, in basis points. */
export const MAX_CREATOR_SHARE_BPS = 10_000;

const BPS_PER_WHOLE = 10_000n;

export type ProceedsSplit = {
  creatorSharePaise: bigint;
  foaSharePaise: bigint;
};

/** Whether `bps` is a whole number of basis points from 0 to 100 %. */
export function isCreatorShareBps(bps: number): boolean {
  return Number.isInteger(bps) && bps >= 0 && bps <= MAX_CREATOR_SHARE_BPS;
}

/**
 * Splits `amountPaise` by the creator's share: the share is
 * floor(amount × bps / 10,000) and FOA gets the rest.
 */
export function splitProceeds(
  amountPaise: bigint,
  creatorShareBps: number
): ProceedsSplit {
  if (amountPaise <= 0n) {
    throw new RangeError("A sale amount must be more than zero paise");
  }
  if (!isCreatorShareBps(creatorShareBps)) {
    throw new RangeError(
      "A creator share must be a whole number of basis points from 0 to 10,000"
    );
  }
  const creatorSharePaise =
    (amountPaise * BigInt(creatorShareBps)) / BPS_PER_WHOLE;
  return { creatorSharePaise, foaSharePaise: amountPaise - creatorSharePaise };
}

/**
 * The ledger accounts an auction capture posts to. 1100 is the ledger's
 * system account for money the gateway holds (#105); 4300 and 2200 are
 * seeded by the auction payment unit. Finance confirms the codes and names.
 */
export const AUCTION_ACCOUNT_CODES = {
  gatewayClearing: "1100",
  auctionProceeds: "4300",
  creatorSharePayable: "2200",
} as const;

/** One posting line, in the ledger's shape: a positive amount on one side. */
export type PostingLine = {
  accountCode: string;
  side: "debit" | "credit";
  amountMinor: bigint;
};

/**
 * The lines one captured auction payment posts: the whole amount into
 * gateway clearing, credited to FOA's auction proceeds and, when the policy
 * sets one, to the creator-share liability. No line is ever zero.
 */
export function auctionCaptureLines(input: {
  amountPaise: bigint;
  creatorShareBps: number;
}): PostingLine[] {
  const { creatorSharePaise, foaSharePaise } = splitProceeds(
    input.amountPaise,
    input.creatorShareBps
  );
  const lines: PostingLine[] = [
    {
      accountCode: AUCTION_ACCOUNT_CODES.gatewayClearing,
      side: "debit",
      amountMinor: input.amountPaise,
    },
  ];
  if (foaSharePaise > 0n) {
    lines.push({
      accountCode: AUCTION_ACCOUNT_CODES.auctionProceeds,
      side: "credit",
      amountMinor: foaSharePaise,
    });
  }
  if (creatorSharePaise > 0n) {
    lines.push({
      accountCode: AUCTION_ACCOUNT_CODES.creatorSharePayable,
      side: "credit",
      amountMinor: creatorSharePaise,
    });
  }
  return lines;
}

export type CreatorSharePercentResult =
  | { ok: true; bps: number }
  | { ok: false; error: "invalid_percent" | "percent_out_of_range" };

const PERCENT = /^(\d{1,3})(?:\.(\d{1,2}))?$/;

/**
 * Reads what a finance user typed as a percentage ("25", "12.5", "0.01")
 * into basis points. Up to two decimals, from 0 to 100.
 */
export function parseCreatorSharePercent(
  input: string
): CreatorSharePercentResult {
  const match = PERCENT.exec(input.trim());
  if (!match) return { ok: false, error: "invalid_percent" };
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  const bps = whole * 100 + fraction;
  if (bps > MAX_CREATOR_SHARE_BPS) {
    return { ok: false, error: "percent_out_of_range" };
  }
  return { ok: true, bps };
}

/** Basis points as the percentage a form shows: 1250 → "12.5". */
export function creatorSharePercentForInput(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const fraction = bps % 100;
  if (fraction === 0) return String(whole);
  return `${whole}.${String(fraction).padStart(2, "0").replace(/0$/, "")}`;
}
