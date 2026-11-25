# Friends of Animals platform

The platform that takes a child from a competition announcement to a lifelong
relationship with Friends of Animals (FOA), an Indian non-profit, and lets FOA run
competitions, fundraising and its community in one place.

## Accounts and access

**User**:
A person with an account on the platform, identified by an email address, a
phone number or both.
_Avoid_: Customer, login

**Member**:
A User with the member role: someone with an account who holds no staff,
institution or guardian role. Not the same as a community member on the
engagement ladder.
_Avoid_: Basic user, normal user

**Visitor**:
Someone using the platform without being signed in.
_Avoid_: Guest, anonymous user

**Actor**:
Whoever is performing an action: a Visitor, a signed-in User acting through one
session, or the platform itself (the seed command, the worker).
_Avoid_: Caller, principal, current user

**Session**:
One signed-in device or browser of a User, which the User can see and end.
_Avoid_: Login, token

**Sign-in code**:
A short-lived number emailed or texted to a User to prove they hold that
address or phone; it is how people sign up and sign in, with no password.
_Avoid_: OTP (in copy), password, token

**Sign-in method**:
A way to receive sign-in codes: email, always on, or SMS, which stays off
until FOA's SMS sender registration is approved.
_Avoid_: Login type, provider

**Role**:
What a User is to the platform, such as a judge, an institution coordinator or
a super admin, which decides what they may do. A User may hold several.
_Avoid_: Permission, group, user type

**Scope**:
Where a Role applies: everywhere (global), or one institution, competition or
organisation.
_Avoid_: Tenant, context

**Grant**:
One Role held by one User at one Scope. A super admin grants and revokes them.
_Avoid_: Assignment, role membership

**Staff**:
The Users holding one of FOA's own Roles: the admins, managers and finance.
Judges, coordinators and volunteers are not Staff.
_Avoid_: Admins, employees, team

**Second factor**:
A second proof that a User is who they say, after the Sign-in code: a code from
an authenticator app or a passkey on their device. Staff must add one and pass
it once in each Session before any staff page or staff action.
_Avoid_: 2FA (in copy), MFA, OTP

**Step-up**:
Passing the Second factor again, within the last 10 minutes, before a sensitive
action such as granting a Role, publishing results or moving money.
_Avoid_: Re-authentication, sudo mode

**Policy**:
The rules that decide whether an Actor may take an action, from the Actor's
Grants and the Scopes and owner of what they act on.
_Avoid_: Permissions, ACL

**Dashboard**:
The part of the platform one kind of Role works in, such as the admin or one
institution's. A User with several Roles switches between their Dashboards.
_Avoid_: Portal, home, active role

**Audit log**:
The record of every change to who may do what, and later to other records:
who made it, with which Role, to what, before and after, from where and when.
Nobody can edit or delete an entry.
_Avoid_: Activity log, history, event log

## Personal data

**Encrypted field**:
Personal data, such as a User's phone number, that the database holds only in
encrypted form, so a leaked backup or a raw query can't read it.
_Avoid_: Hashed field, masked field, secure column

**Blind index**:
A keyed fingerprint kept beside an Encrypted field, so the platform can find a
record by that value (a User by phone at sign-in) without storing it readably.
_Avoid_: Phone hash, lookup hash

**Rights request**:
A request under India's data protection law, by a User about their own data
or by a Guardian about a linked child's: for a copy of it (access), to
correct it, or to erase it. Each has a reference, a due date and a status
the requester follows.
_Avoid_: DSAR, privacy ticket, data request

**Grievance officer**:
The Role held by FOA's grievance officer: the only people who answer Rights
requests, in the grievance queue. No other Role can, super admins included.
_Avoid_: DPO, privacy admin

**Data export**:
The file of everything FOA keeps about one person, prepared for an access
request. Only the person who made the request can download it, for a
limited time; staff never see it.
_Avoid_: Data dump, takeout

**Erasure**:
Carrying out an erasure request: the person's consents are withdrawn, and
their records deleted or anonymised, except what the law makes FOA keep
(payments under their floor, proof of consent, the Audit log) or a legal
hold stops. What was kept, why and until when is recorded and told to them.
_Avoid_: Deletion (for the whole process), right to be forgotten

## Safeguarding

**Safeguarding report**:
A concern about a child's safety that anyone sends through the public report
form, with or without an account and with or without their name. What it says
is held in Encrypted fields, and only a Safeguarding lead can read it.
_Avoid_: Ticket, complaint, case

**Safeguarding lead**:
The Role held by FOA's designated safeguarding lead and their deputy: the only
people who can read and handle Safeguarding reports. No other Role can, super
admins included.
_Avoid_: DSL (in code), safeguarding admin

**Incident log**:
Everything done on one Safeguarding report, in order: each move through its
statuses and each note a Safeguarding lead adds. Nobody can edit or delete an
entry.
_Avoid_: Case notes, report history

## Operations

**Setting**:
A switch or value staff can change on a running site without a deploy, such
as whether sign-in codes may go by SMS.
_Avoid_: Feature flag, config, environment variable

## Consent

