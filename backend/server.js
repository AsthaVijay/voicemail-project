require("dotenv").config();
const express = require("express");
const cors = require("cors");
const session = require("express-session");
const { google } = require("googleapis");
const Anthropic = require("@anthropic-ai/sdk");
const nodemailer = require("nodemailer");
const Imap = require("imap");
const { simpleParser } = require("mailparser");

const app = express();
const PORT = process.env.PORT || 3001;
function parseCommand(text) {
  text = text.toLowerCase();

  // READ EMAILS
  if (text.includes("read")) {
    if (text.includes("unread")) {
      return { action: "read", filter: "unread" };
    }
    return { action: "read", filter: "all" };
  }

  // SEND EMAIL
  if (text.includes("send")) {
    const toMatch = text.match(/to (.+?) (saying|message|that)/);
    const msgMatch = text.match(/(saying|message|that) (.+)/);

    return {
      action: "send",
      to: toMatch ? toMatch[1] : "",
      message: msgMatch ? msgMatch[2] : ""
    };
  }

  // OPEN INBOX
  if (text.includes("inbox")) {
    return { action: "open", folder: "inbox" };
  }

  return { action: "unknown" };
}

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.FRONTEND_URL || "http://localhost:3000", credentials: true }));
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "voicemail-secret-key",
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 },
  })
);

// ── Anthropic Client ────────────────────────────────────────────────────────
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Google OAuth2 Client ────────────────────────────────────────────────────
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI || "http://localhost:3001/auth/google/callback"
);

// ── In-Memory User Store (replace with DB in production) ───────────────────
const userSessions = new Map();

// ─────────────────────────────────────────────────────────────────────────────
// AUTH ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// Initiate Google OAuth
app.get("/auth/google", (req, res) => {
  const scopes = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
  ];
  const url = oauth2Client.generateAuthUrl({ access_type: "offline", scope: scopes });
  res.json({ authUrl: url });
});

// Google OAuth Callback
app.get("/auth/google/callback", async (req, res) => {
  const { code } = req.query;
  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const { data: userInfo } = await oauth2.userinfo.get();

    req.session.userId = userInfo.email;
    req.session.tokens = tokens;
    userSessions.set(userInfo.email, { tokens, userInfo });

    res.redirect(`${process.env.FRONTEND_URL || "http://localhost:3000"}?auth=success&name=${encodeURIComponent(userInfo.name)}&email=${encodeURIComponent(userInfo.email)}`);
  } catch (err) {
    console.error("OAuth callback error:", err);
    res.redirect(`${process.env.FRONTEND_URL || "http://localhost:3000"}?auth=error`);
  }
});

// Voice-based login (passphrase check)
app.post("/auth/voice-login", async (req, res) => {
  const { transcript, email } = req.body;
  const user = userSessions.get(email);
  if (!user) return res.json({ success: false, message: "User not found. Please connect Gmail first." });

  req.session.userId = email;
  req.session.tokens = user.tokens;
  res.json({ success: true, message: `Welcome back, ${user.userInfo.name}. You are now logged in.` });
});

// Check auth status
app.get("/auth/status", (req, res) => {
  if (req.session.userId) {
    const user = userSessions.get(req.session.userId);
    res.json({ authenticated: true, email: req.session.userId, name: user?.userInfo?.name || req.session.userId });
  } else {
    res.json({ authenticated: false });
  }
});

// Logout
app.post("/auth/logout", (req, res) => {
  req.session.destroy();
  res.json({ success: true, message: "You have been logged out successfully." });
});

// ─────────────────────────────────────────────────────────────────────────────
// GMAIL HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function getAuthedClient(req) {
  if (!req.session.tokens) throw new Error("Not authenticated");
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  client.setCredentials(req.session.tokens);
  return client;
}

