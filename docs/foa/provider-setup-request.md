# Friends of Animals — What we need from leadership to set up payments, SMS and email

- **Prepared on:** 18 November 2026
- **Prepared by:** [name] (developer), [email], [phone]
- **Prepared for:** FOA's trustees or board, FOA's administration team, and FOA's Chartered Accountant (CA)
- **Please reply by:** ________

## 1. Why we are asking, and how to reply

**Why this matters.** The new FOA platform will let people pay competition fees and donate online. It will also send SMS and email to participants, parents and schools: confirmations, reminders, consent requests and results. To do this, FOA must open accounts with outside providers for payments, SMS, email and its web domain. Each provider checks FOA's identity and documents before it lets FOA use its service. Only FOA can supply these facts, documents, signatures and decisions. The developer cannot answer them on FOA's behalf.

**Start with the tax item today.** FOA's income-tax registration and approval (the old "12A" and "80G") can take **up to about nine months** if FOA is already operating and not yet registered. Please pass section 4 to FOA's CA first. Everything else takes days or a couple of weeks.

**Who should act**

- **Trustees or board:** the decisions in each section, the choice of authorised signatory, approval of costs, page texts and SMS wording, and sections 11 and 12.
- **Authorised signatory:** signs up for Razorpay, does Razorpay's video call, and signs the SMS authorisation letter (Appendix A).
- **FOA administration:** the entity facts in section 3 and the documents in section 5.
- **FOA's CA:** section 4 (tax status) and the GST question (Q6.11).
- **AWS account owner (Q9.1):** section 9.
- **Whoever manages FOA's web domain:** section 10.

**How to reply**

1. Fill in the **Reply sheet in section 13**. Every question in sections 3 to 12 has a number (for example Q4.2) that matches a row there. The lines under each question are for your notes; the Reply sheet is what we work from.
2. Collect the documents listed in section 5 and tick them off.
3. Return the Reply sheet together with the documents to the developer. Partial replies are welcome. Please send the tax answers first.
4. **Never** write passwords, API keys (secret codes that let software use an account) or one-time codes (OTPs) in this document, and never send them by WhatsApp or email. Section 11 explains how to share access safely.

- **Send the Reply sheet and documents to:** [email]. Send documents showing PAN or bank details by [agreed secure channel].

**What happens after you reply.** The developer drafts the website policy pages and the SMS wording for your approval, and sets up the technical side of each account as a team member on FOA's accounts. FOA stays the owner of every account.

---

## 2. At a glance

Ordered by how long each item takes, longest first.

| Item | Who at FOA acts | How long | Cost |
|---|---|---|---|
| 1. Tax status (section 4) | CA, with trustees | 0–9 months (see section 4) | Ask CA |
| 2. Razorpay payments (section 7) | Authorised signatory | About 1–2 weeks once documents and pages are ready | 2% + GST per payment; possible ₹199 + tax KYC fee |
| 3. SMS registration, DLT (section 8) | Person named in Appendix A; trustees approve wording | About 1–2 weeks | About ₹5,900 once, then ₹0.16–0.25 per SMS + GST |
| 4. Website policy pages (section 6) | Trustees approve; developer drafts | Days, after your answers | — |
| 5. KYC documents (section 5) | FOA administration | Days | — |
| 6. Email sending, Amazon SES (section 9) | FOA's AWS account owner | 1–4 days | USD 0.10 per 1,000 emails |
| 7. Domain and DNS (section 10) | Cloudflare account holder | Minutes to hours | Not covered by our research |

"—" means our research found no provider fee. Lead times of "1–2 weeks" are the developer's estimates from each provider's step times.

**How the items depend on each other**

- Razorpay (item 2) needs the documents (item 5) and the live policy pages (item 4) first. For a trust, Razorpay may also ask for proof of tax status (item 1).
- Email (item 6) and the live website need DNS access (item 7).
- Item 1 can run in the background, except for a trust: file before Razorpay's KYC, because Razorpay may ask for proof and a pending application needs an undertaking letter.
- SMS (item 3) needs the documents (item 5) and the signed Appendix A letter.

**Not needed now:** foreign donations (FCRA) and WhatsApp messages. Both come after the first launch. See section 12.

---

## 3. About FOA (entity facts)

Providers check these facts against FOA's documents. Please copy them exactly as printed on FOA's documents.

- **Q3.1 Legal form.** "NGO" describes what FOA does, not its legal form. Razorpay has a different document list for each form.

  ☐ Trust  ☐ Registered society  ☐ Section 8 company  ☐ Not sure
- **Q3.2 Exact legal name, as printed on FOA's PAN card.** AWS checks that FOA's account name matches the PAN exactly, including spelling and punctuation.

  Answer: ________
- **Q3.3 Registration number and date** (trust registration, society registration, or company CIN).

  Number: ________  Date: ________
- **Q3.4 FOA's PAN** (Permanent Account Number of the organisation, not of a person).

  Answer: ________
- **Q3.5 GST number,** if FOA has one.

  ☐ None  GSTIN: ________
- **Q3.6 Registered address,** with PIN code.

  Answer: ________
- **Q3.7 Authorised signatory.** The person who signs up for Razorpay, appears on its video call, and signs for FOA. They must have their **original physical PAN card** (Razorpay does not accept a printout or e-PAN).

  Name: ________  Designation: ________  Mobile: ________  Email: ________
- **Q3.8 Bank account that will receive the money.** Razorpay needs the account number and IFSC. The signatory can type the full account number directly into Razorpay; you do not need to write it here.

  Bank: ________  Branch: ________  Account name: ________  IFSC: ________  Last 4 digits: ________
- **Q3.9 People who run or own FOA.** Razorpay asks for a declaration of "ultimate beneficial owners" (UBOs): the people who ultimately own or control the organisation. Please list your trustees, governing-body members or directors below. Your CA can tell you which of them count as UBOs.

