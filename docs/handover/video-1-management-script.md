# Video 1: Friends of Animals platform, what's built and what's left

**Audience:** FOA management committee (non-technical)
**Length:** about 8–9 minutes (about 1,000 spoken words, plus pauses on screen)
**Tone:** plain, warm, confident. No technical words on screen or in the voiceover.

## Before you record

- **Live site:** `https://friendsofanimals.dev`. Use it for the public pages in scene 3.
- **Practice copy:** sign-in is not open on the live site yet, so record scenes 4 to 7 on a practice copy filled with made-up data. A developer can start one in about 10 minutes (setup steps are in the developer video's appendix). Every name in it is fake.
- **Avoid on the live site today:** `/gallery` and `/verify` show an error page until the latest version is put live. Record those two pages on the practice copy.
- **GitHub (scene 8):** open `https://github.com/SiddharthMuramkar/friends-of-animals/issues` in a browser.
- **Screen size:** record the browser at 1920×1080, zoomed to 125% so text reads on a phone.

---

## Scene 1: Opening (0:00–0:40)

**On screen:** FOA logo, then the home page of friendsofanimals.dev, scrolling slowly.

**Say:**

> Friends of Animals exists to grow compassion for animals in children and young people. Over the past weeks we turned FOA's brief into a working website. In the next nine minutes I'll show you what it does, prove that every piece of the brief has been built, and walk through the short list of things only FOA can do before we open it to schools and families.

## Scene 2: What FOA asked for (0:40–1:30)

**On screen:** The brief document, scrolling past its six sections. Then a simple slide with five lines: _Competitions · Children's safety · Money and transparency · Community · Running FOA_.

**Say:**

> The brief asked for one platform that takes a child from a competition announcement all the way to being a lifelong supporter. It covers five things. Running art competitions through schools or alone. Keeping children's data and artwork safe. Taking donations and showing exactly where the money goes. Growing a community of volunteers, clubs, rescue groups and adopters. And giving FOA's staff the tools to run all of it. The brief also listed six open questions. Each one was decided and then built, so nothing was left to guesswork.

## Scene 3: The public website (1:30–2:45)

**On screen (live site):** click through: Home → About → Competitions → one competition page → Impact → Awareness → Blog → Events → Donate → Transparency → NGO directory → Adopt. Finish on the Safeguarding page and press **Quick exit**.

**Say:**

> This is the public website, live today. Visitors can read who FOA is, see current and upcoming competitions with their themes, age groups, dates and rules, and read stories and awareness material about treating animals kindly. The impact page shows FOA's reach. The donate page and the transparency page sit side by side, because FOA promised to show every rupee. There's a directory of animal-welfare groups and a page of animals waiting for homes. And this safeguarding page has a quick-exit button, so a child who feels unsafe can leave in one tap.

## Scene 4: A child's competition journey (2:45–4:15)

**On screen (practice copy):** follow one school:

1. School registration form, then the school's dashboard showing its Institution ID.
2. Student list imported from a spreadsheet, with one bad row flagged.
3. One payment for the whole class.
4. A student's artwork upload, then the confirmation with its Entry ID.
5. The school's judging page: positions 1st, 2nd and 3rd, and the shortlist.
6. FOA staff checking a shortlisted entry, then the "send us the original" request with the Artwork ID and courier tracking.
7. The judge's screen: the artwork with **no name, school or city**.
8. Results waiting for a second staff member's approval.
9. A certificate with its QR code, then the verify page showing **Valid**.

**Say:**

> Here's the heart of it: one child's journey. A school registers and gets its Institution ID. A teacher adds the whole class from a spreadsheet, and the site points out any row with a mistake. The school pays for everyone in one go. Each student's artwork is uploaded and gets its own Entry ID. The school judges its own round using FOA's scoring guide and sends its best work to FOA. FOA checks each entry, then asks for the original artwork, with a tracking number so nothing gets lost. FOA's judges score the work without ever seeing the child's name, school or city, so judging is fair. Results need a second staff member to approve them before they go public. Every child gets a certificate with a QR code, and anyone can scan it to check it's genuine. Children can also enter on their own without a school, and they follow the same path from FOA's check onwards.

## Scene 5: Keeping children safe (4:15–5:00)

**On screen (practice copy):** a guardian's consent page with separate switches (taking part, public display, school and city, social media, auction, messages). Then a gallery card showing "Aarav S." style credit. Then the safeguarding report form.

**Say:**

> Most participants are children, so safety is built in, not bolted on. A parent or guardian gives each permission separately: taking part, showing the work publicly, social media, even auctioning the artwork. If they withdraw permission, the work comes down. In public, a child is shown only by first name and last initial, and their school and city appear only if the parent says yes. Anyone can report a worry about a child privately, and only FOA's safeguarding lead sees those reports. Families can also ask to see, correct or delete their data.

## Scene 6: Money and transparency (5:00–5:50)

**On screen (practice copy):** donate page → one-time and monthly options → a receipt with its receipt number. Then the staff ledger, a budget report, then the public transparency page.

**Say:**

> Donors can give once or every month, and they get a numbered receipt. Companies and CSR partners choose whether their name is shown. Every payment, refund and donation is recorded in FOA's books automatically. Some money actions need two finance approvers, so no one person can move money alone. Once a month is closed, it's locked, and corrections show as visible reversals. The public transparency page is built straight from those locked books, with no donor's personal details, so the figures can be trusted.

## Scene 7: Beyond competitions (5:50–6:30)

**On screen (practice copy):** a member's timeline (participant → school winner → finalist → volunteer), the clubs page, the volunteer hours page, an event with check-in, an adoption application, an auction lot with bids, the reports page.

**Say:**

> A competition is meant to be a beginning. Each person has a timeline showing their journey, from participant to winner to volunteer to ambassador. Schools can start FOA clubs. Volunteers log hours and earn certificates. Events have sign-ups, waiting lists and check-in. Rescue groups list animals for adoption, and FOA connects them with adopters. Consented artwork can be auctioned, with the money going into FOA's books. And leadership gets reports on participation, partners, volunteers, donations and feedback.

## Scene 8: Proof that the work is done (6:30–7:15)

**On screen:** GitHub issues page. Show the **Open** tab with **0**, then the **Closed** tab. Scroll the ticket titles "M0: …" to "M8: …". Then open `docs/handover/spec-check.md` on GitHub and scroll its tables of green ticks.

**Say:**

> Every piece of work was tracked as a ticket. There are no open tickets left. All 80 build tickets, across nine stages, are closed, along with the research and decision tickets behind them. We also checked the original brief line by line against those closed tickets. Every role, feature and workflow it asked for is covered. Four things were done more simply on purpose: courier tracking numbers are typed in rather than linked to a courier company, social media posts are prepared for staff to post by hand, website visitor statistics sit in their own dashboard, and vets appear as a service in the directory rather than a separate category.

## Scene 9: What's left (7:15–8:45)

**On screen:** a slide with this table, revealed one row at a time.

| To do                                                                                                         | Who                        | What it unlocks                         |
| ------------------------------------------------------------------------------------------------------------- | -------------------------- | --------------------------------------- |
| Approve Amazon's email sending (reply to the open support case)                                               | FOA owner                  | Sign-in for everyone                    |
| Name staff: admins, 2 finance approvers, safeguarding lead and deputy, grievance officer, 2 results approvers | FOA leadership             | Staff can run the site                  |
| Enter FOA's real details: legal name, registration number, PAN, contacts                                      | FOA staff                  | Correct facts on every page and receipt |
| Finish Razorpay's checks for NGOs, including the video check                                                  | FOA treasurer              | Fees, donations and auction payments    |
| Open a Cloudflare storage account for artwork photos and videos                                               | FOA owner, with developers | Uploads and entries                     |
| Register FOA's SMS sender (DLT, through MSG91)                                                                | FOA owner                  | Text messages and phone sign-in         |
| Lawyer approves privacy, terms and consent wording, and how long data is kept                                 | Lawyer                     | Legal pages and consent forms           |
| Safeguarding lead approves the children's and guardians' steps                                                | Safeguarding lead          | Children's sign-up                      |
| Accountant confirms the accounts, receipts, 80G/12A and auction tax                                           | Accountant                 | Final receipts and reports              |
| Decide fees, refunds, auctioning children's work and the artist's share                                       | Committee                  | Pilot competition settings              |
| Put the latest version live, restart the background service, add off-site backups and alerts                  | Developers                 | A complete, safe live site              |
| Accept in writing that one server has no standby                                                              | Committee                  | Pilot can start                         |

**Say:**

> So what's left? Almost none of it is building. It's paperwork, decisions and sign-offs only FOA can give. The most urgent is Amazon's approval to send email, because nobody can sign in without it. Then FOA names its staff and enters its real details. Razorpay needs to finish its checks before any money can be taken. FOA needs a storage account for artwork photos and videos. A lawyer, the safeguarding lead and the accountant each need to approve their parts. The committee needs to decide fees, refunds and whether children's artwork can be auctioned. The new developers will put the latest version live and add off-site backups and alerts. And because the site runs on one server with no standby, the committee should accept that risk in writing before the pilot.

## Scene 10: Close and the ask (8:45–9:30)

**On screen:** home page again, then a closing slide: _Three things we need from you this month: 1. Reply to Amazon. 2. Name our staff. 3. Start Razorpay's checks._

**Say:**

> The platform is built. Every ticket is closed, and every part of the brief is covered. What stands between us and the first pilot competition is a short list of FOA decisions. If we can do three things this month, replying to Amazon, naming our staff and starting Razorpay's checks, the developers can switch features on one by one and we can welcome our first schools. Thank you.
