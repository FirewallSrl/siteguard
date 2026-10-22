import { inngest } from "./client";
import { runSiteScan } from "../scanner/run-scan";
import { executeAction } from "../actions/execute";

export const scanSiteFn = inngest.createFunction(
  {
    id: "scan-site",
    retries: 1,
    triggers: [{ event: "site/scan.requested" }],
  },
  async ({ event }) => {
    const { siteId, scanId, scope } = event.data as {
      siteId: string;
      scanId: string;
      scope?: string;
    };
    return runSiteScan(siteId, scanId, scope ?? "full");
  },
);

export const applyActionFn = inngest.createFunction(
  {
    id: "apply-action",
    retries: 1,
    triggers: [{ event: "action/apply.requested" }],
  },
  async ({ event }) => {
    const { actionId } = event.data as { actionId: string };
    return executeAction(actionId);
  },
);

export const inngestFunctions = [scanSiteFn, applyActionFn];
