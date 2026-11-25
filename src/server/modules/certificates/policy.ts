import {
  owner,
  role,
  signedIn,
  stepUp,
  system,
  type Policy,
} from "../../access/domain/policy";
const staff = role("competition_manager", "staff_admin", "super_admin");
export const CERTIFICATES_POLICY = {
  "certificates.correct": stepUp(role("competition_manager")),
  "certificates.institution_archive": role(
    "institution_coordinator",
    "institution_admin"
  ),
  "certificates.archive_jobs": system("worker"),
  "certificates.issue": system("worker", "seed"),
  "certificates.render": system("worker", "seed"),
  "certificates.list": staff,
  "certificates.retry_render": staff,
  "certificates.list_mine": signedIn,
  "certificate.download": owner,
  "certificate.request_share": owner,
  "certificate.download_share": owner,
  "certificates.verify": () => ({ allowed: true, role: null }),
} satisfies Policy<string>;