| Name | Role (trustee, member, director) | Counts as UBO? |
|---|---|---|
| ________ | ________ | ☐ Yes ☐ No |
| ________ | ________ | ☐ Yes ☐ No |
| ________ | ________ | ☐ Yes ☐ No |
| ________ | ________ | ☐ Yes ☐ No |

---

## 4. Tax status (please give this section to FOA's CA first)

### What changed

India's **Income-tax Act 2025** replaced the 1961 Act on **1 April 2026**. The registrations FOA may know as "12A" and "80G" now have new section and form numbers:

- **Registration** of a non-profit (old 12A/12AB) is now **section 332**: a "registered non-profit organisation".
- **Approval** that lets donors claim a tax deduction (old 80G) is now **section 354**. Only a registered non-profit can get it, or one applying for registration at the same time.
- The application forms changed too. Old Form 10A is now **Form 104** (provisional) and old Form 10AB is now **Form 105** (regular). One form covers registration and approval together; the department issues a separate order for each.
- The orders changed: old Form 10AC is now **Form 106** (provisional order) and old Form 10AD is now **Form 107** (regular order).
- Approvals granted under the old 1961 Act carry over until they expire.

### Why it matters to FOA

- **Razorpay** may ask a trust for proof of 12A/80G or the "10AC" order (now Form 106).
- **Donor receipts:** donors can claim a deduction only if FOA is **both** registered and approved under section 354. Donors then deduct 50% of the gift, capped at 10% of their adjusted income. Cash gifts above ₹2,000 get no deduction.
- **Yearly filing:** if FOA is approved, the old Forms 10BD and 10BE are now **Form 113** (statement of donations, due by **31 May** after each tax year) and **Form 114** (certificate for each donor).
- Until FOA is registered and approved, the platform issues donation receipts without a tax section.

### The four possible paths

| FOA's situation | What FOA files | How long | Valid for |
|---|---|---|---|
| Already holds regular registration and approval | Nothing now | — | Until current approval expires |
| Not registered; activities **not yet started** | Form 104 (provisional) | 1–2 months | Up to 3 tax years |
| Not registered; **already operating** | Form 105 (regular) | **Up to about 9 months** | 5 tax years |
| Holds provisional registration (Form 106); activities have since started | Form 105, within 6 months of starting | Up to about 9 months | 5 tax years (see below) |

- **Form 104:** the order is due within one month from the end of the month of application. It is valid for 3 tax years, or until 6 months after activities start, if earlier.
- **Form 105:** the order is due within six months from the end of the quarter of application.
- **After provisional registration:** the new registration is valid for 10 tax years, not 5, if FOA's income was ₹5 crore or less in each of the two previous years. The approval is valid for 5.

Form 104 is only for organisations whose activities have not started. If an organisation that is already active files Form 104, the department treats the application as never made. FOA's CA should decide whether FOA's activities count as "commenced" and which form to file.

### Questions

- **Q4.1 Current status today.**

  ☐ Registered (old 12A/12AB, now s.332)  ☐ Approved (old 80G, now s.354)  ☐ Applied and waiting  ☐ Neither  ☐ Don't know
- **Q4.2 Registration and approval numbers, with validity dates.** Please also send copies of the certificates or orders (section 5).

  Registration no.: ________  Valid until: ________

  Approval no.: ________  Valid until: ________
- **Q4.3 If FOA is not registered: have FOA's activities already started?** (CA to confirm.)

  ☐ Yes  ☐ No
- **Q4.4 FOA's CA.**

  Name: ________  Firm: ________  Phone: ________  Email: ________
- **Q4.5 If an application is needed:** which form will the CA file, and when?

  ☐ Form 104  ☐ Form 105  Filing date: ________
- **Q4.6 Decision: should donors receive tax-deductible receipts** once FOA is registered and approved?

  ☐ Yes  ☐ No  ☐ Decide later

---

## 5. KYC documents

"KYC" (Know Your Customer) means the identity checks that payment, SMS and cloud providers must run before they serve an organisation. Please collect the documents below. The "Notes" column says which provider needs each one: **Razorpay** (payments), **DLT** (SMS registration) or **AWS** (email). Does each provider accept scanned copies? The developer will confirm. The signatory's PAN must be the original card.

| Document | Have it? | Sent on | Notes |
|---|---|---|---|
| FOA's PAN card (copy) | ☐ Yes ☐ No | ________ | Razorpay, DLT, AWS. See below |
| Trust deed or gazette notification | ☐ Yes ☐ No ☐ N/A | ________ | Trust only. Razorpay: mandatory |
| Trust registration certificate | ☐ Yes ☐ No ☐ N/A | ________ | Trust only, if registered. Razorpay |
| Society registration certificate | ☐ Yes ☐ No ☐ N/A | ________ | Society only. Razorpay |
| Certificate of incorporation, CIN, MOA and AOA | ☐ Yes ☐ No ☐ N/A | ________ | Section 8 company only. Razorpay |
| Signatory's PAN card | ☐ Yes ☐ No | ________ | Razorpay. **Original card**. See below |
| Signatory's address proof | ☐ Yes ☐ No | ________ | Razorpay |
| Power of attorney, or board resolution, naming the signatory | ☐ Yes ☐ No | ________ | Razorpay. See below |
| UBO declaration | ☐ Yes ☐ No | ________ | Razorpay. See Q3.9 |
| Tax registration and approval proof (12A/80G certificates, or Form 106/107 order) | ☐ Yes ☐ No ☐ N/A | ________ | Razorpay may ask a trust |
| Cancelled cheque for the receiving account | ☐ Yes ☐ No | ________ | Razorpay, if needed. See below |
| GST certificate | ☐ Yes ☐ No ☐ N/A | ________ | DLT, if FOA has GST |
| FOA's proof of identity and address | ☐ Yes ☐ No | ________ | DLT |
| Signed authorisation letter on FOA letterhead | ☐ Yes ☐ No | ________ | DLT. Draft in Appendix A |
| Sample invoice or receipt | ☐ Yes ☐ No | ________ | Razorpay. See Q6.10 |

