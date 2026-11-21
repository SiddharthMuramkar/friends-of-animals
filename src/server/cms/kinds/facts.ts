// FOA's display facts as a CMS document (#111), kind `facts`, key
// `site_facts`: how to reach FOA (email, phone, address, social profiles)
// and the grievance officer's name and email. Content managers keep them
// up to date. Tax and registration facts (legal name, registration, PAN)
// drive receipts, so they are runtime settings a super admin changes, not
// part of this document. An empty field shows as "To be confirmed".
//
// Loads under plain Node (seed): relative imports only.

import { z } from "zod";

import { safeHref } from "../../rich-text/href";
import { defineKind, plainText, uniqueKeys } from "./fields";

const email = () =>
  z
    .string()
    .trim()
    .pipe(
      z.union([z.literal(""), z.email({ error: "write a full email address" })])
    );

const phone = () =>
  plainText(30, { allowEmpty: true }).refine(
    (value) => value === "" || /^\+?[0-9][0-9 ()-]{5,}$/.test(value),
    { error: "write digits, spaces and an optional leading +" }
  );

const profileUrl = () =>
  z
    .string()
    .trim()
    .refine((url) => url.startsWith("https://") && safeHref(url) === url, {
      error: "write the profile's full https:// address",
    });

const siteFactsSchema = z.strictObject({
  email: email(),
  phone: phone(),
  address: plainText(300, { allowEmpty: true }),
  socials: z
    .array(profileUrl())
    .max(8)
    .superRefine((urls, ctx) => uniqueKeys(urls, ctx)),
  grievanceOfficer: z.strictObject({
    name: plainText(120, { allowEmpty: true }),
    email: email(),
  }),
});

export type SiteFactsBody = z.output<typeof siteFactsSchema>;

/** Nothing confirmed yet: every fact is a placeholder until FOA enters it. */
const SITE_FACTS_SEED: SiteFactsBody = {
  email: "",
  phone: "",
  address: "",
  socials: [],
  grievanceOfficer: { name: "", email: "" },
};

export const factsKind = defineKind(siteFactsSchema, SITE_FACTS_SEED);