async function getGmailMessages(auth, folder = "INBOX", maxResults = 20) {
  const gmail = google.gmail({ version: "v1", auth });
  const labelMap = {
    inbox: "INBOX",
    sent: "SENT",
    drafts: "DRAFT",
    trash: "TRASH",
    spam: "SPAM",
    important: "IMPORTANT",
  };
  const label = labelMap[folder.toLowerCase()] || "INBOX";

  const listRes = await gmail.users.messages.list({
    userId: "me",
    labelIds: [label],
    maxResults,
  });

  const messages = listRes.data.messages || [];
  const detailed = await Promise.all(
    messages.map(async (m) => {
      const msg = await gmail.users.messages.get({ userId: "me", id: m.id, format: "metadata", metadataHeaders: ["From", "To", "Subject", "Date"] });
      const headers = msg.data.payload.headers;
      const get = (name) => headers.find((h) => h.name === name)?.value || "";
      return {
        id: m.id,
        threadId: msg.data.threadId,
        snippet: msg.data.snippet || "",
        subject: get("Subject") || "(no subject)",
        from: get("From"),
        to: get("To"),
        date: get("Date"),
        unread: (msg.data.labelIds || []).includes("UNREAD"),
        labels: msg.data.labelIds || [],
      };
    })
  );
  return detailed;
}