Notes on the table:

- **FOA's PAN card:** AWS needs FOA's account name to match it exactly (Q3.2).
- **Section 8 company papers:** Razorpay fetches these itself if FOA has a CKYC record.
- **Signatory's PAN card:** the signatory shows the original physical card on Razorpay's video call. Razorpay does not accept an e-PAN or a printout.
- **Power of attorney or board resolution:** a Section 8 company may give either. A trust or society gives a power of attorney.
- **Tax proof:** Razorpay may ask a trust. Its list says 80G or 10AC (preferred). Acceptance of Form 106/107 is unconfirmed (Q7.5). A pending application alone needs an undertaking letter signed by the signatory.
- **Cancelled cheque:** Razorpay asks for a video of it only if its bank check fails. Keep one ready.

- **Q5.1 Documents sent.** In the Reply sheet, tick "All" once every document that applies is sent, otherwise "Some".

---

## 6. Website policy pages

Before Razorpay gives FOA its "live" keys (what the website needs to take real payments), it checks that FOA's live website links to these pages:

- About us
- Contact us
- Pricing details
- Terms and conditions
- Privacy policy
- Refunds policy

Razorpay also asks for a **sample invoice**. Without these pages, FOA can only send payment links and invoices from Razorpay's own dashboard; the website cannot take payments.

**The developer will draft the text of every page for your approval once the answers below arrive.** You do not need to write the pages yourselves.

### Questions

- **Q6.1 Where can the pages go live now?** The new platform will not be live when Razorpay's checks start, so the pages must be live somewhere first.

  ☐ On FOA's current website: ________ (address)  ☐ Publish the new site's pages early on FOA's own domain
- **Q6.2 What does FOA charge money for?**

  ☐ Competition registration fees  ☐ One-time donations  ☐ Monthly donations  ☐ Auction sales of artwork (planned for later)  ☐ Other: ________
- **Q6.3 How much?** Fee per competition, and whether it is per student or per school.

  Answer: ________
- **Q6.4 Refunds and cancellations: when does FOA give money back?** For example: a student withdraws; FOA cancels a competition; someone pays twice; a donor gives the wrong amount. The platform supports full and partial refunds.

  Answer: ________
- **Q6.5 How long do refunds take, and who at FOA decides them?**

  Answer: ________
- **Q6.6 Privacy contact (grievance officer).** India's data protection rules (in force from 13 May 2027; the platform follows them from day one) require FOA to publish a contact for questions about personal data, and to name that contact in every reply. The Privacy page will show it.

  Name: ________  Designation: ________  Email: ________  Phone: ________
- **Q6.7 Response times for privacy complaints.** The platform plans to acknowledge a complaint within 48 hours and resolve it within 30 days. The law allows up to 90 days.

  ☐ Approve  ☐ Change to: ________
- **Q6.8 Public contact details for the Contact page.**

  Address: ________  Email: ________  Phone: ________
- **Q6.9 Who at FOA approves the final page text?**

  Name: ________
- **Q6.10 Sample receipt or invoice.** Does FOA already use a receipt or invoice format? If yes, please send a sample. Who signs receipts?

  ☐ Sample attached  ☐ None yet (the developer will draft one)  Signatory name and title: ________
- **Q6.11 GST on fees (for the CA).** The platform assumes FOA issues no GST invoices on registration fees or auction sales, and that the amounts charged are final. The CA must confirm this before launch.

  ☐ Confirmed, no GST  ☐ GST applies: ________

---

## 7. Razorpay (online payments)

Razorpay is the payment company that will collect fees and donations on the website by card, UPI, netbanking and wallets.

### Domestic only

Razorpay states that it does not offer international payments to NGOs. FOA's account will therefore accept Indian payment methods only. People abroad who pay with a foreign-issued card cannot pay, including Indian citizens living abroad. See Q12.1 for foreign donations.

### Steps and timing

1. The authorised signatory (Q3.7) creates the account using the FOA login email from section 11, and adds the developer as a team member.
2. The signatory enters FOA's business details, bank account, website address, policy page links and sample invoice.
3. **Identity check ("Master KYC", in use since 1 January 2026).** Razorpay first looks for an existing central KYC record (CKYC). If there is none, it holds a **video call**. The signatory must show their **original physical PAN card** on camera. Printouts and e-PAN are not accepted.
4. The signatory completes a **DigiLocker** verification within **3 days** of the call.
5. Razorpay reviews the account in **3–4 business days**.

Total: about **1–2 weeks** once documents and pages are ready (the developer's estimate).

### Fees

- **2% per payment, plus 18% GST on that fee,** for domestic cards, UPI, netbanking and wallets. Corporate credit cards cost 2.15%. Example: on a ₹1,000 payment the fee is ₹20 plus ₹3.60 GST.
- No setup fee and no annual maintenance charge.
- Razorpay may charge a **₹199 + tax** KYC processing fee.
- **Welcome offer:** accounts activated on or after 1 July 2026 pay no platform fee on their first ₹5 lakh of domestic payments within **90 days of activation**. Prepaid, corporate, Amex, Diners and EMI payments are excluded, and GST on fees still applies.
- **Monthly donations by card** cost an extra 0.9% on top of the platform fee. Prices for UPI and bank mandates are "on request".
- Razorpay publishes no special NGO price. Custom pricing starts above ₹5 lakh a month.

### Monthly (recurring) donations

Razorpay's "Subscriptions" feature can charge a donor every month by card, **UPI Autopay** (monthly UPI debits the donor approves once) or **e-mandate** (a standing instruction on the donor's bank account). Razorpay's own help pages still mark UPI as "early access" and e-mandate as "limited access". **If Q7.4 is Yes, the signatory should ask Razorpay support to confirm card, UPI Autopay and e-mandate subscriptions are enabled for FOA's account.**

