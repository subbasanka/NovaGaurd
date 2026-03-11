"""Executive summary report generation via Nova 2 Lite."""

import json
import logging
from datetime import datetime, timezone

import boto3

from config import get_settings

logger = logging.getLogger(__name__)

REPORT_PROMPT = """You are an accessibility compliance report writer. Given audit findings and fix results,
generate a concise executive summary in HTML format.

The report should include:
1. A header with "NovaGuard Accessibility Audit Report" and the audit date
2. An overall accessibility score out of 100
3. A summary table of all findings with columns: ID, Title, Severity, WCAG Refs, Status (Fixed/Pending)
4. For each fixed finding: a brief description of what was changed
5. A recommendations section for unfixed findings

Use clean, semantic HTML with inline styles for readability. Use a professional color scheme.
Return ONLY the HTML — no markdown fences, no explanation."""


def generate_report(run_state: dict) -> str:
    """Generate an HTML executive summary report.

    Tries Nova 2 Lite first; falls back to a template-based report on failure.
    """
    findings = run_state.get("findings", [])
    diffs = run_state.get("diffs", [])
    events = run_state.get("events", [])

    # Gather verify results
    verify_map: dict[str, dict] = {}
    for e in events:
        if e["event"] == "verify_done":
            verify_map[e["data"]["finding_id"]] = {
                "passed": e["data"].get("passed", False),
                "details": e["data"].get("details", ""),
            }

    # Compute score
    score = 100
    for f in findings:
        sev = f.get("severity", "minor")
        if sev == "critical":
            score -= 20
        elif sev == "major":
            score -= 10
        else:
            score -= 5
    score = max(0, score)

    diff_ids = {d["finding_id"] for d in diffs}
    fixed_ids = {fid for fid, v in verify_map.items() if v["passed"]}

    # Build context for Nova
    context = {
        "url": run_state.get("url", ""),
        "score": score,
        "findings": [
            {
                "id": f["id"],
                "title": f["title"],
                "severity": f["severity"],
                "wcag_refs": f.get("wcag_refs", []),
                "status": "verified" if f["id"] in fixed_ids
                          else "applied" if f["id"] in diff_ids
                          else "pending",
                "evidence": f.get("evidence", ""),
                "recommendation": f.get("recommendation", ""),
            }
            for f in findings
        ],
        "diffs": [
            {"finding_id": d["finding_id"], "rationale": d.get("rationale", "")}
            for d in diffs
        ],
    }

    # Try Nova 2 Lite
    try:
        settings = get_settings()
        client = boto3.client("bedrock-runtime", region_name=settings.bedrock_region)
        response = client.converse(
            modelId=settings.nova_model_id,
            system=[{"text": REPORT_PROMPT}],
            messages=[{"role": "user", "content": [{"text": json.dumps(context, indent=2)}]}],
            inferenceConfig={"maxTokens": 4096},
        )
        html = response["output"]["message"]["content"][0]["text"]
        # Strip markdown fences if present
        if "```html" in html:
            html = html.split("```html")[1].split("```")[0].strip()
        elif "```" in html:
            html = html.split("```")[1].split("```")[0].strip()
        return html
    except Exception as exc:
        logger.warning("Nova report generation failed, using template fallback: %s", exc)

    # --- Template fallback ---
    return _template_report(run_state["url"], score, findings, diffs, verify_map, fixed_ids, diff_ids)


def _template_report(
    url: str, score: int,
    findings: list, diffs: list,
    verify_map: dict, fixed_ids: set, diff_ids: set,
) -> str:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    score_color = "#22c55e" if score >= 80 else "#f59e0b" if score >= 50 else "#ef4444"

    rows = ""
    for f in findings:
        fid = f["id"]
        status = "Verified" if fid in fixed_ids else "Applied" if fid in diff_ids else "Pending"
        status_color = "#22c55e" if status == "Verified" else "#3b82f6" if status == "Applied" else "#9ca3af"
        sev = f.get("severity", "minor")
        sev_color = "#ef4444" if sev == "critical" else "#f59e0b" if sev == "major" else "#6b7280"
        wcag = ", ".join(f.get("wcag_refs", []))
        rows += f"""<tr>
            <td style="padding:8px;border-bottom:1px solid #374151">{fid}</td>
            <td style="padding:8px;border-bottom:1px solid #374151">{f['title']}</td>
            <td style="padding:8px;border-bottom:1px solid #374151;color:{sev_color};font-weight:600">{sev.upper()}</td>
            <td style="padding:8px;border-bottom:1px solid #374151">{wcag}</td>
            <td style="padding:8px;border-bottom:1px solid #374151;color:{status_color};font-weight:600">{status}</td>
        </tr>"""

    fixes_section = ""
    for d in diffs:
        v = verify_map.get(d["finding_id"], {})
        result = "Verified" if v.get("passed") else "Applied (unverified)"
        fixes_section += f"""<div style="margin-bottom:12px;padding:12px;background:#1f2937;border-radius:8px">
            <strong>Finding {d['finding_id']}</strong> — {result}<br>
            <em>{d.get('rationale', '')}</em>
        </div>"""

    return f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>NovaGuard Audit Report</title></head>
<body style="font-family:system-ui,sans-serif;background:#111827;color:#e5e7eb;max-width:900px;margin:0 auto;padding:40px 24px">
<h1 style="color:#f9fafb;margin-bottom:4px">NovaGuard Accessibility Audit Report</h1>
<p style="color:#9ca3af;margin-top:0">Audited: <strong>{url}</strong> &mdash; {now}</p>

<div style="display:flex;align-items:center;gap:16px;margin:24px 0;padding:20px;background:#1f2937;border-radius:12px">
    <div style="font-size:48px;font-weight:700;color:{score_color}">{score}</div>
    <div>
        <div style="font-size:14px;color:#9ca3af">Accessibility Score</div>
        <div style="font-size:20px;font-weight:600;color:#f9fafb">out of 100</div>
    </div>
</div>

<h2 style="color:#f9fafb">Findings ({len(findings)})</h2>
<table style="width:100%;border-collapse:collapse;font-size:14px">
<thead><tr style="border-bottom:2px solid #4b5563">
    <th style="padding:8px;text-align:left;color:#9ca3af">ID</th>
    <th style="padding:8px;text-align:left;color:#9ca3af">Title</th>
    <th style="padding:8px;text-align:left;color:#9ca3af">Severity</th>
    <th style="padding:8px;text-align:left;color:#9ca3af">WCAG</th>
    <th style="padding:8px;text-align:left;color:#9ca3af">Status</th>
</tr></thead>
<tbody>{rows}</tbody>
</table>

<h2 style="color:#f9fafb;margin-top:32px">Fixes Applied ({len(diffs)})</h2>
{fixes_section if fixes_section else '<p style="color:#6b7280">No fixes were applied.</p>'}

<hr style="border:none;border-top:1px solid #374151;margin:32px 0">
<p style="color:#6b7280;font-size:12px">Generated by NovaGuard &mdash; AI-Powered Accessibility Compliance Agent</p>
</body></html>"""
