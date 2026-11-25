import {
  owner,
  role,
  signedIn,
  system,
  type Policy,
} from "../../access/domain/policy";
const staff = role("competition_manager", "staff_admin", "super_admin");
export const CERTIFICATES_POLICY = {
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
