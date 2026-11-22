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

## Operations

**Setting**:
A switch or value staff can change on a running site without a deploy, such
as whether sign-in codes may go by SMS.
_Avoid_: Feature flag, config, environment variable

## Messages

**Capture mailbox**:
Where every message the platform would send outside production is kept instead,
so staff and automated journeys can read it and no real person receives it.
_Avoid_: Dev inbox, outbox (the outbox is a different thing)

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
