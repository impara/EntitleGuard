import { runAudit } from "@/lib/engine";
import type { AuditInput, AuditResult, ProgressUpdate } from "@/lib/engine";

export type WorkerRequest = { type: "run"; input: AuditInput };
export type WorkerResponse =
  | { type: "progress"; update: ProgressUpdate }
  | { type: "result"; result: AuditResult }
  | { type: "error"; message: string };

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  if (event.data.type !== "run") return;
  try {
    const result = runAudit(event.data.input, (update) => {
      const msg: WorkerResponse = { type: "progress", update };
      self.postMessage(msg);
    });
    const msg: WorkerResponse = { type: "result", result };
    self.postMessage(msg);
  } catch (error) {
    const msg: WorkerResponse = {
      type: "error",
      message: error instanceof Error ? error.message : "Audit failed unexpectedly.",
    };
    self.postMessage(msg);
  }
};
