export type Severity = "critical" | "major" | "minor";

export interface AuditEvent {
  run_id: string;
  event: string;
  timestamp: string;
  data: Record<string, unknown>;
}

/** run_failed event payload */
export interface RunFailedData {
  error: string;
  stage?: string;
  error_code?: string;
  retryable?: boolean;
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

export interface BatchProgress {
  stage: "fix" | "apply" | "verify";
  current: number;
  total: number;
  finding_id: string;
}

export interface VerifyResult {
  finding_id: string;
  passed: boolean;
  details: string;
}

/** API response for POST /runs/start */
export interface StartRunResponse {
  run_id: string;
}

/** API error response (4xx, 5xx) */
export interface ApiErrorResponse {
  detail: string;
}

export interface Project {
  id: string;
  name: string;
  default_url: string;
  baseline_run_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface RunListItem {
  run_id: string;
  project_id: string | null;
  url: string;
  status: string;
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
  score?: number;
  total_findings: number;
  summary?: { total: number; fixed: number; verified: number } | null;
}

export interface RegressionSummary {
  project_id: string;
  baseline_run_id: string;
  run_id: string;
  new_issues: number;
  resolved_issues: number;
  severity_of_new: {
    critical: number;
    major: number;
    minor: number;
  };
}
