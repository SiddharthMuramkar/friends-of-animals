## 15. Open Questions, Defaults & Deviations

Each section ends with its own detailed open-questions list. This section collects the ones that need a **decision from FOA leadership, counsel or the accountant**. Every item already has a default applied in the spec, so building isn't blocked; changing a default means changing config or the cited section.

### 15.1 Decisions for FOA (product)

| # | Question | Default applied | Where |
|---|---|---|---|
| P1 | Should every student submit digitally, or only the school's top N? (the source says this is "still debating") | Configurable per competition (`DigitalSubmissionScope`); default `ALL` | §6.16 |
| P2 | How many entries a school shortlists per category | 5 per category per school; 3 school positions | §6.16, §7.17 |
| P3 | Award scheme: A/B grade vs gold/silver/bronze vs All-India 1/2/3 | Configurable per round; default RANKED 1/2/3 in the final round | §7.17 |
| P4 | Which judging levels are active for the pilot (City/State/National/Global) | School round, then a single NATIONAL final round judged on the physical artwork | §7.17 |
| P5 | Registration fee amounts, who pays on the school route, refund policy | Config values (no amounts invented). School route: institution pays in bulk. No refunds after CONFIRMED except cancellation or duplicates | §6.16, §8.3 |
| P6 | Physical artwork after judging: return or retain, and who pays shipping | Retain unless return is requested within 30 days of results; the shipping payer is stated in the packaging instructions | §6.16 |
| P7 | Can minors' artwork be auctioned, and how are proceeds split | Yes, with verified guardian AUCTION_OF_ARTWORK consent and the credit capped at first name + initial. 100% of proceeds to FOA; creators and schools receive an acknowledgement letter | §8.14, §12.15 |
| P8 | Ambassador eligibility, minimum volunteer age, clubs per institution | Thresholds in config: volunteers 14+ with guardian approval; 1 club per institution | §9.16 |
| P9 | Should post-competition invitations ship with the pilot (M5) instead of M6? | M6, with a backfill run so the pilot cohort is still invited | §9.16 |
| P10 | WhatsApp notifications at launch | No; email, SMS and in-app first, WhatsApp adapter post-MVP | §10.10 |

### 15.2 Decisions for Counsel (legal / compliance)

| # | Question | Default applied | Where |
|---|---|---|---|
| L1 | Is guardian OTP plus the parent's self-declared details enough for verifiable parental consent under DPDP Rules, Rule 10? | Yes for MVP; DigiLocker age token behind a feature flag | §12.1, §12.15 |
| L2 | On the school route, can FOA rely on the institution's declaration or on forms the school collects? | A declaration covers participation and judging only. Any **public** use (gallery, social, auction) needs guardian OTP or an accepted signed form | §12.5 |
| L3 | Is the school a joint data fiduciary or acting for FOA? | FOA is the fiduciary; Institution Terms bind schools to act on FOA's instructions | §12.15 |
| L4 | Minimum age for a minor's own login | 13; under-13s have guardian-managed profiles only | §12.15 |
| L5 | Retention periods (unsuccessful entries, consents, audit logs, financial records) | The §12.11 table: config values, every number marked "confirm" | §12.11 |
| L6 | Background checks for judges and volunteers who interact with minors | Self-declaration plus code of conduct for remote blind judging; police verification for in-person work | §12.9 |
| L7 | Copyright and ownership of minors' artwork in the gallery and at auction | Copyright stays with the creator. Physical ownership passes to FOA on dispatch only for auction-consented works | §8.14, §12.15 |

> **Compliance timeline:** India's DPDP Act 2023 and DPDP Rules 2025 commence in phases. Per the research in §12.1, the core duties (notice, consent, children's data under s.9, data-principal rights, breach reporting) apply from **13 May 2027**. The spec builds for them from day one, so the pilot doesn't need re-engineering later. Verify the dates with counsel.

### 15.3 Decisions for Finance / Accountant

| # | Question | Default applied | Where |
|---|---|---|---|
| F1 | Does FOA hold 80G / 12A (tax-deductible receipts)? | `org.has80G = false`; the receipt template and PAN capture are ready behind config | §8.14 |
| F2 | FCRA registration (foreign donations) | `org.fcraEnabled = false`; INR/domestic only; foreign payments auto-refunded | §8.14 |
| F3 | GST on registration fees and auction sales | No GST invoices; accountant to confirm | §8.14 |
| F4 | Who registers FOA with Indian telecom regulators for bulk SMS (DLT sender ID and templates), and when | FOA, before M2; SMS stays disabled until approved, with email and in-app as the fallback | §10.10 |
| F5 | How much is shown on `/transparency` | Aggregates by category per published month. Disclosed organisations shown with FY totals; individuals by name only, if they opted in; budgets hidden | §8.14 |

### 15.4 Deliberate Deviations From the Source Document

| # | Source says | Spec does | Why |
|---|---|---|---|
| D1 | Login with "FOA Participant ID + Competition Registration Number" | Participant ID (or email/phone) as identifier **plus a one-time password** to the participant's or guardian's verified contact; the registration number is never a credential | The registration number is printed on certificates and shared with schools, so it can't act as a secret |
| D2 | "Age category" collected as a field | Computed from date of birth against the competition's age cut-off date | Avoids mismatched data |
| D3 | Phase 5 (physical collection) placed before school judging | Merged with Phases 8 and 14 into one physical-artwork track that starts **after** a shortlisted entry is verified (the source's own "MOVE THIS HERE" note) | Avoids couriering work that will be eliminated |
| D4 | Phases jump from 11 to 14 | Phases 12–14 are treated as the physical-artwork track, per the source's closing paragraph ("physical artwork (12–14)") | Numbering gap in the source |
| D5 | Judges evaluate entries | Judges see **anonymized** entries (entry code only) | Fairness, and child data protection |
| D6 | Gallery shows "participant's approved display name, school, city" | Minors default to first name + last initial; school and city only with guardian opt-in per field | DPDP children's-data duties |
