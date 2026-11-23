import { role, stepUp, type Policy } from "../../access/domain/policy";
import { COORDINATORS_POLICY } from "../institutions/coordinators/policy";

const coordinators = COORDINATORS_POLICY["institution.coordinate"];
const staff = role("staff_admin", "super_admin");

export const CONSENT_FORMS_POLICY = {
  "consent_form.submit": coordinators,
  "consent_form.withdraw": coordinators,
  "consent_form.declare": coordinators,
  "consent_form.read": staff,
  "consent_form.review": stepUp(staff),
} satisfies Policy<string>;