async function getEmailBody(auth, messageId) {
  const gmail = google.gmail({ version: "v1", auth });
  const msg = await gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });

  function extractBody(payload) {
    if (!payload) return "";
    if (payload.body?.data) return Buffer.from(payload.body.data, "base64").toString("utf-8");
    if (payload.parts) {
      for (const part of payload.parts) {
        if (part.mimeType === "text/plain" && part.body?.data) {
          return Buffer.from(part.body.data, "base64").toString("utf-8");
        }
      }
      for (const part of payload.parts) {
        const result = extractBody(part);
        if (result) return result;
      }
    }
    return "";
  }

  const headers = msg.data.payload.headers;
  const get = (name) => headers.find((h) => h.name === name)?.value || "";

  return {
    id: messageId,
    subject: get("Subject"),
    from: get("From"),
    to: get("To"),
    date: get("Date"),
    body: extractBody(msg.data.payload),
    snippet: msg.data.snippet,
    labels: msg.data.labelIds || [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// EMAIL ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// List emails in folder
app.get("/emails/:folder", async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
  try {
    const auth = getAuthedClient(req);
    const emails = await getGmailMessages(auth, req.params.folder, req.query.limit || 20);
    res.json({ emails, folder: req.params.folder, count: emails.length, unread: emails.filter((e) => e.unread).length });
  } catch (err) {
    console.error("List emails error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get full email body
app.get("/emails/message/:id", async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
  try {
    const auth = getAuthedClient(req);
    // Mark as read
    const gmail = google.gmail({ version: "v1", auth });
    await gmail.users.messages.modify({ userId: "me", id: req.params.id, requestBody: { removeLabelIds: ["UNREAD"] } }).catch(() => {});
    const email = await getEmailBody(auth, req.params.id);
    res.json(email);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send email
app.post("/emails/send", async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
  const { to, subject, body, replyToId } = req.body;
  try {
    const auth = getAuthedClient(req);
    const gmail = google.gmail({ version: "v1", auth });

    let raw = [`To: ${to}`, `Subject: ${subject}`, `Content-Type: text/plain; charset="UTF-8"`, ``, body].join("\r\n");
    const encoded = Buffer.from(raw).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    const sendReq = { userId: "me", requestBody: { raw: encoded } };
    if (replyToId) sendReq.requestBody.threadId = replyToId;

    await gmail.users.messages.send(sendReq);
    res.json({ success: true, message: `Email sent to ${to} successfully.` });
  } catch (err) {
    console.error("Send error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Delete / trash email
app.delete("/emails/:id", async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
  try {
    const auth = getAuthedClient(req);
    const gmail = google.gmail({ version: "v1", auth });
    await gmail.users.messages.trash({ userId: "me", id: req.params.id });
    res.json({ success: true, message: "Email moved to trash." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Label / move email
app.patch("/emails/:id/label", async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
  const { addLabels = [], removeLabels = [] } = req.body;
  try {
    const auth = getAuthedClient(req);
    const gmail = google.gmail({ version: "v1", auth });
    await gmail.users.messages.modify({
      userId: "me",
      id: req.params.id,
      requestBody: { addLabelIds: addLabels, removeLabelIds: removeLabels },
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// AI / NLP ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// Parse voice command into structured action
app.post("/ai/parse-command", (req, res) => {
  const { transcript } = req.body;

  console.log("Voice input:", transcript);

  const text = transcript.toLowerCase();

  // READ EMAILS
  if (text.includes("read")) {
    if (text.includes("unread")) {
      return res.json({ action: "read", filter: "unread" });
    }
    return res.json({ action: "read", filter: "all" });
  }

  // SEND EMAIL
  if (text.includes("send")) {
    const toMatch = text.match(/to (.+?) (saying|message|that)/);
    const msgMatch = text.match(/(saying|message|that) (.+)/);

    return res.json({
      action: "send",
      to: toMatch ? toMatch[1] : "",
      message: msgMatch ? msgMatch[2] : ""
    });
  }

  // OPEN INBOX
  if (text.includes("inbox")) {
    return res.json({ action: "open", folder: "inbox" });
  }

  return res.json({ action: "unknown" });
});

// Summarize email
app.post("/ai/summarize", async (req, res) => {
  const { email } = req.body;
  try {
    const message = await anthropic.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 300,
      system: "Summarize the email in 2-3 natural spoken sentences for a blind user. No markdown. No special characters. Be concise and clear.",
      messages: [
        {
          role: "user",
          content: `From: ${email.from}\nSubject: ${email.subject}\n\n${email.body || email.snippet}`,
        },
      ],
    });
    res.json({ summary: message.content[0].text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Draft email with AI
app.post("/ai/draft", async (req, res) => {
  const { to, subject, topic, replyTo } = req.body;
  try {
    const prompt = replyTo
      ? `Write a professional email reply. Topic/intent: ${topic}.\n\nOriginal email from ${replyTo.from}:\n${replyTo.body}`
      : `Write a professional email to ${to} about: ${topic}. Subject: ${subject}.`;

    const message = await anthropic.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 600,
      system: "Write only the email body in plain text. Professional and concise. No greeting prefix. No subject line. No special characters. Under 6 sentences.",
      messages: [{ role: "user", content: prompt }],
    });
    res.json({ draft: message.content[0].text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Search emails with AI
app.post("/ai/search", async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
  const { query } = req.body;
  try {
    const auth = getAuthedClient(req);
    const gmail = google.gmail({ version: "v1", auth });
    const results = await gmail.users.messages.list({ userId: "me", q: query, maxResults: 10 });
    const messages = results.data.messages || [];
    const detailed = await Promise.all(
      messages.map(async (m) => {
        const msg = await gmail.users.messages.get({ userId: "me", id: m.id, format: "metadata", metadataHeaders: ["From", "Subject", "Date"] });
        const headers = msg.data.payload.headers;
        const get = (name) => headers.find((h) => h.name === name)?.value || "";
        return { id: m.id, subject: get("Subject"), from: get("From"), date: get("Date"), snippet: msg.data.snippet };
      })
    );
    res.json({ results: detailed, count: detailed.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// TTS helper (returns SSML-friendly text)
app.post("/ai/speak-text", async (req, res) => {
  const { text, type } = req.body;
  // Clean text for TTS: remove HTML, special chars
  const clean = text
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "and")
    .replace(/&lt;/g, "less than")
    .replace(/&gt;/g, "greater than")
    .replace(/\s+/g, " ")
    .trim();
  res.json({ text: clean });
});

// ─────────────────────────────────────────────────────────────────────────────
// HEALTH CHECK
// ─────────────────────────────────────────────────────────────────────────────
app.get("/health", (req, res) => res.json({ status: "ok", version: "1.0.0" }));

app.listen(PORT, () => console.log(`VoiceMail backend running on port ${PORT}`));