**Consent document**:
A text FOA publishes for one Purpose, such as the privacy notice or the
agreement to News and updates. Each change is a new Version; a published
Version never changes.
_Avoid_: Policy (a Policy decides what an Actor may do), legal page, agreement

**Version**:
One published text of a Consent document, numbered 1, 2, 3 within its Purpose.
_Avoid_: Revision, draft, edition

**Purpose**:
What a Consent document is for: the privacy notice, the terms, or News and
updates; the purposes a guardian decides for a child come later.
_Avoid_: Category, type, scope (a Scope is where a Role applies)

**Notice**:
A Consent document people read but don't give or withdraw: the privacy notice
and the terms.
_Avoid_: Policy page

**Consent**:
A person's yes to one Purpose, given on one Version, by someone (themselves
or, later, a guardian), at a time and by a method, until a Withdrawal. Every
give and Withdrawal stays in its history.
_Avoid_: Opt-in, subscription, permission

**Withdrawal**:
A person taking back their Consent to a Purpose. It counts at once, and the
parts of the platform that relied on it stop.
_Avoid_: Opt-out, unsubscribe, revoke (a super admin revokes a Grant)

**News and updates**:
The optional emails a User receives only with Consent: competitions, results,
stories and tips. Sign-in codes, receipts and notices the law requires are not
News and updates and never depend on it.
_Avoid_: Marketing, newsletter, messages (alone)

## Competition terms

**Route**:
A way into a competition: entering on your own, or through a school or
institution. A competition offers one or both.
_Avoid_: Track, channel, participation type

**Fee**:
What one Route costs, in paise and INR, set by a competition manager. Zero
means free; a Route with no Fee set yet can't take registrations. Fees lock
once registration opens.
_Avoid_: Price, charge, amount (alone)

**Round**:
A stage a competition's entries are judged in: the school round (when
institutions take part) and the FOA final.
_Avoid_: Stage, phase, level

**Award scheme**:
How a Round recognises its best entries: ranked 1st, 2nd and 3rd (the
default), gold, silver and bronze, or A and B grades. Each place in it is a
Band, with an optional prize.
_Avoid_: Prize structure, ranking, grading

**Pin**:
The one Version of a Consent document a competition asks registrants to agree
to. Publishing a newer Version leaves the Pin alone until a manager moves it.
_Avoid_: Link, attachment (alone), current version

## Payments

**Payment batch**:
One gateway order for one or more registrations: an institution paying its
students' Fees at once. It holds its registrations while it waits for the
money, and lets them go if it is replaced or the gateway refuses the order.
_Avoid_: Invoice, cart, transaction

**Capture**:
The gateway taking the payer's money for a Payment batch's order in full. A
Checkout return or a webhook only says a capture may have happened; the
gateway's own record of the order decides.
_Avoid_: Payment success, settlement

**Offline payment**:
A cheque, bank transfer or cash FOA received for a Payment batch, recorded by
finance with a reference and a private proof file. It captures the batch as
the gateway would, so its registrations are confirmed the same way.
_Avoid_: Manual payment, cash entry

**Payment needing review**:
Money the gateway captured that its Payment batch couldn't accept: a second
payment, a withdrawn registration, the wrong amount, money after
registration closed, or for a replaced batch. The batch waits in review (a
paid batch stays paid), one review case per payment, until staff accept,
refund or keep the money with a reason. Nothing is confirmed or refunded on
its own.
_Avoid_: Failed payment, disputed payment, exception

**Refund**:
A Payment batch's money going back to whoever paid it: every student it has
left, some of them (a partial refund), or a whole payment it couldn't keep.
A refund someone asks for waits for finance to approve it behind a fresh
second factor; a cancellation or a payment resolved in review is approved by
the system. Approved refunds go to the gateway, or are paid back by hand for
an offline payment. A registration is refunded only once its money is back.
_Avoid_: Reversal, chargeback, credit note

**Duplicate refund**:
A payment in review resolved with a refund: the payment goes back in full,
with no finance approval, and no registration changes. Most often the second
of two payments.
_Avoid_: Auto-refund, double refund

**Cancelled competition**:
A competition a super admin called off, with a reason, behind a fresh second
factor. It is final and moves no more. Every paid fee goes back in one
cancellation refund per Payment batch, with nobody else approving it;
unpaid and free registrations are cancelled at once, a paid one is refunded
once its money is back, and every family contact and coordinator is told.
_Avoid_: Withdrawn competition, deleted competition, archived competition

**Test checkout**:
Where a payer pays outside production while no Razorpay test keys are set:
the fallback gateway's stand-in for Razorpay's Checkout, on the pay page. It
moves no money and never runs in production.
_Avoid_: Mock payment, dummy gateway

**Ledger**:
FOA's double-entry financial record. Each posting records money in INR with
equal debits and credits, and corrections are recorded as new postings.

**Locked period**:
A month of the Ledger that finance has closed once it was reconciled. Nothing
posts into it or any month before it; a correction goes in as a reversal in an
open month. Locking or reopening one needs a second finance approver. The
transparency page shows only locked periods, so a locked period is also a
published period.
_Avoid_: Closed month, frozen period

**Late adjustment**:
A capture or refund the platform records after its month was locked. It counts
in the first open month after the locked ones, and says so.
_Avoid_: Back-dated entry, prior-period adjustment

