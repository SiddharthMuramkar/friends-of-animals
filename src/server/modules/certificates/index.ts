import {
  buildInstitutionCertificateArchive,
  expireInstitutionCertificateArchive,
  getInstitutionCertificateArchive,
  getInstitutionCertificateArchiveLink,
  requestInstitutionCertificateArchive,
} from "./archive";
import { revokeCertificate, reissueCertificate } from "./correction";
import type { UseCaseContext } from "../../use-cases";
import { issueCertificates, type IssueInput } from "./issue";
import { renderCertificate } from "./render";
import { requestCertificateShare, getCertificateShareUrl } from "./share";
import {
  getCertificateDownloadUrl,
  listCertificates,
  listCertificateCompetitions,
  listMyCertificates,
  retryCertificateRender,
  verifyCertificate,
} from "./read";
export const certificateUseCases = (ctx: UseCaseContext) => ({
  revokeCertificate: (input: Parameters<typeof revokeCertificate>[1]) =>
    revokeCertificate(ctx, input),
  reissueCertificate: (input: Parameters<typeof reissueCertificate>[1]) =>
    reissueCertificate(ctx, input),
  getInstitutionCertificateArchive: (
    input: Parameters<typeof getInstitutionCertificateArchive>[1]
  ) => getInstitutionCertificateArchive(ctx, input),
  requestInstitutionCertificateArchive: (
    input: Parameters<typeof requestInstitutionCertificateArchive>[1]
  ) => requestInstitutionCertificateArchive(ctx, input),
  getInstitutionCertificateArchiveLink: (
    input: Parameters<typeof getInstitutionCertificateArchiveLink>[1]
  ) => getInstitutionCertificateArchiveLink(ctx, input),
  buildInstitutionCertificateArchive: (input: { archiveId: string }) =>
    buildInstitutionCertificateArchive(ctx, input),
  expireInstitutionCertificateArchive: (input: { archiveId: string }) =>
    expireInstitutionCertificateArchive(ctx, input),
  issueCertificates: (input: IssueInput) => issueCertificates(ctx, input),
  renderCertificate: (input: { certificateId: string }) =>
    renderCertificate(ctx, input),
  listCertificateCompetitions: () => listCertificateCompetitions(ctx),
  listCertificates: (input: Parameters<typeof listCertificates>[1]) =>
    listCertificates(ctx, input),
  retryCertificateRender: (input: { certificateId: string }) =>
    retryCertificateRender(ctx, input),
  listMyCertificates: () => listMyCertificates(ctx),
  requestCertificateShare: (input: { certificateId: string }) =>
    requestCertificateShare(ctx, input),
  getCertificateShareUrl: (input: { certificateId: string }) =>
    getCertificateShareUrl(ctx, input),
  getCertificateDownloadUrl: (input: { certificateId: string }) =>
    getCertificateDownloadUrl(ctx, input),
  verifyCertificate: (input: { number: string }) =>
    verifyCertificate(ctx, input),
});
