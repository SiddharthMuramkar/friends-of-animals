# Glossary

Words this project uses. Agents should use these words and not swap in near-synonyms.

Two layers are easy to mix up. The **starter** is the website in `app/` today. The **platform spec** is the plan in `specifications/`. Most spec words have no tables or pages yet.

## The organisation

| Term | Meaning |
| --- | --- |
| Friends of Animals (FOA) | The non-profit this repo is for. The short form in the spec is FOA. The site name in code is the `SITE` object in `app/lib/site.ts`. |
| Registered logo | The FOA mark. The vector master is `public/brand/foa-logo.svg`. It was traced from a screenshot and must not be redrawn, recoloured, or rearranged. Derived files come from `npm run brand:assets`. Two uses are still waiting on FOA (issue #17): tiles with no wordmark, and a single-colour version. |

## How the work is tracked

| Term | Meaning |
| --- | --- |
| Wayfinder map | GitHub issue #1, labelled `wayfinder:map`. It is the index of the platform effort: notes, decisions so far, and what is not specified yet. |
| Wayfinder ticket | A child issue of the map. The label says what kind of work it is: `wayfinder:research` (find out), `wayfinder:grilling` (the owner must decide), `wayfinder:task` (build something), `wayfinder:prototype` (a throwaway probe; the map currently says not to build throwaway UI). |
| Triage label | One of `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`. A wayfinder label and a triage label answer different questions and can both be present. |
| Ready for an agent | The issue is labelled `ready-for-agent`: specified well enough to carry out with no further questions. |
| Ready for a human | The issue is labelled `ready-for-human`: a person has to decide, sign, or use an account the agent does not have. |

## The starter (what the code does today)

| Term | Meaning |
| --- | --- |
| Animal | A row in the `animals` table (`app/db/schema.ts`): name, species, breed, age in months, sex, status, description, and an optional photo. This is the sample feature, not the spec's adoption module. |
| Animal status | `available`, `pending`, or `adopted` (`AnimalStatus` in `app/db/enums.ts`). `pending` means an adoption is in progress. `adopted` means the animal already has a home. The public list can filter on these. |
| User role (starter) | `volunteer`, `staff`, or `admin` on the `users` table. Nothing checks this yet. There is no login page. These three words are not the spec's role list. |
| Photo key | `photoKey` on an animal: the storage key of the image, not a web address. The URL is built later by the storage driver. |
| Storage driver | `STORAGE_DRIVER` in the environment. `local` writes files under `UPLOAD_DIR` and serves them at `/files/*`. `blob` uses Vercel Blob. Code goes through `app/lib/storage`, not the disk directly. |
| Admin | The pages at `/admin/animals` and `/admin/animals/new`. They are unprotected: anyone who can open the site can add an animal. Marked `TODO(auth)` in those routes. |

## The platform spec (written, mostly not built)

The spec's own names are canonical. This list is the ones people reach for first. The full set is in `specifications/SPEC.md`.

| Term | Meaning |
| --- | --- |
| Platform | The product described in `specifications/`: competitions for children and young people, then community, fundraising, and adoption facilitation. Milestones M0–M5 are the pilot. M6–M8 come after. |
| Milestone | A named slice of the build, M0 through M8, in `specifications/parts/14-milestones.md`. M0 is foundations. None of M0–M8 is built in `app/` yet. |
| Competition | A FOA creative contest (drawing, painting, art, craft, essay, photography, videography). Schools and individuals register, work is judged, certificates are issued. |
| Discipline | One of those contest types: `DRAWING`, `PAINTING`, `ART`, `CRAFT`, `ESSAY`, `PHOTOGRAPHY`, `VIDEOGRAPHY`. |
| Institution | A school, college, university, or other organisation that registers students. Not the same thing as FOA itself. |
| Participant | A young person who enters. A minor may have no login of their own; a guardian acts for them. |
| Guardian | The parent or other adult responsible for a minor participant. |
| Registration | One participant's place in one competition, with a registration number. Distinct from creating a website user account. |
| Entry | One piece of submitted work, with an entry code and its own status (draft, submitted, shortlisted, and so on). |
| Judging | Scoring of entries. The spec has a school round and then an FOA round. Judges see anonymised entries. |
| Certificate | The document a registrant receives, with a number that can be checked. Not built. |
| Donation | Money given to FOA. Separate from competition fees. Not built. |
| Adoption facilitation | Helping people adopt animals that other organisations list. Milestone M7. The spec treats FOA as a facilitator, not necessarily as a shelter that keeps the animals. The starter's animal list is only a sample of this idea, and its data model is not the spec's model. |

## Do not confuse these

| Say | Do not say it when you mean |
| --- | --- |
| Animal status (`available` / `pending` / `adopted`) | An entry status or a registration status from the spec. |
| User role (starter): volunteer, staff, admin | A spec role such as a competition manager, judge, or finance approver. |
| Wayfinder ticket | A triage label. An issue can have both. |
| The starter | The platform. The starter is the small site in `app/`. The platform is the spec. |
