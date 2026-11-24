export type BreachDraft = {
  title: string;
  awareAt: string;
  severity: string;
  affectedCount: string;
  personalDataInvolved: boolean;
  minorsAffected: boolean;
  impact: string;
};

export type BreachDetailsState = {
  attempt: number;
  draft: BreachDraft;
  invalidFields: readonly string[];
  awareInFuture?: boolean;
} | null;
