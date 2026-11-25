import type { CertificateRow } from "../../db/schema";
import { indianDateAt } from "../registration/domain/calendar-date";
import { verifyPathFor } from "./domain/number";
import type { CertificateType } from "./domain/status";
export type CertificateDocument = {
  number: string;
  type: CertificateType;
  awardPosition: number | null;
  awardLabel: string | null;
  recipientName: string;
  competition: { code: string; name: string } | null;
  issuedOn: { year: number; month: number; day: number };
  verifyUrl: string;
  signatories: { name: string; title: string; sample: boolean }[];
};
export function certificateDocument(
  row: CertificateRow,
  competition: CertificateDocument["competition"],
  baseUrl: string
): CertificateDocument {
  return {
    number: row.number,
    type: row.type,
    awardPosition: row.awardPosition,
    awardLabel: row.awardLabel,
    recipientName: row.nameSnapshot,
    competition,
    issuedOn: indianDateAt(row.issuedAt),
    verifyUrl: new URL(verifyPathFor(row.number), baseUrl).href,
    signatories: [
      { name: "Sample signatory", title: "Friends of Animals", sample: true },
    ],
  };
}
