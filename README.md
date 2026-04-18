<<<<<<< HEAD
# VoiceMail — Voice Command Email for the Visually Impaired

> A fully accessible, hands-free email client. No keyboard. No mouse. Just your voice.

A voice-operated email application designed for visually impaired users.  
Supports reading, composing, and sending emails using voice commands.


---

## Architecture

```
voicemail/
├── backend/               Node.js + Express API server
│   ├── server.js          Main server (Auth, Gmail API, AI routes)
│   ├── package.json
│   └── .env.example       Environment variable template
│
└── frontend/
    └── index.html         Full SPA — voice-driven UI
```

### System Layers (from PRD §5.2)

| Layer | Technology |
|-------|-----------|
| Frontend Voice UI | Web Speech API (STT + TTS), vanilla JS |
| Processing Layer | Anthropic Claude (NLP command parsing, summarization, drafting) |
| Integration Layer | Google Gmail API (OAuth2, IMAP/SMTP via REST) |
| Data Layer | Express session + in-memory store (swap for Redis/DB in production) |

---

## Features

### Voice Commands (full list)

| Command | What it does |
|---------|-------------|
| `"read inbox"` | Reads email count and first unread |
| `"open first email"` / `"open second email"` | Opens email by position |
| `"read this email"` / `"read aloud"` | Reads full email body |
| `"next email"` / `"previous email"` | Navigate between emails |
| `"reply"` | Opens compose with reply context |
| `"forward"` | Forwards current email |
| `"compose email to [name/address]"` | Opens compose |
| `"set subject [text]"` | Sets subject field |
| `"my message is [text]"` | Sets message body |
| `"send"` | Sends the email |
| `"delete"` | Moves email to trash |
| `"mark important"` | Stars the email |
| `"search [query]"` | Searches Gmail |
| `"read sent"` / `"read spam"` etc. | Switch folders |
| `"how many emails"` | Count & unread summary |
| `"who sent this"` | Reads sender details |
| `"logout"` | Signs out |
| `"help"` | Reads all commands aloud |

### Accessibility Standards (PRD §6)

- ✅ **Always listening** — microphone auto-restarts after every response
- ✅ **Auditory feedback loops** — every action confirmed by voice
- ✅ **No visual interaction needed** — zero button presses required
- ✅ **Natural language** — Claude parses conversational commands
- ✅ **ARIA labels** throughout for screen readers (sighted helpers)
- ✅ **Adjustable TTS** — rate/pitch configurable in code

---

## Setup

### Prerequisites

- Node.js 18+
- A Google Cloud account (for Gmail API)
- An Anthropic API key
- Google Chrome or Microsoft Edge (for Web Speech API)

---

### Step 1 — Google Cloud Setup

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (e.g. `voicemail-app`)
3. Enable the **Gmail API**:
   - APIs & Services → Enable APIs → search "Gmail API" → Enable
4. Create **OAuth 2.0 credentials**:
   - APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID
   - Application type: **Web application**
   - Authorized redirect URI: `http://localhost:3001/auth/google/callback`
   - Download the credentials JSON
5. Copy your **Client ID** and **Client Secret**

---

### Step 2 — Backend Setup

```bash
cd voicemail/backend

# Install dependencies
npm install

# Create your .env file
cp .env.example .env
```

Edit `.env`:

```env
PORT=3001
SESSION_SECRET=any-random-string-you-choose
FRONTEND_URL=http://localhost:3000

ANTHROPIC_API_KEY=sk-ant-...your-key...

GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
GOOGLE_REDIRECT_URI=http://localhost:3001/auth/google/callback
```

Start the server:

```bash
npm start
# Server running on http://localhost:3001
```

---

### Step 3 — Frontend Setup

The frontend is a single HTML file. Serve it with any static server:

```bash
cd voicemail/frontend

# Option A: Python
python3 -m http.server 3000

# Option B: Node
npx serve . -p 3000

# Option C: VS Code Live Server
# Just open index.html with Live Server extension
```

Then open **http://localhost:3000** in Chrome.

---

### Step 4 — Demo Mode (No Backend)

The frontend includes a **demo mode** with sample emails and direct Anthropic API calls. This works without the backend.

To enable demo mode (already on by default):
```javascript
// In frontend/index.html, line ~280:
const USE_DEMO = true;   // ← keep as true for demo
```

To use with real Gmail:
```javascript
const USE_DEMO = false;  // ← set to false
```

---

## Demo Mode Usage

Open `frontend/index.html` in Chrome. The app will:
1. Speak a welcome message automatically
2. Start listening for voice commands
3. Say **"connect Gmail"** or click the button to enter the email screen
4. Say **"read inbox"** to hear your emails
5. Say **"help"** anytime for the full command list

> **Note**: Demo mode uses sample emails. For real Gmail, set `USE_DEMO = false` and run the backend.

---

## Production Considerations

| Area | Recommendation |
|------|---------------|
| Session store | Replace in-memory with Redis or a DB |
| HTTPS | Required for Web Speech API in production |
| Token refresh | Add OAuth2 token refresh middleware |
| Rate limiting | Add express-rate-limit to API routes |
| Multi-user | Add proper user DB (PostgreSQL recommended) |
| Mobile | Wrap in React Native with native STT/TTS for mobile |

---

## PRD Compliance

| PRD Requirement | Implementation |
|----------------|---------------|
| Full Accessibility (§2) | 100% voice-operated, zero visual interaction required |
| Account Management (§3.1) | OAuth2 voice-guided Gmail login |
| Communication (§3.1) | Voice dictation of To/Subject/Body fields |
| Information Retrieval (§3.1) | TTS reads sender, date, and body |
| Organization (§3.1) | Voice commands: delete, mark important, move |
| ASR (§5.1) | Web Speech API (`SpeechRecognition`) |
| TTS (§5.1) | Web Speech API (`SpeechSynthesisUtterance`) |
| IVR (§5.1) | State machine with Claude NLP command parser |
| Gmail/Outlook (§2) | Gmail API via OAuth2; Outlook via SMTP configurable |
| Voice Auth (§2) | Voice-guided OAuth flow |
| Natural Language (§6) | Claude parses natural/conversational commands |
| Auditory Feedback (§6) | Every action confirmed by voice |
| Customizable Audio (§6) | `rate`, `pitch`, `volume` on SpeechSynthesisUtterance |

---

## Author

Built from: *Product Requirements Document: Voice Command Email for Visually Impaired*  
PRD Author: Manus AI · Date: April 16, 2026
=======
# voicemail-project
Voice-controlled email system for visually impaired users. Allows users to read, compose, and send emails using voice commands with Gmail integration.
>>>>>>> bae29e1d93cea268973cdb8f659ab61523f2eaa0