Limits set by RBI and Razorpay:

- Charges up to **₹15,000** go through automatically. Above that, the donor must approve every charge. RuPay cards cannot be charged above ₹15,000, and UPI is not offered above it. The platform therefore caps monthly donations at ₹15,000.
- The first charge always needs the donor's approval, and the bank notifies the donor at least 24 hours before each charge.

### Questions

- **Q7.1 Does FOA already have a Razorpay account?**

  ☐ Yes  ☐ No
- **Q7.2 Who will sign up?**

  ☐ The signatory in Q3.7  ☐ Someone else: ________
- **Q7.3 Decision: do you approve Razorpay's fees as above?**

  ☐ Approved  ☐ Want to discuss
- **Q7.4 Decision: should the website offer monthly donations** (capped at ₹15,000 a month)?

  ☐ Yes  ☐ No  ☐ Later
- **Q7.5 Does FOA have a contact at Razorpay?** If so, please ask them: (a) is NGO or donation pricing below 2% available? (b) will Razorpay accept FOA's Form 106/107 order where its checklist still says "10AC"? Neither answer is published.

  Contact: ________  Answers: ________
- **Q7.6 Decision: when should the account be activated?** The 90-day fee-free offer starts at activation. If FOA activates early but the platform launches later, part of the 90 days may pass before the website takes payments.

  ☐ As soon as possible  ☐ Closer to the platform launch

---

## 8. SMS: DLT registration through MSG91

### What DLT is

Indian telecom rules (set by TRAI, the telecom regulator) require any organisation that sends SMS to register first on a **DLT platform** run by the telecom operators. FOA registers once as the **Principal Entity** (the organisation that sends the messages). It then registers:

- its **header**: the 6-character sender name shown on phones;
- every message **template**: the exact wording of each SMS, with blanks for details such as names and dates.

Operators check every SMS against these registrations and block any that don't match. Since **1 October 2024**, any web link in an SMS must be on FOA's approved list (the "URL whitelist"). Since **1 December 2024**, FOA must also declare which SMS company sends for it.

**MSG91** is the Indian SMS company the platform will use. The DLT registration belongs to FOA, not to MSG91. If FOA changes SMS company later, it keeps its registration, header and templates; only the declared SMS company changes.

Until DLT is approved, the platform sends email and in-app messages instead of SMS. That includes login codes and parent consent requests, which the platform needs early. So please start this soon.

### Steps

1. **Register FOA as Principal Entity** on one DLT portal (Jio TrueConnect, Airtel, Vi or SmartPing). FOA provides: its PAN, GST number if any, proof of identity and address, and an **authorisation letter on FOA letterhead** naming the person doing the registration (draft in Appendix A).
   - **Fee:** SmartPing charges **₹5,000 + GST** (₹5,900). Vendor guides report the same ₹5,900 on Jio and Airtel, and say registering on further portals is free. These two points are not confirmed by the portals themselves.
   - **Approval:** Jio and Airtel approve "in a day or two", according to MSG91.
