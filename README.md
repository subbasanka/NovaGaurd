# NovaGuard

AI-powered accessibility compliance agent for the Amazon Nova AI Hackathon.

NovaGuard audits any website for WCAG 2.2 Level AA violations, explains them through voice, and auto-fixes them — powered by three Amazon Nova models working together.

---

## How It Work

```
Browser → Nova Act (crawl) → Nova 2 Lite (analyze + fix) → Human Approval → Nova Act (apply + verify) → Nova 2 Sonic (voice)
```

1. **Crawl** — Nova Act navigates the target URL like a real user: page load, keyboard navigation, interactive elements, form inspection. Captures screenshots and DOM at each step.
2. **Analyze** — Nova 2 Lite receives screenshots and DOM, identifies WCAG 2.2 violations with evidence and severity ratings.
3. **Fix** — Nova 2 Lite generates minimal before/after HTML patches for the top findings.
4. **Approve** — Human reviews the diff and clicks Approve in the UI. The pipeline blocks until approved.
5. **Apply** — Nova Act opens the admin panel, edits the HTML, and saves the fix.
6. **Verify** — Nova Act re-checks the fixed elements and captures after screenshots.
7. **Voice** — Nova 2 Sonic answers questions about the audit results conversationally.

All six steps are orchestrated as a Strands Agent Graph with a deterministic HITL (human-in-the-loop) approval gate.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  React Frontend                   │
│  URL Input │ Live Timeline │ Findings │ Diff+Approve │
└────────────────────┬────────────────────────────┘
                     │ WebSocket (real-time events)
┌────────────────────▼────────────────────────────┐
│               FastAPI Backend                    │
│                                                  │
│  POST /runs/start   POST /runs/{id}/approve      │
│  WS   /ws/{id}      GET  /runs/{id}/screenshots  │
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │         Strands Graph (6 nodes)           │   │
│  │  Crawl → Analyze → Fix → Approve         │   │
│  │                          → Apply → Verify │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

### Nova Models

| Model | Role |
|-------|------|
| Nova Act | Browser automation — crawl & apply fixes |
| Nova 2 Lite (`amazon.nova-lite-v2:0`) | Multimodal analysis + fix generation |
| Nova 2 Sonic | Voice interface for audit results |

---

## Project Structure

```
NovaGuard/
├── backend/
│   ├── main.py              # FastAPI app — endpoints + WebSocket
│   ├── graph.py             # Strands 6-node pipeline
│   ├── prompts.py           # ANALYSIS_PROMPT + FIX_GENERATION_PROMPT
│   ├── mock_pipeline.py     # Mock event loop for dev/testing
│   ├── requirements.txt
│   └── agents/
│       ├── crawl.py         # Nova Act crawl agent
│       ├── analyze.py       # Nova 2 Lite analysis (Day 4)
│       ├── fix.py           # Nova 2 Lite fix generation (Day 4)
│       ├── apply.py         # Nova Act apply agent (Day 5)
│       └── verify.py        # Nova Act verify agent (Day 5)
├── frontend/
│   └── src/                 # React + TypeScript + Tailwind
├── test-site/
│   ├── index.html           # Target page with 5 intentional WCAG violations
│   └── admin.html           # HTML editor used by Nova Act to apply fixes
└── NovaGuard_6Day_Implementation_Plan.md
```

---

## Setup

### Prerequisites

- Python 3.11+
- Node.js 18+
- Nova Act API key — get one at [nova.amazon.com/act](https://nova.amazon.com/act)
- AWS credentials with Bedrock access (for Nova 2 Lite — required from Day 4 onward)

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### Frontend

```bash
cd frontend
npm install
```

---

## Running

Start all three servers in separate terminals:

```bash
# Terminal 1 — Backend (port 8000)
cd backend
export NOVA_ACT_API_KEY=your_key_here
# AWS credentials (needed for Nova 2 Lite analysis — Day 4+)
export AWS_ACCESS_KEY_ID=your_key
export AWS_SECRET_ACCESS_KEY=your_secret
export AWS_DEFAULT_REGION=us-east-1
uvicorn main:app --reload --port 8000

# Terminal 2 — Test site (port 8080)
cd test-site
python -m http.server 8080

# Terminal 3 — Frontend (port 5173)
cd frontend
npm run dev
```

Open [http://localhost:5173](http://localhost:5173), enter `http://localhost:8080`, click **Start Audit**.

### Mock Mode (no API keys required)

```bash
cd backend
MOCK_MODE=1 uvicorn main:app --reload --port 8000
```

Mock mode replays a pre-scripted event sequence and is useful for frontend development and demos without live API calls.

---

## Test Site Violations

`test-site/index.html` contains 5 intentional WCAG 2.2 violations:

| # | Violation | WCAG Criterion |
|---|-----------|---------------|
| 1 | `<img>` missing `alt` attribute | 1.1.1 Non-text Content |
| 2 | Button: `#aaa` text on `#ccc` background (~1.6:1 contrast) | 1.4.3 Contrast Minimum |
| 3 | Email `<input>` with no associated `<label>` | 1.3.1 / 4.1.2 |
| 4 | `<div onclick>` not keyboard focusable | 2.1.1 Keyboard |
| 5 | `a:focus, button:focus { outline: none }` removes focus ring | 2.4.7 Focus Visible |

---

## Event Contract

Every WebSocket message follows this schema:

```json
{
  "run_id": "uuid",
  "event": "event_type",
  "timestamp": "ISO-8601",
  "data": {}
}
```

Key event types: `run_started`, `crawl_step`, `crawl_complete`, `finding_created`, `analysis_complete`, `diff_ready`, `approval_required`, `approval_received`, `apply_started`, `apply_done`, `verify_done`, `run_completed`, `run_failed`

---

## Implementation Progress

- [x] Day 1 — Skeleton, event contract, mock UI, prompts
- [x] Day 2 — Nova Act crawl agent (real browser + screenshots)
- [x] Day 3 — Strands graph orchestration + HITL approval gate
- [ ] Day 4 — Nova 2 Lite multimodal analysis + fix generation
- [ ] Day 5 — Apply + verify loop + before/after evidence
- [ ] Day 6 — Voice (Nova 2 Sonic) + demo hardening + submission

---

## Built With

- [Amazon Nova Act](https://nova.amazon.com/act) — browser automation
- [Amazon Nova 2 Lite](https://aws.amazon.com/bedrock/) — multimodal LLM via Bedrock
- [Amazon Nova 2 Sonic](https://aws.amazon.com/bedrock/) — voice AI
- [Strands Agents SDK](https://github.com/strands-agents/sdk-python) — multi-agent graph orchestration
- [FastAPI](https://fastapi.tiangolo.com/) — async backend + WebSockets
- [React](https://react.dev/) + [Tailwind CSS](https://tailwindcss.com/) — frontend

---

*Amazon Nova AI Hackathon submission — #AmazonNova*
