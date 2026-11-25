import type { UseCaseContext } from "../../use-cases";
import { issueCertificates, type IssueInput } from "./issue";
import { renderCertificate } from "./render";
import {
  getCertificateDownloadUrl,
  listCertificates,
  listCertificateCompetitions,
  listMyCertificates,
  retryCertificateRender,
  verifyCertificate,
} from "./read";
export const certificateUseCases = (ctx: UseCaseContext) => ({
  issueCertificates: (input: IssueInput) => issueCertificates(ctx, input),
  renderCertificate: (input: { certificateId: string }) =>
    renderCertificate(ctx, input),
  listCertificateCompetitions: () => listCertificateCompetitions(ctx),
  listCertificates: (input: Parameters<typeof listCertificates>[1]) =>
    listCertificates(ctx, input),
  retryCertificateRender: (input: { certificateId: string }) =>
    retryCertificateRender(ctx, input),
  listMyCertificates: () => listMyCertificates(ctx),
  getCertificateDownloadUrl: (input: { certificateId: string }) =>
    getCertificateDownloadUrl(ctx, input),
  verifyCertificate: (input: { number: string }) =>
    verifyCertificate(ctx, input),
});
