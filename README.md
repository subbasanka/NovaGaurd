# NovaGuard

AI-powered accessibility compliance agent for the Amazon Nova AI Hackathon.

NovaGuard audits any website for WCAG 2.2 Level AA violations, explains them through voice, and auto-fixes them — powered by three Amazon Nova models working together.

---

## How It Works

```
URL → Nova Act (crawl) → Nova 2 Lite (analyze + fix) → Human Approval → Nova Act (apply + verify) → Nova 2 Sonic (voice)
```

1. **Crawl** — Nova Act navigates the target URL like a real user: page load, keyboard navigation, interactive elements, form inspection. Captures screenshots and DOM at each step.
2. **Analyze** — Nova 2 Lite receives screenshots and DOM together (multimodal), identifies WCAG 2.2 violations with evidence and severity ratings.
3. **Fix** — Nova 2 Lite generates minimal before/after HTML patches for the top findings.
4. **Approve** — Human reviews the diff and clicks Approve in the UI. The pipeline blocks until approved.
5. **Apply** — Nova Act opens the admin panel, edits the HTML, and saves the fix.
6. **Verify** — Nova Act re-checks the fixed elements and captures after screenshots as proof.
7. **Voice** — Nova 2 Sonic answers questions about the audit results conversationally via speech-to-speech.

All six pipeline steps are orchestrated as a Strands Agent Graph with a deterministic HITL (human-in-the-loop) approval gate.

---

## Key Features

- **Real-time dashboard** — WebSocket-powered live timeline with crawl screenshots, findings, and pipeline progress
- **Pipeline stepper** — Color-coded 6-step visualization showing which Nova model is active
- **Multimodal analysis** — Nova 2 Lite analyzes screenshots AND DOM together to catch visual and structural issues
- **Side-by-side diff viewer** — Before/after HTML with rationale for every proposed fix
- **Before/after screenshots** — Visual proof that fixes were applied correctly
- **Accessibility score** — Letter grade (A–F) with numerical score out of 100
- **Voice interaction** — Ask Nova 2 Sonic questions about findings via speech-to-speech
- **Project management** — Multiple projects with custom dropdown, create/delete support
- **Regression tracking** — Set baselines and track new vs resolved issues across audits
- **Cancel audit** — Stop a running pipeline at any time
- **Mock mode** — Full demo without API keys for development and testing

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                    React Frontend                     │
│  Projects │ Pipeline Stepper │ Timeline │ Findings    │
│  Diff Viewer │ Voice Panel │ Score │ Recent Audits    │
└───────────────────────┬──────────────────────────────┘
                        │ WebSocket (events + voice audio)