**Finance request**:
A money operation that waits for a second finance user before it happens:
locking or reopening a month, or a manual entry above the limit in settings.
The person who asked can withdraw it but never approve it, and it expires if
nobody decides it in time.
_Avoid_: Approval, maker-checker, dual control

**Budget**:
What FOA plans to receive or spend in one Ledger category in one month,
compared with the actual in the budget report.
_Avoid_: Forecast, allocation, target

**Registration number**:
What a confirmed registration is known by: the competition's code, "R" and
six symbols (PAWS27-R-7KQ2M9). Given once, when the Fee is captured or the
Route is free.
_Avoid_: Entry number, roll number, receipt number

## Donations

**Donation**:
Money someone gives FOA, once online in INR (#106), and later monthly or
recorded offline. An online donation is paid through a Payment batch whose
purpose is the donation, and has exactly one Receipt once captured. Adults
only; foreign money is returned while FOA isn't registered under FCRA.
_Avoid_: Contribution, gift record, payment

**Recurring donation**:
A signed-in adult's monthly mandate with the payment gateway. Each
successful charge is a separate Donation with its own Receipt. The donor
can request immediate cancellation; any captured charge after that
request is returned and receives no Receipt.
_Avoid_: Subscription gift, membership fee

**Donor**:
Who gave a Donation, as they gave it: a person, or a company or CSR partner
with a contact person, which chooses whether its name may be shown in
public. A guest donor has no account.
_Avoid_: Supporter, patron, sponsor

**Donor wall**:
The public thanks to individuals who chose to have their name shown for a
Donation. It shows only the chosen name, not the person's amount or contact.
It thanks them for published donations that have not been fully returned.
_Avoid_: Donor list, donor database

**Organisation disclosure**:
A company's or CSR partner's choice when giving a Donation to show its name
and give the public its total for the published months of the financial year.
A gift for which it chose privacy is not added to its disclosed total.
_Avoid_: Donor wall opt-in (that is an individual's choice)

**Receipt**:
The numbered record of a captured Donation: FOA-RCPT, the financial year and
six digits (FOA-RCPT-2627-000123), gapless within the year. Everything it
prints is frozen when it is issued; a full refund cancels it, and its number
is never used again. Never sent as an attachment.
_Avoid_: Invoice, acknowledgement, 80G certificate

**Receipt link**:
A link that opens one Receipt for 7 days. A new link is a new token; nothing
extends an old one. The donor gets one by email, finance can make one to
pass on by hand.
_Avoid_: Download link, receipt URL

**Checkout token**:
The bearer in a Donation's checkout and thank-you links, so whoever started
it can pay and see what happened without an account. It never opens the
Receipt.
_Avoid_: Donation password, access code

## Site content

**Content document**:
One fixed page or block of the site's words that content managers change
without a deploy: the home page's sections, the about page, the impact
counters, the site facts, or one of the four policy pages. Its words live in
Revisions.
_Avoid_: Page (a page is what visitors open), post, entry

**Revision**:
One text of a Content document. A document has at most one Draft and at most
one published Revision; publishing a Draft gives it the next version number
and replaces the published one, which stays in the history unchanged.
_Avoid_: Edit, copy

**Draft**:
The Revision content managers are still editing. Nobody else sees it, except
through a Draft preview, until it is published.
_Avoid_: Pending changes, unpublished version

**Draft preview**:
A content manager seeing a public page with its Draft in place of the
published Revision, under a "Draft preview" status, until they leave it.
Everyone else sees the published Revision.
_Avoid_: Staging, preview deployment (a preview deployment is a whole site)

**Post**:
A blog post or a story: an article a content manager writes, with its own
web address, cover and images. It is a Draft until it is published, now or
at a scheduled instant, and leaves the public site only by being archived.
_Avoid_: Article (alone), entry, page

**Public copy**:
A resized Derivative of a Post's image, copied to the public bucket so the
public site can show it without signing. The original upload is never
copied there.
_Avoid_: Public URL, CDN image, original

**Photo**:
A real photograph on the public site, from a free licence, credited on the
credits page with its author, licence and the real place. Never made by AI.
_Avoid_: Image (it may be an Illustration), picture

**Illustration**:
A drawing FOA shows on the public site to explain or decorate a page. Until
commissioned artwork arrives, Illustrations are made with AI; each one is
then labelled as an AI illustration and credited with its provenance. An
Illustration never stands in for an Entry or for a real animal's photo.
_Avoid_: Artwork (that word suggests a child's work), image, AI art

**Entry**:
A child's own drawing, painting, photo or craft sent to a competition. The
site shows an Entry only with the permission recorded for it, and never shows
a made-up one.
_Avoid_: Submission (in copy), artwork

**Neighbour**:
One of the ten street animals /awareness introduces: the dog, cat, cow, crow,
myna, pigeon, sparrow, black kite, palm squirrel and koel.
_Avoid_: Stray, pet

**Living illustration**:
An Illustration of a Neighbour that moves as the page scrolls (a sleeping dog
wakes up), taken frame by frame from a short AI video. It rests on its last
frame, so it is a still drawing wherever motion is reduced or unsupported.
_Avoid_: Animation, GIF, video

**AI mark**:
The small hand-lettered "AI illustration" tag beside an Illustration that
carries meaning, or beside a decorative one that could be taken for a child's
drawing. The footer says that the drawings decorating the site are AI
illustrations, not children's work.
_Avoid_: Watermark, badge

## Messages

**Capture mailbox**:
Where every message the platform would send outside production is kept instead,
so staff and automated journeys can read it and no real person receives it.
_Avoid_: Dev inbox, outbox (the outbox is a different thing)

**Message template**:
The wording of one message on one channel (email, SMS or in-app), with
placeholders such as `{{recipient.name}}`, which content managers edit without a
deploy. Each save is a new version; an SMS template also needs a DLT template id
before it can be sent.
_Avoid_: Email template (alone), copy

**Message route**:
A row saying which Domain event sends which Message template, to whom, on which
channels, and whether the law requires it. An event with no route sends nothing.
_Avoid_: Trigger, notification rule

**Inbox**:
The in-app messages a User has received, each read or unread, shown on their
account with an unread count in the header.
_Avoid_: Notifications, mailbox (the capture mailbox is a different thing)

**Channel choice**:
Whether a User wants messages by email, SMS or both. A message the law requires
goes out whatever the choice; SMS goes only while the SMS Runtime setting is on.
_Avoid_: Notification preferences, opt-out

**Campaign**:
A message a community manager writes once and sends to a Segment, through the
outbox: in-app and by email, never by SMS. Only people with current Consent to
be messaged receive it, and each message carries a Withdrawal link.
_Avoid_: Newsletter, blast, marketing email, announcement (an announcement goes
to a competition's registrants)

**Segment**:
Who a Campaign is for: everyone, or those matching chosen roles, competitions
and cities, always narrowed to people whose Consent to News and updates (or a
guardian's Consent to messages about their child) holds now. A child's message
goes to the guardian who gave that Consent.
_Avoid_: Audience list, mailing list, target group

**Withdrawal link**:
The link in every Campaign message that, after the person confirms, records a
Withdrawal of the Consent the message was sent on. Opening it changes nothing.
_Avoid_: Unsubscribe link, opt-out link

## Events and background work

**Domain event**:
A record that something meaningful happened on the platform, such as a User
signing up, saved in the same step as the change it describes and naming what
changed only by id, never by personal details.
_Avoid_: Notification, message, job

**Outbox**:
Where domain events wait for the work that follows them; because an event is
saved with its change, the platform never acts on a change that didn't happen
or forgets one that did.
_Avoid_: Queue, job queue, event bus

**Delivery**:
One domain event on its way to one piece of follow-up work, such as the welcome
email after a sign-up. It is retried with growing waits and ends either
dispatched or failed, and a failed delivery stays visible to staff.
_Avoid_: Job, task, message

**Derivative**:
A copy the platform makes of an uploaded picture or video, such as a
thumbnail, a display copy, or a video's playable copy and its poster:
upright, resized and stripped of location and camera details.
Whoever may see the original may see its derivatives, once its scan passes.
_Avoid_: Rendition, variant, thumbnail (one kind of derivative)

**Media queue**:
The deliveries only worker-media carries out, such as making an image's
derivatives, so heavy picture work never runs on the website or holds up the
other follow-up work.
_Avoid_: Media jobs table, pg-boss queue

**Drain**:
One round of carrying out every delivery that is due: the worker does it all
the time, a preview does it on request, and a Seam 1 test does it in process.
_Avoid_: Flush, process the queue

**Worker**:
The platform's always-on background process, which keeps draining and runs
scheduled jobs. Production and staging each have their own; one shared
preview worker serves every live preview and lets go of a preview once it is
removed.
_Avoid_: Cron, daemon, job runner

**Scheduled job**:
Work the platform does on a timetable rather than in answer to one change,
such as a reminder sweep, a status flip at a deadline or a retention purge.
Previews never run them.
_Avoid_: Cron job, recurring task

**Status job**:
An event held back until one of a published competition's key dates, which
then moves the competition's status on (registration open, then closed, then
school judging) and records the move as done by the system. Editing the date
saves a new one; the old one finds its date has moved and does nothing. Unlike
a Scheduled job, it is tied to one competition and one instant.
_Avoid_: Status cron, status tick

**Reminder**:
A message a set number of hours before one of a competition's deadlines, such
as its submissions closing, to whoever still owes that deadline when the
reminder goes: an adult who entered, a child's guardian, or a school's
coordinators, never someone who has met it. How many hours before is a runtime
setting. Moving the deadline or changing the hours plans it again; the old one
does nothing at its old time, and a cancelled competition's reminders never go.
_Avoid_: Nudge, chaser, notification (that is any message)

**Guard**:
A condition on one move of a competition's status, such as "every enabled
discipline has a published Rubric" before school judging. A Status job makes
the move only while its guards pass.
_Avoid_: Precondition, check, gate

**Refused move**:
A scheduled move a Guard held back: the competition stays where it is, its
competition managers are told once, and the move is tried again after the
events the Guard names. It is resolved when a later attempt makes the move.
_Avoid_: Blocked flip, failed transition

## Judging

**Rubric**:
The criteria judges score one discipline of a competition by, each with its
weight and score range. It is a draft until a competition manager publishes
it; a published one never changes, and a revision is a new version that
replaces it when published.
_Avoid_: Scorecard, marking scheme

**Judging guide**:
What a coordinator of a registered institution reads before their school
round: FOA's judging framework and the published Rubric of each discipline.
_Avoid_: Judging kit, rules

**Conduct certification**:
A coordinator's statement, made once per Institution registration, that the
competition was run in their school according to FOA's guidelines. The school
round can't be finalised without it.
_Avoid_: Conduct declaration, sign-off (the participation declaration is the
institution's consent to take part)

**School round**:
The first Round on the institution route: one per Institution registration
with a confirmed student, opened when its competition enters school judging.
The coordinator records the Panel, picks the Shortlist and finalises it.
_Avoid_: School judging (the competition's status), first round

**Category**:
One discipline for one age group of a competition, such as Drawing for
Group A. Entries are shortlisted and placed within their Category.
_Avoid_: Section, class

**Panel**:
The people who judged a School round, each with their full name and role.
_Avoid_: Jury (FOA's judges), judges (alone)

**Shortlist**:
The entries a school picks, per Category, to go on to FOA judging, up to the
competition's shortlist size. It is a draft until the School round is
finalised. Under the all-participants scope, finalising makes each Entry
school-shortlisted or not shortlisted. Under shortlist-only scope, the
coordinator creates an Entry already school-shortlisted for each pick;
students not picked have no Entry.
_Avoid_: Selection, finalists

**School position**:
A place (1st, 2nd, 3rd...) a school gives a shortlisted Entry in its
Category, up to the competition's number of positions. Optional.
_Avoid_: Rank, prize

**Judging attestation**:
The coordinator's statement, given when finalising, that the Shortlist and
School positions are the Panel's fair judgement against FOA's Rubric.
_Avoid_: Judging certificate, sign-off

## Registration

**Institution registration**:
An institution signing up for one competition, made once by one of its
coordinators or its authorised person while the competition's registration is
open and the institution is verified. Its students are enrolled against it.
_Avoid_: Entry, enrolment (that is a student's), sign-up

**Registration reference**:
The code an institution registration gets, the competition's code, `I` and
five random symbols (PAWS27-I-Q2W9R), which the institution and FOA quote.
_Avoid_: Registration number (that is a participant's), Institution ID

**Registration window**:
Whether a competition takes registrations right now: not open yet, open or
closed. The competition's status says when it opened; its closing instant
closes it even if a Status job runs late.
_Avoid_: Registration period, deadline

**Participant profile**:
One person who takes part, as whoever keeps their details knows them. For now
a student an institution keeps: one per child per institution, recognised
again by their name and date of birth, or the institution's roll number.
Adults keep their own later, and guardians a child's.
_Avoid_: Student record, participant (for the stored details)

**Enrolment**:
A coordinator adding a student to their institution's registration for a
competition while its Registration window is open. It gives the student a
participant's registration in the age group their date of birth puts them in
on the competition's cut-off date. Withdrawing ends it; enrolling again makes
a new one.
_Avoid_: Entry, sign-up, registering a student

**Student import**:
Enrolling many students at once from a CSV file in the template's columns.
Every row is held to the rules of an Enrolment; good rows are enrolled, and
the rest come back in a report of rows to fix, which the coordinator corrects
and uploads again. Nothing of the file is kept.
_Avoid_: Bulk upload, batch enrolment, import job

## Entries

**Entry**:
The work a participant submits for a competition registration; a registration
has at most one. On the School route the student's coordinator submits it.

**Entry ID**
The reference assigned to an entry when its first upload is confirmed (including a shortlisted entry created by the coordinator during the School round), or its first typed essay is saved, such as `NEIGH27-E-7K3QZ9`.

**Live file**
The entry’s current work (an image, a video, or an essay typed or as a PDF) after it passes its safety and processing checks. A typed essay has none to pass and is live as soon as it is saved.

**Pending replacement**
A new upload for a submitted entry. The live file stays in place until the new upload passes its checks.

**Digital submission scope**:
Which of a competition's school-route participants send their work to FOA as
a digital upload: all of them (the default), or only the entries on each
school's shortlist. Under shortlist-only scope, the coordinator creates
those entries during the School round. Each goes to FOA once both its upload
passes the checks and the round is finalised; this scope never applies to
individual registrations.
_Avoid_: Submission mode, upload policy

**Submission roster**:
A coordinator's list of every student of one Institution registration, with
each student's Entry status and what the coordinator can do for them next.
_Avoid_: Entries dashboard, student list

## FOA judging

**Judging round**:
A competition’s FOA round, at a city/district, state, national or global level, with its own pinned published rubrics, award scheme, and physical-artwork rule.

**Judge onboarding**:
A round-scoped judge’s acceptance of the code of conduct and confidentiality terms, followed by a conflict declaration; all are required before an assignment or a blind entry read.

**Round entry source**:
The rule for selecting candidates for a Judging round: FOA-verified entries or the advancing Round outcomes of one source round in the same competition once it locks. Links cannot form a loop; they need not visit every judging level.

**Chained judging levels**:
Judging rounds linked by their Round entry sources. Each round has independent pins, awards, judges, physical requirements and scores. A round with no non-cancelled successor is a terminal round.

**Round pool**:
The FOA-verified entries a round admits from its Round entry source. A physical round additionally needs a physically ready artwork. Only a pooled entry may be assigned.

**Assignment**:
One pooled entry allocated to one ready judge, provided their declared and live conflicts do not apply.

**Blind entry view**:
The assigned Entry’s code, discipline, category, age group and derived work, without personal details or the Entry's title, description or statement.

**Score sheet**:
One assigned judge’s scores against the round’s pinned Rubric and optional comment. A sheet is complete when every criterion has a score. Changes save incrementally; clearing a score makes the sheet incomplete again.

**Round ranking**:
A ranking of entries within one discipline and age group of a Judging round,
by the exact average of judges' complete weighted Score sheets. Ties use
criterion means, median sheet total, then shared rank. A locked round's rank
and score are stored as an immutable snapshot.

**Round lock**:
The closing of an open Judging round when every assigned Score sheet is
complete and eligible, or a Staff admin records a reason for overriding
that requirement. No scores, assignments or round settings can be changed
thereafter.

**Round outcome**:
A Competition manager's recognition of a ranked entry in a locked Judging
round: winner, runner-up, finalist, special mention or none. An award
position belongs to the round's award scheme; suitability for auction is a
separate flag and never a substitute for auction consent. Winners,
runners-up and finalists can advance to a subsequent Judging round.

**Results release**:
An immutable recognition snapshot from an explicitly selected locked final
Judging round, including prize and delivery instructions. A Competition manager
prepares it for a different authorised Staff member to approve with Step-up.
Only the worker publishes the approved release at or after its scheduled instant.

**Public results**:
The recognition from a published Results release for which the participant's or
guardian's current public-display consent allows a public credit. No assessment,
entry code or original work is published here; withdrawn credit disappears on
subsequent reads.

**Certificate**:
A numbered recognition of a participant's eligible participation, school merit,
finalist status, winning or runner-up award (or later volunteer service).
Its validity begins at issuance, independently of PDF readiness. The private PDF
carries a QR linking to public verification; its number is never a credential.
A revoked or replaced number never becomes valid again.

**Certificate number**:
A unique random `FOA-C-{YY}-{10}` code, dated by India's calendar at issue time.
Anyone may check its validity; a PDF download needs the participant's or a
verified linked guardian's own session.

**Certificate correction**:
A Competition manager's reasoned revocation or reissue. Reissue corrects the
printed recipient name while preserving the earned recognition; it creates
a new Certificate number and permanently ends the old one.

**Institution certificate ZIP**:
A short-lived private archive of the current issued, rendered certificates
for the pupils of one Institution registration. The worker creates it,
and the coordinator or authorised person gets a Signed URL only while their
institution and the entire archive manifest are still eligible.

**Stamped copy**:
A metadata-free private File derivative carrying the approved Friends of Animals
mark, made from the safe resized copy of an entry image or a rasterized issued
Certificate PDF. Gallery and social variants require their own live consent to
be delivered. A Certificate share image is downloadable by its own holder or
verified linked guardian; it is not a public gallery asset.

**Gallery item**:
A content manager's reviewed presentation of a finished Entry. Its opaque public
ID names the presentation, not the participant or private file. Publication binds
the current public-display consent grant and live image; a withdrawal unpublishes
it and a moderator may hide it. Restoring it never publishes without fresh review.
_Avoid_: Entry, original artwork, public file asset

**Public credit**:
The participant's name and, for a minor, only separately opted-in school and city,
computed from current consent. A minor's name defaults to first name plus surname
initial. It is derived, never copied into the Gallery item or social export queue.
_Avoid_: Full profile, artist identity snapshot

**Gallery purge**:
A durable request to evict the gallery's public routes when a credit is withdrawn
or an item leaves publication. The item's live eligibility is checked even before
that request runs; the private Stamped copy is not itself a cacheable public object.

## Physical artwork

**Physical artwork**:
The original work that FOA asks a verified Entry's sender to courier after digital verification. Each has one Artwork ID (for example `ORIG27-A-4P5X9R`), dispatch deadline, and a custody status independent of the Entry's digital status.

**Sender**:
The school coordinators for an institution registration or the participant or verified guardian for an individual registration. The sender records the courier name and tracking number; FOA records receipt.

**Dispatch**:
The sender's manual record that the parcel has been sent. FOA may receive a parcel even without recorded dispatch.

**Condition photo**:
A private File bound to one Physical artwork, taken by an FOA verifier to record front, back and detail condition; delivered only to authorised staff through a Signed URL after a clean Scan.

**Discrepancy**:
An open inspection record that identifies a mismatch or missing evidence. Resolving it returns the work to received, not verified; it must pass inspection again.

**Custody event**:
An append-only record of a physical artwork's receipt, move, exhibition, storage, retention or return. Its current status is independent of the Entry.

**Physically ready for judging**:
A verified original still held by FOA (verified, on exhibition or retained). An absent, received, discrepant or returned original cannot enter a physical Round.

**Return window**:
The period beginning when Results are actually published, not when the competition is scheduled. Adult creators, verified guardians and the institution's coordinator may request the original back during it. Unrequested verified work is then retained.

## Auctions

**Auction lot**:
One original Physical artwork reserved by FOA for an auction, with current
auction Consent, a public story, starting and reserve prices in INR, an opening
time, a closing time, and a Lot code. A minor's public credit is at most their
first name and last initial.

**Auction manager**:
The Staff role that creates, schedules or cancels Auction lots.

**Lot code**:
A public code identifying one Auction lot, such as `LOT-27-8H3TZ`. It is
independent of the private Artwork ID.

**Auction reservation**:
An unfinished Auction lot’s exclusive hold on its original. It prevents another
lot and conflicting custody moves without changing the physical status.
Cancelling, settling unsold or relisting releases the original; selling it
keeps that hold permanently.

**Bid**:
A signed-in adult Buyer's binding offer of an exact INR amount on an open
Auction lot. The first bid is at least its starting price; every later bid
raises the highest accepted bid by at least the minimum increment.
_Avoid_: Cart, order, pledge

**Buyer**:
An adult User who bids on an Auction lot. A Buyer whose bid meets reserve
and wins the lot is offered payment; a bid itself is not a payment.
_Avoid_: Donor, bidder profile

**Anti-sniping window**:
The final interval of an open Auction lot in which an accepted Bid extends
its closing time by the interval's full duration, giving other Buyers a
chance to respond.
_Avoid_: Grace period, overtime

**Payment offer**:
A winning Buyer’s exclusive opportunity to pay their accepted Bid before an
exact deadline. On expiry the next qualifying distinct Buyer receives an offer;
when candidates run out, the original can be relisted as a new Auction lot.
Neither a Bid nor an expired offer transfers the artwork.

**Auction sale**:
The accepted full captured INR payment for one live Payment offer. The sale’s
pinned proceeds policy splits exact paise into FOA income and creator shares
payable. The original remains exclusively committed to the Buyer.

**Auction delivery**:
The fulfilment of an Auction sale, from the Buyer’s private delivery address
through dispatch and delivery, to confirmed receipt.

## Files

**File**:
Something a User uploaded, such as a photo or a scanned form, kept privately
and only ever opened through a signed URL. The platform records what it is for,
what the uploader declared and how far it has got, never the uploader's own
file name.
_Avoid_: Attachment, asset, document, upload (for the stored thing)

**Purpose**:
What a File was uploaded for, which sets the types and size it may have and
where it may be uploaded at all; each module that takes uploads has its own.
_Avoid_: Category, kind, file type

**Signed URL**:
A short-lived link that lets one browser put or fetch one File directly in
storage; it is only issued to someone allowed to have it, and stops working
after a few minutes.
_Avoid_: Public URL, download link, presigned link

**Scan**:
The malware check every File passes before anyone but its uploader may open it.
_Avoid_: Virus check, antivirus

**Quarantined**:
Said of a File the Scan flagged: it is never delivered again, to anyone, its
uploader and staff included.
_Avoid_: Blocked, infected, deleted

**Storage prefix**:
The folder an environment keeps its Files under in the shared non-production
storage, such as `staging/` or `pr-12/`; production has its own storage and
none. A preview's prefix is emptied when its database is dropped.
_Avoid_: Bucket, namespace, path

## Running the platform

**Runtime setting**:
A value that changes how the platform works, such as how long Staff stay signed
in or whether sign-in codes go by text message, which a super admin changes on
the settings screen without a release. Each has a default that applies until a
value is stored, and every change needs Step-up and goes in the Audit log.
_Avoid_: Config, feature flag, environment variable

**Off-site copy**:
The nightly copy of production's Files from Cloudflare R2 to a Backblaze B2
bucket, because R2 keeps no old versions. A copy outlives its File by the
retention window, so a File deleted by mistake can still be restored one at a
time.
_Avoid_: Backup (that is the database's pgBackRest backup), sync, mirror

**Retention window**:
How long the off-site copy keeps a File after it has gone from R2 (30 days
unless set), counted from the first night the copy found it gone.
_Avoid_: Grace period, TTL

## NGO directory

**Directory listing**:
An animal-welfare organisation's entry in FOA's directory, or an individual
rescuer's or foster caregiver's own: what it does, where, and how to reach it.
It stays private until FOA verifies it, and the public sees only the contacts
it chose to show, never its address. The listing is the organisation that
representatives and adoption listings belong to.
_Avoid_: NGO profile, organisation page, directory entry

**Organisation representative**:
The Role, scoped to one Directory listing, of a person who keeps it up to date.
The person who registered a listing gets it when FOA first verifies the
listing; a super admin can grant it to others.
_Avoid_: NGO admin, listing owner (after verification)

**Listing document**:
Proof a Directory listing sends for FOA's verification, such as a registration
certificate or an identity proof. It is a File only Staff can open, not even
the person who uploaded it.
_Avoid_: Attachment, KYC document

**Pin-code centre**:
Where the directory search places a pin code: the middle of its post offices,
from India Post's open pin-code directory. A Directory listing is found by
distance from its pin-code centre, never from its address, so distances are
approximate.
_Avoid_: Geocode, listing location

## Adoption

**Adoption listing**:
One animal a Directory listing offers for adoption: who it is, its health
and vaccination notes, the adoption conditions and where it is. It stays a
private draft until a representative publishes it with a photo, and it is
public only while its Directory listing is verified. FOA facilitates; the
listing organisation is responsible for the animal.
_Avoid_: Pet listing, animal profile, adoption post

**Adoptable animal**:
What the public sees of a published Adoption listing on /adopt and its own
page.
_Avoid_: Pet, available animal

**Adoption application**:
An adult's request to adopt one Adoptable animal, with how to reach them and
answers about their home. FOA's Adoption coordinator moves it through review,
contact and an outcome; the listing organisation only reads it, and sees the
applicant's contact once the coordinator puts them in touch.
_Avoid_: Adoption request, enquiry

**Adoption coordinator**:
The FOA staff role that reviews Adoption applications, puts good matches in
touch with the listing organisation and records the outcome. FOA facilitates;
it never takes custody of an animal.
_Avoid_: Adoption manager, adoption officer

**Success story**:
An adopter's own words about how their adopted animal settled in, shared on
/adopt/stories only while they consent, never with their name or contact.
_Avoid_: Testimonial, adoption post

## Engineering

**Seed builder**:
A function that writes one realistic record, such as a Member, to a database
through the clock it is given. Seam 1 tests and the seed command share them.
_Avoid_: Factory, fixture

**Seed data**:
The realistic fake records every preview and local database starts with,
including a super admin and a few Members, built by seed builders that tests
share.
_Avoid_: Fixtures, sample content (sample content is the public site's
placeholder material)

**Seam 1**:
Tests that call the platform's use cases as an Actor would, against a fresh
database with fakes standing in for outside providers.
_Avoid_: Unit tests, integration tests

**Seam 2**:
A few end-to-end journeys per milestone, run in a browser against a pull
request's preview deployment.
_Avoid_: E2E suite, UI tests

## Community and engagement

**Community member**:
A person who has joined the FOA community, including a child whose verified
guardian joined on their behalf. A User may be a Member without being a
Community member.
_Avoid_: Member (on its own), follower

**Member profile**:
A Community member's private display name and optional introduction.

**Engagement ladder**:
FOA's six milestones: Participant, School winner, FOA finalist, Community
member, Volunteer and Ambassador. It is a record of milestones reached,
not a requirement to complete them in order.

**Engagement milestone**:
A rung of the Engagement ladder a person has earned. Competition milestones
are earned per competition; Community member, Volunteer and Ambassador are
earned once in a person's journey. Leaving the community does not undo an
earned milestone.

**Engagement timeline**:
A person's private dated history of their competitions, recognitions,
community life, events and volunteering. A Guardian sees the journey of
each linked child separately from their own.

## Volunteering

**Volunteer**:
A User FOA has vetted and approved to help, who holds the volunteer Role.
Volunteers are not Staff.
_Avoid_: Helper, intern, staff volunteer

**Volunteer application**:
A person's request to volunteer: how they would like to help, when they are
free, and their acceptance of the safeguarding declaration and the code of
conduct. A 14- to 17-year-old's waits for their verified guardian's
approval before a community manager approves or declines it.
_Avoid_: Signup, volunteer form, registration

## Taking part

**School route**:
How a student takes part through their school: a coordinator enrols them in
the Institution registration, the institution pays, and the coordinator
submits their work.
_Avoid_: Route A, institution route

**Individual route**:
How someone takes part in a competition on their own, instead of being
entered by their school: an adult registers and pays for themselves; a minor
takes part with a guardian, who registers or confirms them and pays. A
minor's registration is held until they have a verified guardian who has given
participation consent on the competition's attached document version.
_Avoid_: Route B, self-registration, direct entry

**Guardian request**:
A teen of 13 to 17 with no guardian on the platform names their parent or
guardian when they register, and FOA emails that person a link. Accepting it,
signed in as a verified guardian with that address, makes them the teen's
guardian. If the guardian already manages a matching profile, they invite
the teen to that profile. The teen confirms the link from the invited
verified account. Each held registration is released when the guardian gives
participation consent for that competition.
_Avoid_: Guardian invitation (a guardian inviting a teen to an own login),
consent request

**Participant ID**:
The code that names one person who takes part in competitions, such as
FOA-P-277K3M9Q. It identifies them to FOA and is never a way to sign in.
_Avoid_: Participant number, registration number (that names one
registration)

### Event and event campaign

A scheduled FOA activity people attend. An event campaign is a community activity, not a Campaign message sent to a Segment. An Organiser (content or community manager) publishes its details and registration window.

### Event registration

A private place on an Event, for the attendee (their own account or a distinct linked participant profile). Registered and Checked in hold a place. Waitlisted waits in booking order; a freed place promotes the next person automatically. Cancelled and No-show are terminal. A Check-in is an organiser's confirmation of actual attendance, which appears on the attendee's Engagement timeline.
