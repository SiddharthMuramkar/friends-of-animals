// A receipt prints the amount in words as well as figures, in the Indian
// system (thousand, lakh, crore), e.g. "Rupees Twelve Lakh Thirty-Four
// Thousand Five Hundred Sixty-Seven and Eighty-Nine Paise Only". The receipt
// snapshot stores the result, so later wording changes never touch an
// issued receipt. The exact layout waits on the accountant (HR-47).
// Pure; no imports.

const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
] as const;

const TENS = [
  "",
  "",
  "Twenty",
  "Thirty",
  "Forty",
  "Fifty",
  "Sixty",
  "Seventy",
  "Eighty",
  "Ninety",
] as const;

/** 1 to 99. */
function belowHundred(n: number): string {
  if (n < 20) return ONES[n]!;
  const ones = n % 10;
  return TENS[Math.floor(n / 10)]! + (ones ? `-${ONES[ones]}` : "");
}

/** 1 to 999. */
function belowThousand(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds) parts.push(`${ONES[hundreds]} Hundred`);
  if (rest) parts.push(belowHundred(rest));
  return parts.join(" ");
}

const CRORE = 10_000_000n;
const LAKH = 100_000n;
const THOUSAND = 1_000n;

/** A positive whole number in Indian-system words. */
function indianWords(n: bigint): string {
  const parts: string[] = [];
  const crores = n / CRORE;
  // Above 99 crore, the count of crores is itself read the same way.
  if (crores) parts.push(`${indianWords(crores)} Crore`);
  const lakhs = Number((n % CRORE) / LAKH);
  const thousands = Number((n % LAKH) / THOUSAND);
  const rest = Number(n % THOUSAND);
  if (lakhs) parts.push(`${belowHundred(lakhs)} Lakh`);
  if (thousands) parts.push(`${belowHundred(thousands)} Thousand`);
  if (rest) parts.push(belowThousand(rest));
  return parts.join(" ");
}

/** An INR amount in words, as a receipt prints it. */
export function amountInWords(money: {
  amountMinor: bigint;
  currency: "INR";
}): string {
  if (money.amountMinor < 0n) {
    throw new RangeError("An amount in words can't be negative");
  }
  const rupees = money.amountMinor / 100n;
  const paise = Number(money.amountMinor % 100n);
  if (rupees === 0n && paise === 0) return "Rupees Zero Only";
  const parts: string[] = [];
  if (rupees) parts.push(`Rupees ${indianWords(rupees)}`);
  if (paise) parts.push(`${belowHundred(paise)} Paise`);
  return `${parts.join(" and ")} Only`;
}
