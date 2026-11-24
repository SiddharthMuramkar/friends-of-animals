// The institution-submissions module (#87): the school route's side of
// submitting. A coordinator (or the institution's authorised person) sees
// every student of one institution registration with their entry's status
// and what to do next, and certifies, once, that the competition was run in
// the school according to FOA's guidelines. The uploads themselves go
// through the entries module's own use cases (startEntryUpload,
// completeEntryUpload), which take a coordinator for their institution's
// students. Finalising the school round (#89) checks the certification with
// ./conduct.ts. Its use cases join `as(actor)` through
// `institutionSubmissionsUseCases`.

import type { UseCaseContext } from "../../use-cases";
import { certifyConduct } from "./use-cases/certify-conduct";
import { getConductCertification } from "./use-cases/get-conduct-certification";

export type { CertifyConductResult } from "./use-cases/certify-conduct";
export type {
  ConductCertificationView,
  GetConductCertificationResult,
} from "./use-cases/get-conduct-certification";

type RegistrationRef = { institutionId: string; reference: string };

export const institutionSubmissionsUseCases = (ctx: UseCaseContext) => ({
  certifyConduct: (input: RegistrationRef) => certifyConduct(ctx, input),
  getConductCertification: (input: RegistrationRef) =>
    getConductCertification(ctx, input),
});