2. **Header:** register `FOAIND` (or FOA's choice). Approved "in a day or two". Phones will show it as something like "XX-FOAIND-S"; the "-S" suffix marks a service message.
3. **Templates:** register each SMS wording (Appendix B). No approval time is published. Expect some to be rejected the first time and resubmitted. Any later change to the wording needs a fresh approval, so please settle the wording early.
4. **URL whitelist and MSG91 declaration** on the same portal.
5. **MSG91 account:** the DLT registration numbers are linked to MSG91, and SMS sending is switched on.

Total: about **1–2 weeks** from complete documents (the developer's estimate).

### Cost

- **One-time:** about **₹5,900** for the Principal Entity registration.
- **Per SMS at MSG91**, plus 18% GST, depending on how many FOA buys: ₹0.25 each at 5,000; ₹0.20 at 16,500; ₹0.17 from 60,000; ₹0.16 at about 9.6 lakh. Example: 5,000 SMS cost ₹1,250 plus ₹225 GST.

### Questions

- **Q8.1 Who will do the DLT registration, and on which portal?** This person is named in the authorisation letter.

  ☐ FOA's signatory  ☐ The developer, on FOA's behalf  ☐ Someone else: ________

  Portal: ☐ Developer chooses ☐ Other: ________
- **Q8.2 Decision: approve the header `FOAIND`?** It must be exactly 6 characters.

  ☐ Approve  ☐ Use instead: ________ (first choice)  ________ (second choice)
- **Q8.3 Decision: approve the SMS wording in Appendix B?**

  ☐ All approved  ☐ Approved with changes marked on Appendix B
- **Q8.4 Decision: approve the DLT fee and SMS costs above?**

  ☐ Approved  ☐ Want to discuss
- **Q8.5 Signed authorisation letter** (Appendix A) on FOA letterhead.

  ☐ Signed and returned on: ________

---

## 9. Email: Amazon SES (Mumbai)

Amazon SES (Simple Email Service) is Amazon's service for sending email from software. The platform will use it for receipts, confirmations, reminders and, later, newsletters. It is part of **AWS** (Amazon Web Services). The developer has chosen its **Mumbai region**, so sending and the stored email records stay in India. It is also the cheapest of the options the developer compared.

### What FOA needs to do

- **Own the AWS account.** It should be an account in FOA's name with FOA's Indian billing address. Such an account is contracted with AWS India and billed in Indian rupees.
- **Pass the identity check.** Under CERT-In rules (India's cyber-security agency), AWS India must verify the account holder before any service works. An organisation verifies with its **PAN card**, and **the account name must match the PAN exactly** (Q3.2).
- **Pay the monthly bill.** About **USD 0.10 per 1,000 emails** (charged in rupees). For example, 10,000 emails cost about USD 1.

### What the developer does next

- Sets up sending addresses ending @notify.[domain] (receipts, reminders) and @news.[domain] (newsletters). Replies go to support@[domain]. These need DNS records (section 10).
- Asks AWS for "production access". AWS replies within 96 hours.

### Questions

- **Q9.1 Who at FOA will own the AWS account?**

  Name: ________  Designation: ________
- **Q9.2 Which FOA payment method will pay the AWS bill?** (Please don't write card numbers here.)

  ☐ FOA card held by: ________  ☐ Other: ________
- **Q9.3 Decision: approve the sending addresses** ending @notify.[domain] and @news.[domain], with replies to support@[domain]?

  ☐ Approve  ☐ Change: ________
- **Q9.4 Sender name shown in people's inboxes.**

  ☐ "Friends of Animals"  ☐ Other: ________

---

## 10. Domain and DNS

FOA's **domain** is its web address (for example, the part after "www."). **DNS** is the domain's address book: it tells the internet where the website is and which services may send email for the domain. We understand FOA's domain is managed on **Cloudflare**. Please confirm.

### What we ask

- **Keep DNS on Cloudflare.** If the domain was also bought through Cloudflare, it must stay on Cloudflare's DNS anyway. Moving it would mean transferring the domain to another company, for no gain. Keeping it also lets Cloudflare forward email for support@[domain] if FOA has no mailbox.
- **Invite the developer** to FOA's Cloudflare account, so the developer can add the records below. FOA stays the owner.

### Records the developer will add

- **Website records** pointing the domain to Vercel, which hosts the site.
- **Email records** (SPF, DKIM, DMARC; see Appendix D) proving FOA's emails are genuine, so they avoid spam.
- **Optional:** forwarding for support@[domain], if FOA has no mailbox on the domain.

The developer will not change or remove FOA's existing records (for example, those for FOA's current email) without asking first.

### Questions

- **Q10.1 Which domain does FOA use?**

  Answer: ________
- **Q10.2 Who controls it, and where was it bought?**

  Person: ________  ☐ Bought through Cloudflare  ☐ Bought elsewhere: ________
- **Q10.3 Decision: keep DNS on Cloudflare?**

  ☐ Yes  ☐ Want to discuss
- **Q10.4 Developer invited to the Cloudflare account?**

  ☐ Done on: ________ (invite sent to the email on page 1)
- **Q10.5 Does FOA already have mailboxes on this domain?**

  ☐ Google Workspace  ☐ Zoho Mail  ☐ Other: ________  ☐ None. If none: forward `support@` to: ________

---

## 11. Account ownership and credentials

### Recommendation

- **FOA owns every account.** The developer joins each one as a team member with an individual login, where the provider allows it. The DLT registration must be in FOA's name in any case.
- **Use an FOA mailbox for logins,** not a personal one. For example, a shared address on FOA's domain that more than one trusted person can read. If someone leaves FOA, the accounts stay with FOA.
- **Use an FOA-owned phone number for two-factor authentication (2FA),** the second step at login, usually a code sent to a phone. Not a personal mobile, for the same reason.

### Who owns which account

| Account | Owned by (FOA person) | Login email / 2FA phone | ☐ done |
|---|---|---|---|
| Razorpay | ________ | ________ | ☐ |
| DLT portal | ________ | ________ | ☐ |
| MSG91 | ________ | ________ | ☐ |
| AWS (Amazon SES) | ________ | ________ | ☐ |
| Cloudflare | ________ | ________ | ☐ |
| Domain registrar (if not Cloudflare) | ________ | ________ | ☐ |

### Where account IDs and keys will be kept

Each provider gives the platform account IDs and API keys. They must be stored somewhere safe that FOA controls. A **password manager** is an app that stores passwords and keys in an encrypted vault and lets a team share them without sending them in messages. Options:

- **(a) An FOA-owned Bitwarden organisation.** **Recommended.** Its plans and prices were not covered by our research.
- **(b) An FOA-owned 1Password account.** Its plans and prices were not covered by our research.
- **(c) In the developer's own password manager.** Simplest at first, but FOA then depends on the developer to reach them.

**Never send keys or passwords by WhatsApp or email, and never write them in this document.** One-time login codes are never shared: the account owner approves them on their own phone.

### Questions

- **Q11.1 FOA mailbox to use for logins.**

  Answer: ________
- **Q11.2 FOA-owned phone number for 2FA.** (Please don't write any codes here.)

  Number held by: ________
- **Q11.3 Account table above filled in?**

  ☐ Yes
- **Q11.4 Decision: where should account IDs and keys be kept?**

  ☐ (a) Bitwarden  ☐ (b) 1Password  ☐ (c) Developer's password manager

---

## 12. Open questions

The developer's research raised these further questions for FOA.

- **Q12.1 Foreign donations. Does FOA expect donations from abroad in the next 2–3 years?** To accept money from abroad, FOA needs FCRA registration and a payment company other than Razorpay. Eligibility depends on FOA's age and past spending; approval takes months. If the answer is yes, the CA should check eligibility now. Since the FCRA Amendment Rules 2026, registration is per purpose and State, with fees for each (law-firm summary). Does the ₹10,000 fee in Appendix C still cover FOA? CA to check.

  ☐ Yes  ☐ No  ☐ Not sure
- **Q12.2 Data location. Does FOA have any rule that personal data must stay in India?** Email already will: the developer has chosen Amazon SES in Mumbai (section 9), so email sending and records stay in India. Please tell us if FOA, a funder or a partner school has any other data-location rule.

  ☐ No objection to the plan  ☐ Data must stay in India  ☐ Want to discuss
- **Q12.3 WhatsApp messages (later, no action now).** WhatsApp can come after the first launch. It would need a Meta business portfolio, a phone number FOA owns (a new one is simplest) and a display name. New accounts can message 250 people a day; business verification is one way to raise that. Meta charges per message. Since 1 October 2026 it also charges for service messages beyond 1,000 a month per number. Meta may waive this until 31 December 2027 for non-profits it decides are eligible; FOA cannot apply for this yet. Is FOA interested later?

  ☐ Yes  ☐ No  ☐ Later

---

## 13. Reply sheet

Please fill in this sheet and return it with the documents.

| # | Question | Answer |
|---|---|---|
| Q3.1 | Legal form | ☐ Trust ☐ Society ☐ Section 8 ☐ Not sure |
| Q3.2 | Legal name exactly as on PAN | ________ |
| Q3.3 | Registration number and date | ________ |
| Q3.4 | FOA's PAN | ________ |
| Q3.5 | GST number, if any | ________ |
| Q3.6 | Registered address | ________ |
| Q3.7 | Authorised signatory: name, designation, mobile, email | ________ |
| Q3.8 | Bank, branch, account name, IFSC, last 4 digits | ________ |
| Q3.9 | Trustees/members/directors and UBOs | ☐ Table in section 3 filled in |
| Q4.1 | Tax status today | ________ |
| Q4.2 | Registration/approval numbers and validity | ________ |
| Q4.3 | Activities already started? | ☐ Yes ☐ No |
| Q4.4 | CA's name and contact | ________ |
| Q4.5 | Form to file, and filing date | ________ |
| Q4.6 | Tax-deductible receipts for donors? | ☐ Yes ☐ No ☐ Later |
| Q5.1 | Section 5 documents sent | ☐ All ☐ Some |
| Q6.1 | Where policy pages go live | ________ |
| Q6.2 | What FOA charges for | ________ |
| Q6.3 | Fee amounts | ________ |
| Q6.4 | When refunds are given | ________ |
| Q6.5 | Refund time and who decides | ________ |
| Q6.6 | Privacy contact / grievance officer | ________ |
| Q6.7 | Complaint response times | ☐ Approve ☐ Change |
| Q6.8 | Public contact details | ________ |
| Q6.9 | Who approves page text | ________ |
| Q6.10 | Sample receipt; receipt signatory | ________ |
| Q6.11 | GST on fees, CA to confirm | ________ |
| Q7.1 | Existing Razorpay account? | ☐ Yes ☐ No |
| Q7.2 | Who signs up | ________ |
| Q7.3 | Razorpay fees approved? | ☐ Yes ☐ Discuss |
| Q7.4 | Offer monthly donations? | ☐ Yes ☐ No ☐ Later |
| Q7.5 | Razorpay contact; pricing and Form 106/107 answers | ________ |
| Q7.6 | When to activate Razorpay | ☐ ASAP ☐ Near launch |
| Q8.1 | Who does DLT registration; which portal | ________ |
| Q8.2 | Header FOAIND or alternative | ________ |
| Q8.3 | SMS wording, Appendix B | ☐ Approved ☐ With changes |
| Q8.4 | DLT and SMS costs approved? | ☐ Yes ☐ Discuss |
| Q8.5 | Authorisation letter signed | ☐ Yes |
| Q9.1 | AWS account owner | ________ |
| Q9.2 | Payment method for AWS bill | ________ |
| Q9.3 | Sending addresses @notify.[domain] and @news.[domain]; replies to support@[domain] | ☐ Approve ☐ Change |
| Q9.4 | Sender name in inboxes | ________ |
| Q10.1 | FOA's domain | ________ |
| Q10.2 | Who controls it; where bought | ________ |
| Q10.3 | Keep DNS on Cloudflare? | ☐ Yes ☐ Discuss |
| Q10.4 | Developer invited to Cloudflare | ☐ Done |
| Q10.5 | Existing mailboxes; support@ forwarding | ________ |
| Q11.1 | FOA mailbox for logins | ________ |
| Q11.2 | FOA phone for 2FA, held by | ________ |
| Q11.3 | Account ownership table filled in | ☐ Yes |
| Q11.4 | Where keys are kept | ☐ (a) ☐ (b) ☐ (c) |
| Q12.1 | Foreign donations in 2–3 years? | ☐ Yes ☐ No ☐ Not sure |
| Q12.2 | Any data-location rule? | ________ |
| Q12.3 | WhatsApp later? | ☐ Yes ☐ No ☐ Later |

Filled in by: ________  Designation: ________  Date: ________

---

## 14. Appendices

### Appendix A: Draft DLT authorisation letter

To be printed on FOA letterhead and signed by FOA's authorised signatory. Text in [square brackets] is for FOA to fill in. **Final wording to match the DLT portal's format:** if the chosen portal provides its own letter format, the developer will copy these details into it.

[FOA LETTERHEAD]

Date: [date]

To: [Name of the DLT platform, for example Jio TrueConnect, Airtel, Vi or SmartPing]

Subject: Authorisation to register [exact legal name as on FOA's PAN] as a Principal Entity on the DLT platform

Dear Sir or Madam,

We, [exact legal name as on FOA's PAN], a [trust / registered society / Section 8 company] registered under number [registration number], with PAN [FOA's PAN] and our registered office at [registered address], authorise:

[Full name of the authorised person], [designation or relationship to FOA], mobile [mobile number], email [email address]

to register our organisation as a Principal Entity on your DLT platform, through our SMS provider MSG91, and on our behalf to:

- register and manage our sender header(s);
- register and manage our SMS content templates;
- register the web addresses used in our messages; and
- declare MSG91 as the telemarketer (the DLT term for our SMS company) that sends our messages.

The documents and information submitted for this registration are true and belong to our organisation.

Yours faithfully,

Signature: [signature]

Name: [name of FOA's authorised signatory]

Designation: [designation]

[FOA stamp, if FOA uses one]

### Appendix B: Draft SMS templates (for approval)

**Drafts for FOA's approval.** One template per SMS message in the platform's design. How to read them:

- **{#var#}** marks a blank that the platform fills in. This is the format the DLT portal requires. Each blank can hold at most **30 characters**. Long names (school, competition, event, artwork title) are cut to 30 characters. The "Blanks" column says what goes into each blank, in order.
- Every web link is a **short link on FOA's own domain**, which must be on FOA's DLT approved-links list.
- Messages use a **first name only**. They never include a date of birth or a home address. A parent with several children in one competition gets one reminder with a count.
- SMS are not sent between 9 pm and 9 am, except login codes and safeguarding and security-incident alerts to FOA staff (B33–B35).
- All templates are registered in the DLT category **Service-Implicit** (service messages to people who use FOA's services). FOA sends no promotional SMS.
- Once approved, any change to the wording needs a new DLT approval.
- B22 to B27 are for **auctions**, which are planned for later. They can be registered when auctions start.

| Ref and purpose | Draft text | Blanks, in order |
|---|---|---|
| B1. Login code | {#var#} is your FOA login code. It expires in 10 minutes. Never share this code with anyone. | Code |
| B2. Contact details changed (security notice) | FOA: The contact details on your FOA account were changed. If this wasn't you, open {#var#} now. | Link |
| B3. School or institution verified | FOA: Your institution is now verified. Open your dashboard to add coordinators and students: {#var#} | Link |
| B4. Invitation to join an institution | FOA: You are invited to join {#var#} on FOA. Accept within 7 days: {#var#} | Institution name; link |
| B5. Registration confirmed | FOA: Registration confirmed for {#var#}. Participant ID {#var#}, Reg. No. {#var#}. Log in: {#var#} | First name; Participant ID; Registration No.; link |
| B6. Fee reminder (day before registration closes) | FOA: Rs {#var#} is due to complete your registration. Registration closes {#var#}. Pay here: {#var#} | Amount; closing date; link |
| B7. Parent consent request | FOA: Your consent is needed for {#var#} to take part (requested by {#var#}). Please review within 7 days: {#var#} | Child's first name; who asked (school or "you"); link |
| B8. Consent reminder | FOA: Reminder: consent for {#var#} is still pending, so the next steps are on hold. Review here: {#var#} | First name or number of children; link |
| B9. Competition instructions ready | FOA: Instructions for {#var#} are ready: date, theme, materials and how to submit. Read them: {#var#} | Competition name; link |
| B10. Competition dates changed | FOA: {#var#} has moved from {#var#} to {#var#}. Details and reason: {#var#} | Competition name; old date; new date; link |
| B11. Submissions open | FOA: Submissions for {#var#} are open until {#var#}. Upload here: {#var#} | Competition name; closing date; link |
| B12. Submission reminder (day before close) | FOA: Submissions for {#var#} close tomorrow, {#var#}. {#var#} item(s) still pending. Upload: {#var#} | Competition name; deadline; count; link |
| B13. Competition cancelled | FOA: We are sorry, {#var#} has been cancelled. Reason and refund details: {#var#} | Competition name; link |
| B14. Submission received | FOA: Submission received for {#var#}: "{#var#}", entry code {#var#}, at {#var#} IST. | First name; artwork title; entry code; date and time |
| B15. Entry needs a change | FOA: Entry {#var#} needs a change before {#var#}. See what to fix: {#var#} | Entry code; deadline; link |
| B16. School judging reminder (to coordinators, day before deadline) | FOA: School judging for {#var#} closes tomorrow, {#var#}. {#var#} entries still to judge: {#var#} | Competition name; deadline; count; link |
| B17. Entry shortlisted (also used when a school finalises its shortlist) | FOA: Good news! {#var#}'s entry {#var#} has been shortlisted for FOA-level judging. Next steps: {#var#} | First name; entry code; link |
| B18. Original artwork requested | FOA: Please send the original artwork for entry {#var#} (artwork code {#var#}) by {#var#}. Packing steps and address: {#var#} | Entry code; artwork code; deadline; link |
| B19. Artwork dispatch reminder | FOA: Reminder: artwork {#var#} must be dispatched by {#var#}. Enter the courier tracking number here: {#var#} | Artwork code; deadline; link |
| B20. Artwork received | FOA: We have received artwork {#var#}. Thank you! | Artwork code |
| B21. Results published (same neutral wording for every outcome) | FOA: Results for {#var#} are published. See {#var#}'s result: {#var#} | Competition name; first name; link |
| B21a. Results published (institution) | FOA: Results for {#var#} are published. See your institution's summary: {#var#} | Competition name; link |
| B22. Outbid (final hour of an auction) | FOA auction: You have been outbid on lot {#var#}. Current bid Rs {#var#}, closes {#var#}. Bid again: {#var#} | Lot code; amount; closing time; link |
| B23. Auction won | FOA auction: You won lot {#var#} for Rs {#var#}. Please pay by {#var#}: {#var#} | Lot code; amount; deadline; link |
| B24. Auction payment reminder | FOA auction: Rs {#var#} for lot {#var#} is due by {#var#}. Unpaid lots are offered to the next bidder. Pay: {#var#} | Amount; lot code; deadline; link |
| B25. Auction payment missed | FOA auction: The payment deadline for lot {#var#} has passed. The offer has lapsed and a strike was recorded on your account. | Lot code |
| B26. Second-chance offer | FOA auction: Lot {#var#} is offered to you at your highest bid, Rs {#var#}. Pay by {#var#} to accept: {#var#} To decline: {#var#} | Lot code; amount; deadline; pay link; decline link |
| B27. Lot shipped | FOA auction: Lot {#var#} has been shipped by {#var#}. Tracking: {#var#} | Lot code; courier name; tracking link |
| B28. Monthly donation charge failed | FOA: Your monthly donation of Rs {#var#} could not be charged. Please update your payment method: {#var#} | Amount; link |
| B29. Event place confirmed from waiting list | FOA: A place has opened up. You are now confirmed for {#var#} on {#var#}. Details: {#var#} | Event name; date; link |
| B30. Event reminder | FOA: Reminder: {#var#} starts {#var#}. Venue or joining link: {#var#} | Event name; date and time; link |
| B31. Event changed | FOA: {#var#} has changed. New details: {#var#} | Event name; link |
| B32. Event cancelled | FOA: We are sorry, {#var#} on {#var#} has been cancelled. Details: {#var#} | Event name; date; link |
| B33. New safeguarding report (to FOA's safeguarding staff) | FOA: New safeguarding report {#var#}. Please log in to FOA admin and open Safeguarding now. | Report reference |
| B34. Safeguarding report escalated (to FOA staff) | FOA: Safeguarding report {#var#} escalated, severity {#var#}. Please log in to FOA admin and open Safeguarding now. | Report reference; severity |
| B35. Security incident declared (to FOA staff) | FOA: Incident {#var#} declared, severity {#var#}. Please log in to FOA admin and open the incident record. | Incident reference; severity |

Safeguarding and incident alerts never contain the content of a report or any personal data.

### Appendix C: Cost summary

Amounts as found in the developer's research on 17 November 2026. Prices can change; each provider's own page is final.

| Item | One-time | Recurring | Notes |
|---|---|---|---|
| Tax registration (Form 104/105) | Not covered by our research | — | Ask your CA about fees |
| Razorpay | Possible ₹199 + tax KYC fee | 2% + 18% GST per payment (2.15% corporate credit cards) | No setup or annual fee |
| Razorpay monthly donations | — | Card: extra 0.9%. UPI and bank mandate: on request | Ask support to confirm |
| DLT registration | About ₹5,900 (₹5,000 + GST) | — | SmartPing figure; Jio and Airtel reported the same |
| MSG91 SMS | — | ₹0.16–0.25 per SMS + 18% GST | Price per SMS falls as volume rises |
| Amazon SES email | — | USD 0.10 per 1,000 emails | Billed in rupees by AWS India |
| Cloudflare DNS | — | Not covered by our research | FOA's existing account |
| Password manager | — | Not covered by our research | Section 11 |
| Later: FCRA | FC-3A from ₹10,000 (2026 per-purpose fees unverified), or FC-3B ₹5,000 | — | Only if FOA wants foreign donations |
| Later: WhatsApp | — | Charged per message | Possible non-profit waiver until 31 December 2027 |

- **Razorpay welcome offer:** no platform fee on the first ₹5 lakh of domestic payments within 90 days of activation (exclusions apply; see section 7).

### Appendix D: Glossary

- **2FA (two-factor authentication):** a second step at login, usually a code sent to a phone or shown in an app, on top of the password.
- **12A / 80G:** the old (Income-tax Act 1961) names for a non-profit's income-tax registration (12A/12AB) and its approval for donor tax deductions (80G). Since 1 April 2026 they are **section 332** (registration) and **section 354** (approval) of the Income-tax Act 2025.
- **Amazon SES (Simple Email Service):** Amazon's service for sending email from software. Chosen for FOA's receipts, confirmations and reminders.
- **API key:** a secret code that lets the platform's software use a provider account. Treat it like a password.
- **AWS (Amazon Web Services):** Amazon's cloud services company. SES is one of its services. Indian accounts are contracted with AWS India.
- **CA (Chartered Accountant):** FOA's accountant, who handles tax registrations and filings.
- **CERT-In:** India's national cyber-security agency. Its rules require AWS India to verify every account holder.
- **Cloudflare:** the company that manages FOA's domain and DNS.
- **CKYC:** a central KYC record. If FOA has one, Razorpay checks it first.
- **DigiLocker:** the government's digital document wallet. Razorpay uses it to complete its identity check.
- **DKIM:** a digital signature added to each email, proving it really came from FOA's domain.
- **DLT:** the registration system run by Indian telecom operators, under TRAI's rules, that every business SMS sender must use.
- **DMARC:** a DNS record that tells receiving mail services what to do with email that fails the SPF and DKIM checks.
- **DNS:** the domain's address book. It tells the internet where FOA's website is and which services may send email for it.
- **e-mandate:** a standing instruction that lets a payment company debit a donor's bank account each month.
- **FCRA:** the Foreign Contribution (Regulation) Act. An organisation needs FCRA registration to accept money from foreign sources.
- **Header:** the 6-character sender name shown on phones for FOA's SMS (proposed: FOAIND).
- **KYC (Know Your Customer):** identity checks a provider must run on a customer before serving it.
- **MSG91:** the Indian SMS company the platform will use to send SMS.
- **Password manager:** an app that stores passwords and keys in an encrypted vault and lets a team share them safely.
- **PAN:** Permanent Account Number, issued by the Income Tax Department. FOA has its own PAN, separate from its trustees' PANs.
- **Principal Entity:** the organisation registered on DLT as the sender of SMS. For FOA's SMS, this is FOA.
- **Razorpay:** the Indian payment company that will collect fees and donations on FOA's website.
- **SPF:** a DNS record listing which services may send email for the domain.
- **Template:** the exact, pre-approved wording of an SMS, with blanks for details such as names and dates.
- **TRAI:** the Telecom Regulatory Authority of India, which sets the SMS rules.
- **UBO (ultimate beneficial owner):** a person who ultimately owns or controls an organisation. Razorpay asks for a declaration of them.
- **UPI Autopay:** monthly UPI payments that the donor approves once in their UPI app.
- **Vercel:** the company that hosts FOA's new website.
