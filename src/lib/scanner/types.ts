import type { FindingType, ProposedPlan, Severity } from "../types";

export type ScanFinding = {
  type: FindingType | string;
  severity: Severity | string;
  title: string;
  description: string;
  evidence: Record<string, unknown>;
  proposedPlan: ProposedPlan;
};
