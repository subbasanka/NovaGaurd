export type Severity = "critical" | "major" | "minor";

export interface AuditEvent {
  run_id: string;
  event: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface Finding {
  id: string;
  title: string;
  severity: Severity;
  wcag_refs: string[];
  evidence: string;
  recommendation: string;
}

export interface Diff {
  finding_id: string;
  patch?: string;
  before_html: string;
  after_html: string;
  rationale: string;
  after_screenshot?: string;  // populated from apply_done event
}

export type RunStatus =
  | "idle"
  | "crawling"
  | "analyzing"
  | "fixing"
  | "awaiting_approval"
  | "applying"
  | "verifying"
  | "complete"
  | "failed";