┌───────────────────────▼──────────────────────────────┐
│                  FastAPI Backend                       │
│                                                       │
│  POST /runs/start          POST /runs/{id}/approve    │
│  POST /runs/{id}/cancel    DELETE /projects/{id}      │
│  WS   /ws/{id}             WS /ws/voice/{id}          │
│  GET  /runs/{id}/screenshots                          │
│                                                       │
│  ┌─────────────────────────────────────────────┐     │
│  │          Strands Graph (6 nodes)             │     │
│  │  Crawl → Analyze → Fix → ApprovalGate       │     │
│  │                          → Apply → Verify    │     │
│  └─────────────────────────────────────────────┘     │
│                                                       │
│  SQLite (projects, runs, finding triage)              │
└───────────────────────────────────────────────────────┘
```

### Nova Models

| Model | Role | Used In |
|-------|------|---------|
| **Nova Act** | Browser automation — crawl, apply fixes, verify | Crawl, Apply, Verify nodes |
| **Nova 2 Lite** (`amazon.nova-lite-v2:0`) | Multimodal analysis + fix generation | Analyze, Fix nodes |
| **Nova 2 Sonic** (`amazon.nova-2-sonic-v1:0`) | Speech-to-speech voice interface | Voice panel |

---

## Project Structure

```
NovaGuard/
├── backend/
│   ├── main.py                    # FastAPI — endpoints, WebSocket, voice
│   ├── graph.py                   # Strands 6-node pipeline definition
│   ├── prompts.py                 # ANALYSIS_PROMPT + FIX_GENERATION_PROMPT
│   ├── voice.py                   # Nova 2 Sonic voice system prompt + config
│   ├── config.py                  # Environment + model configuration
│   ├── mock_pipeline.py           # Mock event loop (no API keys needed)
│   ├── requirements.txt
│   ├── agents/
│   │   ├── crawl.py               # Nova Act — crawl site, capture screenshots + DOM
│   │   ├── analyze.py             # Nova 2 Lite — multimodal WCAG analysis
│   │   ├── fix.py                 # Nova 2 Lite — generate HTML/CSS patches
│   │   ├── apply.py               # Nova Act — apply fixes via admin panel
│   │   ├── verify.py              # Nova Act — re-check and capture proof
│   │   └── report.py              # Accessibility score calculation
│   └── repositories/
│       ├── run_repository.py      # Abstract repository interface
│       └── sqlite_run_repository.py # SQLite persistence (projects, runs, triage)
├── frontend/
│   ├── index.html                 # Entry point (custom favicon)
│   └── src/
│       ├── App.tsx                # Main layout — project bar, panels, footer
│       ├── api.ts                 # Backend API client functions
│       ├── types.ts               # TypeScript type definitions
│       ├── hooks/
│       │   └── useAuditWebSocket.ts  # WebSocket connection + state management
│       ├── components/
│       │   ├── StartPanel.tsx        # URL input, Start/Cancel buttons, status
│       │   ├── PipelineStepper.tsx    # 6-step color-coded pipeline visualization
│       │   ├── Timeline.tsx          # Live event timeline with screenshots
│       │   ├── FindingsPanel.tsx      # Findings cards with severity + WCAG refs
│       │   ├── DiffPanel.tsx         # Side-by-side diff, approve, before/after
│       │   ├── VoicePanel.tsx        # Nova 2 Sonic mic + transcript + chips
│       │   ├── RecentRunsPanel.tsx   # Audit history + baseline regression
│       │   ├── AccessibilityScore.tsx # Score display with letter grade
│       │   ├── ProjectDropdown.tsx   # Custom project selector with delete
│       │   ├── NewProjectModal.tsx   # Glass-styled project creation modal
│       │   ├── ScreenshotLightbox.tsx # Full-screen screenshot viewer
│       │   └── ErrorToast.tsx        # Error notification component
│       └── lib/
│           └── cn.ts              # Tailwind class merge utility
├── test-site/
│   ├── index.html                 # AcmeCorp landing page — 7 WCAG violations
│   └── admin.html                 # HTML editor used by Nova Act to apply fixes
```

---

## Setup

### Prerequisites

- Python 3.11+
- Node.js 18+
- Nova Act API key — get one at [nova.amazon.com/act](https://nova.amazon.com/act)
- AWS credentials with Bedrock access (us-east-1) for Nova 2 Lite and Nova 2 Sonic
- Chrome/Chromium installed locally (Nova Act uses local browser)

### Environment Variables

```bash
export NOVA_ACT_API_KEY=your_nova_act_key
export AWS_ACCESS_KEY_ID=your_aws_key
export AWS_SECRET_ACCESS_KEY=your_aws_secret
export AWS_DEFAULT_REGION=us-east-1
```

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

Mock mode replays a pre-scripted event sequence — useful for frontend development and demos without live API calls.

---

## Test Site Violations

`test-site/index.html` is a realistic company landing page (AcmeCorp) with **7 intentional WCAG 2.2 violations**:

| # | Violation | WCAG Criterion |
|---|-----------|---------------|
| 1 | `<img>` missing `alt` attribute | 1.1.1 Non-text Content |
| 2 | Button with insufficient contrast (`#aaa` on `#ccc`, ~1.6:1 ratio) | 1.4.3 Contrast Minimum |
| 3 | Form `<input>` fields with no associated `<label>` | 1.3.1 / 4.1.2 |
| 4 | `<div onclick>` not keyboard focusable | 2.1.1 Keyboard |
| 5 | `a:focus, button:focus { outline: none }` removes focus indicators | 2.4.7 Focus Visible |
| 6 | Empty `<a>` link with no text or label | 2.4.4 Link Purpose |
| 7 | Heading level skip (`<h1>` → `<h4>`) | 1.3.1 Info and Relationships |

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

## Voice (Speech-to-Speech)

Voice uses Nova 2 Sonic (`amazon.nova-2-sonic-v1:0`) for real-time speech-to-speech via a WebSocket.

The UI shows a mic button after findings appear. Click it to start a live conversation — your mic audio streams to Nova Sonic and you hear the response in real-time.

**Capabilities:**
- Explain any finding or WCAG criterion in plain language
- Approve fixes via voice command ("approve the fix")
- Start new audits conversationally
- Conversational Q&A about accessibility best practices

**WebSocket protocol** (`ws://localhost:8000/ws/voice/{run_id}`):
- Browser → Server: binary frames of 16 kHz mono 16-bit PCM
- Server → Browser: binary frames of 24 kHz mono 16-bit PCM
- Browser → Server: JSON `{"event": "stop"}` to end session

---

## Built With

- [Amazon Nova Act](https://nova.amazon.com/act) — browser automation
- [Amazon Nova 2 Lite](https://aws.amazon.com/bedrock/) — multimodal LLM via Bedrock
- [Amazon Nova 2 Sonic](https://aws.amazon.com/bedrock/) — speech-to-speech voice AI
- [Strands Agents SDK](https://github.com/strands-agents/sdk-python) — multi-agent graph orchestration
- [FastAPI](https://fastapi.tiangolo.com/) — async backend + WebSockets
- [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) + [Tailwind CSS](https://tailwindcss.com/) — frontend
- [Framer Motion](https://www.framer.com/motion/) — animations
- [SQLite](https://www.sqlite.org/) — lightweight persistence

---

*Amazon Nova AI Hackathon submission — #AmazonNova*
