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
A copy the platform makes of an uploaded picture, such as a thumbnail or a
display copy: upright, resized and stripped of location and camera details.
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
