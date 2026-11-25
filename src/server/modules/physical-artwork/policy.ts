import { owner, role, signedIn, type Policy } from "../../access/domain/policy";
import { COORDINATORS_POLICY } from "../institutions/coordinators/policy";

export const PHYSICAL_ARTWORK_POLICY = {
  "artwork.request": role("competition_manager"),
  "artwork.receive": role("staff_admin", "competition_manager", "foa_verifier"),
  "artwork.read": role("staff_admin", "competition_manager", "foa_verifier"),
  "artwork.list_mine": signedIn,
  "artwork.dispatch": owner,
  "artwork.dispatch_for_student": COORDINATORS_POLICY["institution.coordinate"],
} satisfies Policy<string>;
