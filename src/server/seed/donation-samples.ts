// Pure synthetic fixture identifiers for Playwright; no server dependencies.
export const syntheticDonationToken = (fill: string) =>
  fill.repeat(43).slice(0, 43);

export const SEED_DONATIONS = {
  captured: {
    donationId: "01938a00-0000-7000-8000-000000106101",
    donorId: "01938a00-0000-7000-8000-000000106111",
    batchId: "01938a00-0000-7000-8000-000000106121",
    name: "Priya Sharma",
    email: "priya.donor@example.test",
    amountMinor: 50_000n,
    checkoutToken: syntheticDonationToken("SeedDonationCaptured_"),
    receiptToken: syntheticDonationToken("SeedReceiptLinkValid_"),
    expiredReceiptToken: syntheticDonationToken("SeedReceiptLinkOld_"),
  },
  csr: {
    donationId: "01938a00-0000-7000-8000-000000106102",
    donorId: "01938a00-0000-7000-8000-000000106112",
    batchId: "01938a00-0000-7000-8000-000000106122",
    name: "Kavita Iyer",
    email: "csr@acme.example.test",
    organisationName: "Acme Foundation",
    amountMinor: 2_500_000n,
    checkoutToken: syntheticDonationToken("SeedDonationCsr_"),
  },
  pending: {
    donationId: "01938a00-0000-7000-8000-000000106103",
    donorId: "01938a00-0000-7000-8000-000000106113",
    batchId: "01938a00-0000-7000-8000-000000106123",
    name: "Rahul Verma",
    email: "rahul.donor@example.test",
    amountMinor: 100_000n,
    checkoutToken: syntheticDonationToken("SeedDonationPending_"),
  },
  foreign: {
    donationId: "01938a00-0000-7000-8000-000000106104",
    donorId: "01938a00-0000-7000-8000-000000106114",
    batchId: "01938a00-0000-7000-8000-000000106124",
    refundId: "01938a00-0000-7000-8000-000000106134",
    name: "Emma Clarke",
    email: "emma.donor@example.test",
    amountMinor: 200_000n,
    checkoutToken: syntheticDonationToken("SeedDonationForeign_"),
  },
} as const;
