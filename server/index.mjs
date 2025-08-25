/* server/index.mjs */
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import nodemailer from "nodemailer";
import { fileURLToPath } from "url";

console.log("[BOOT] index.mjs v8 — starting server file:", new Date().toISOString());

/* ---------------------- helper: dynamic router loader ---------------------- */
async function loadRouter(modUrl, name) {
  try {
    const mod = await import(modUrl);
    const candidates = [
      mod.default,
      mod.router,
      mod.routes,
      mod[name],
      typeof mod.createRouter === "function" ? mod.createRouter() : undefined,
    ];
    const router = candidates.find(
      (r) => r && typeof r === "function" && typeof r.use === "function" && typeof r.get === "function"
    );
    if (!router) {
      console.error(`[router] ${name}: no usable router export found`, {
        hasDefault: !!mod.default,
        hasRouter: !!mod.router,
        hasRoutes: !!mod.routes,
        hasNamed: !!mod[name],
        hasCreateRouter: typeof mod.createRouter === "function",
        keys: Object.keys(mod || {}),
      });
    } else {
      console.log(`[router] ${name}: loaded OK`);
    }
    return router;
  } catch (e) {
    console.error(`[router] ${name}: failed to import`, e?.message || e);
    return undefined;
  }
}

/* ---------------------------- ESM dirname utils --------------------------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Build absolute URLs for emails/assets if PUBLIC_ORIGIN is provided (e.g., http://your-server:3001)
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN || ""; // example: "http://your-server:3001"
const absUrl = (p) => (PUBLIC_ORIGIN ? `${PUBLIC_ORIGIN}${p}` : p);

/* ------------------------------- config I/O -------------------------------- */
const CONFIG_PATH = path.join(__dirname, "config.json");
const DEFAULT_CONFIG = {
  smtpHost: "",
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: "",
  smtpPass: "",
  fromAddress: "",
  plexUrl: "",
  plexToken: "",
  tautulliUrl: "",
  tautulliApiKey: "",
  lookbackDays: 7,
  ownerRecommendation: {},
  lastTest: { plex: "unknown", tautulli: "unknown", smtp: "unknown" },
};

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      lastTest: { ...DEFAULT_CONFIG.lastTest, ...(parsed.lastTest || {}) },
      lookbackDays: typeof parsed.lookbackDays === "number" ? parsed.lookbackDays : 7,
      ownerRecommendation: parsed.ownerRecommendation || {},
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf8");
}
let CONFIG = loadConfig();

/* --------------------------- recipients persistence ------------------------ */
const RECIPIENTS_PATH = path.join(__dirname, "recipients.json");
function isEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || "").trim());
}
function loadRecipientsSafe() {
  try {
    if (!fs.existsSync(RECIPIENTS_PATH)) fs.writeFileSync(RECIPIENTS_PATH, "[]", "utf8");
    const txt = fs.readFileSync(RECIPIENTS_PATH, "utf8");
    const arr = JSON.parse(txt);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    console.error("[recipients] load failed:", e?.message || e);
    return [];
  }
}
function saveRecipientsSafe(list) {
  try {
    fs.writeFileSync(RECIPIENTS_PATH, JSON.stringify(list, null, 2), "utf8");
    console.log("[recipients] wrote", RECIPIENTS_PATH, `(${list.length} items)`);
    return true;
  } catch (e) {
    console.error("[recipients] write failed:", e?.message || e);
    return false;
  }
}

/* ---------------------------- templates persistence ------------------------ */
const TEMPLATES_PATH = path.join(__dirname, "emailtemplates.json");
function loadTemplatesSafe() {
  try {
    if (!fs.existsSync(TEMPLATES_PATH)) fs.writeFileSync(TEMPLATES_PATH, "[]", "utf8");
    const txt = fs.readFileSync(TEMPLATES_PATH, "utf8");
    const arr = JSON.parse(txt);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    console.error("[templates] load failed:", e?.message || e);
    return [];
  }
}
function saveTemplatesSafe(list) {
  try {
    fs.writeFileSync(TEMPLATES_PATH, JSON.stringify(list, null, 2), "utf8");
    console.log("[templates] wrote", TEMPLATES_PATH, `(${list.length} items)`);
    return true;
  } catch (e) {
    console.error("[templates] write failed:", e?.message || e);
    return false;
  }
}
function newId() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

/* --------------------------- newsletters persistence ----------------------- */
const NEWSLETTERS_PATH = path.join(__dirname, "newsletters.json");
function loadNewslettersSafe() {
  try {
    if (!fs.existsSync(NEWSLETTERS_PATH)) fs.writeFileSync(NEWSLETTERS_PATH, "[]", "utf8");
    const txt = fs.readFileSync(NEWSLETTERS_PATH, "utf8");
    const arr = JSON.parse(txt);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    console.error("[newsletters] load failed:", e?.message || e);
    return [];
  }
}
function saveNewslettersSafe(list) {
  try {
    fs.writeFileSync(NEWSLETTERS_PATH, JSON.stringify(list, null, 2), "utf8");
    console.log("[newsletters] wrote", NEWSLETTERS_PATH, `(${list.length} items)`);
    return true;
  } catch (e) {
    console.error("[newsletters] write failed:", e?.message || e);
    return false;
  }
}

/* -------------------------------- helpers --------------------------------- */
function applyIncomingSmtp(body, cfg) {
  if (typeof body.smtpHost === "string") cfg.smtpHost = body.smtpHost;
  if (typeof body.smtpPort === "number") cfg.smtpPort = body.smtpPort;
  if (typeof body.smtpSecure === "boolean") cfg.smtpSecure = body.smtpSecure;
  if (typeof body.smtpUser === "string") cfg.smtpUser = body.smtpUser;
  if (typeof body.smtpPass === "string" && body.smtpPass.length > 0) cfg.smtpPass = body.smtpPass;
  if (typeof body.fromAddress === "string") cfg.fromAddress = body.fromAddress;

  if (typeof body.smtpServer === "string") cfg.smtpHost = body.smtpServer;
  if (typeof body.smtpEmailLogin === "string") cfg.smtpUser = body.smtpEmailLogin;
  if (typeof body.smtpEmailPassword === "string" && body.smtpEmailPassword.length > 0)
    cfg.smtpPass = body.smtpEmailPassword;
  if (typeof body.smtpEncryption === "string") cfg.smtpSecure = body.smtpEncryption.toUpperCase() === "TLS/SSL";
}
function smtpTransportOptions(cfg) {
  const secure = !!cfg.smtpSecure;
  return {
    host: cfg.smtpHost,
    port: Number(cfg.smtpPort) || (secure ? 465 : 587),
    secure,
    requireTLS: !secure && Number(cfg.smtpPort) === 587,
    ignoreTLS: !secure && Number(cfg.smtpPort) === 25,
    auth: cfg.smtpUser ? { user: cfg.smtpUser, pass: cfg.smtpPass } : undefined,
  };
}

/* --------------------------------- app ------------------------------------ */
const app = express();
// ---- HARD GUARD: short-circuit ALL /api/tautulli/* unless tested OK ----
app.all('/api/tautulli/*', (req, res, next) => {
  try {
    // Treat Tautulli as enabled only when explicitly tested OK
    const url = String((CONFIG?.tautulli?.baseUrl ?? CONFIG?.tautulliUrl) || '').trim();
    const key = String((CONFIG?.tautulli?.apiKey   ?? CONFIG?.tautulliApiKey) || '').trim();
    const testedOk = (CONFIG?.lastTest?.tautulli === 'ok');

    const notConfigured = !url || !key;
    const disabled = notConfigured || !testedOk;

    if (disabled) {
      const rel = String(req.path || '');
      if (rel.includes('summary')) {
        return res.status(200).json({ disabled: true, reason: notConfigured ? 'TAUTULLI_NOT_CONFIGURED' : 'TAUTULLI_NOT_TESTED', home: [], rows: [] });
      }
      if (rel.includes('recent')) {
        return res.status(200).json({ disabled: true, reason: notConfigured ? 'TAUTULLI_NOT_CONFIGURED' : 'TAUTULLI_NOT_TESTED', rows: [] });
      }
      return res.status(200).json({ disabled: true, reason: notConfigured ? 'TAUTULLI_NOT_CONFIGURED' : 'TAUTULLI_NOT_TESTED' });
    }
  } catch {}
  next();
});
// ---- Guards: disable Tautulli when not configured ----
const CONFIG_PATHS = [
  path.resolve(process.cwd(), "server/config.json"),
  path.resolve(process.cwd(), "config.json"),
];

function readConfigSync() {
  for (const p of CONFIG_PATHS) {
    try {
      if (fs.existsSync(p)) {
        const txt = fs.readFileSync(p, "utf8");
        return JSON.parse(txt);
      }
    } catch {}
  }
  return {};
}

function tautulliConfigured(cfg) {
  // support both shapes: flat (tautulliUrl/apiKey) and nested (tautulli.baseUrl/apiKey)
  const url = cfg?.tautulli?.baseUrl ?? cfg?.tautulliUrl ?? "";
  const key = cfg?.tautulli?.apiKey ?? cfg?.tautulliApiKey ?? "";
  return !!(url && key);
}

// This guard short-circuits ALL /api/tautulli/* routes when not configured
app.use("/api/tautulli", (req, res, next) => {
  const cfg = readConfigSync();
  if (!tautulliConfigured(cfg)) {
    // try to return a sensible shape for common endpoints
    const q = String(req.path || "");
    if (q.includes("summary")) {
      return res.status(200).json({ disabled: true, reason: "TAUTULLI_NOT_CONFIGURED", home: [], rows: [] });
    }
    if (q.includes("recent")) {
      return res.status(200).json({ disabled: true, reason: "TAUTULLI_NOT_CONFIGURED", rows: [] });
    }
    return res.status(200).json({ disabled: true, reason: "TAUTULLI_NOT_CONFIGURED" });
  }
  next();
});
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "2mb" }));

// Serve platform icons (from /public)
const PUBLIC_DIR = path.join(__dirname, "..", "public");
app.use("/assets", express.static(PUBLIC_DIR));

// DEBUG
try {
  const exists = fs.existsSync(PUBLIC_DIR);
  console.log("[assets] mount ->", PUBLIC_DIR, exists ? "(exists)" : "(MISSING)");
  if (exists) {
    const platformsDir = path.join(PUBLIC_DIR, "platforms");
    const list = fs.existsSync(platformsDir) ? fs.readdirSync(platformsDir) : [];
    console.log("[assets] /platforms contains:", list);
  }
} catch (e) {
  console.log("[assets] check failed:", e?.message || e);
}

// (then your routes like __whoami, etc.)
app.get("/__whoami", (_req, res) => {
  res.json({
    file: __filename,
    configPath: CONFIG_PATH,
    recipientsPath: RECIPIENTS_PATH,
    templatesPath: TEMPLATES_PATH,
    newslettersPath: NEWSLETTERS_PATH,
  });
});

/* --------------------------- mount feature routers ------------------------- */
const plexRouter = await loadRouter(new URL("./routes/plex.mjs", import.meta.url), "plex");
const tautulliRouter = await loadRouter(new URL("./routes/tautulli.mjs", import.meta.url), "tautulli");
if (plexRouter) app.use("/api/plex", plexRouter);
if (tautulliRouter) app.use("/api/tautulli", tautulliRouter);
console.log("[router] tautulli: ENABLED (guard in index.mjs will gate access)");

/* -------------------------- tiny debug observability ----------------------- */
app.get("/api/_routes", (_req, res) => {
  const stack = (app._router && app._router.stack) || [];
  const routes = [];
  for (const layer of stack) {
    if (layer.route && layer.route.path) {
      const methods = Object.keys(layer.route.methods || {}).filter(Boolean);
      routes.push({ path: layer.route.path, methods });
    } else if (layer.name === "router" && layer.regexp) {
      routes.push({ mounted: true, path: String(layer.regexp) });
    }
  }
  res.json({ routes });
});

app.get("/api/schedule", (_req, res) => {
  res.json({ jobs: getScheduledJobsSnapshot() });
});

/* --------------------- recipients API (persistent file) -------------------- */
app.get("/api/recipients", (_req, res) => {
  res.json(loadRecipientsSafe());
});
app.post("/api/recipients", (req, res) => {
  const payload = Array.isArray(req.body) ? req.body : [];
  const cleaned = payload
    .map((r) => ({
      fullName: String(r?.fullName || r?.name || "").trim(),
      email: String(r?.email || "").trim().toLowerCase(),
    }))
    .filter((r) => isEmail(r.email))
    .reduce((acc, r) => (acc.find((x) => x.email === r.email) ? acc : acc.concat(r)), []);
  if (!saveRecipientsSafe(cleaned)) {
    return res.status(500).json({ ok: false, error: "Failed to write recipients.json" });
  }
  res.json({ ok: true, recipients: cleaned });
});

/* ---------------------- templates API (persistent file) -------------------- */
app.get("/api/templates", (_req, res) => {
  res.json(loadTemplatesSafe());
});
app.post("/api/templates", (req, res) => {
  const name = String(req.body?.name || "").trim();
  const html = String(req.body?.html ?? "");
  let historyDays = req.body?.historyDays;
  if (typeof historyDays !== "number" || Number.isNaN(historyDays)) {
    historyDays = undefined;
  } else {
    historyDays = Math.max(1, Math.min(90, Math.floor(historyDays)));
  }
  if (!name) return res.status(400).json({ ok: false, error: "Missing template name" });

  const list = loadTemplatesSafe();
  const now = Date.now();
  const existing = list.find((t) => t.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    existing.html = html;
    if (historyDays !== undefined) existing.historyDays = historyDays;
    existing.updatedAt = now;
  } else {
    const item = { id: newId(), name, html, updatedAt: now };
    if (historyDays !== undefined) item.historyDays = historyDays;
    list.push(item);
  }
  if (!saveTemplatesSafe(list)) {
    return res.status(500).json({ ok: false, error: "Failed to write emailtemplates.json" });
  }
  res.json({ ok: true, templates: list });
});
app.delete("/api/templates/:id", (req, res) => {
  const id = String(req.params.id || "");
  if (!id) return res.status(400).json({ ok: false, error: "Missing id" });
  const list = loadTemplatesSafe();
  const next = list.filter((t) => t.id !== id);
  if (!saveTemplatesSafe(next)) {
    return res.status(500).json({ ok: false, error: "Failed to write emailtemplates.json" });
  }
  res.json({ ok: true, templates: next });
});

/* ---------------------- newsletters API (persistent file) ------------------ */
app.get("/api/newsletters", (_req, res) => {
  res.json(loadNewslettersSafe());
});
app.post("/api/newsletters", (req, res) => {
  const payload = Array.isArray(req.body) ? req.body : [];
  const cleaned = payload.map((n) => {
    const id = String(n?.id || newId());
    const recipients = Array.isArray(n?.recipients)
      ? n.recipients.map((e) => String(e || "").toLowerCase()).filter((e) => isEmail(e))
      : [];
    const schedule = typeof n?.schedule === "object" && n.schedule ? { ...n.schedule } : null;
    const enabled = !!n?.enabled;
    const historyDays =
      typeof n?.historyDays === "number" ? Math.max(1, Math.min(90, Math.floor(n.historyDays))) : undefined;
    const updatedAt = typeof n?.updatedAt === "number" ? n.updatedAt : Date.now();
    const createdAt = typeof n?.createdAt === "number" ? n.createdAt : Date.now();
    const lastSentAt = typeof n?.lastSentAt === "number" ? n.lastSentAt : undefined;

    return {
      id,
      name: String(n?.name || ""),
      subject: String(n?.subject || ""),            // <— persist subject
      description: String(n?.description || ""),
      templateId: n?.templateId ? String(n.templateId) : undefined,
      templateName: n?.templateName ? String(n.templateName) : undefined,
      recipients,
      schedule,
      enabled,
      historyDays,
      updatedAt,
      createdAt,
      ...(lastSentAt ? { lastSentAt } : {}),
    };
  });

  if (!saveNewslettersSafe(cleaned)) {
    return res.status(500).json({ ok: false, error: "Failed to write newsletters.json" });
  }

  restartScheduler();
  res.json({ ok: true, newsletters: cleaned });
});
app.delete("/api/newsletters/:id", (req, res) => {
  const id = String(req.params.id || "");
  if (!id) return res.status(400).json({ ok: false, error: "Missing id" });
  const list = loadNewslettersSafe();
  const next = list.filter((t) => t.id !== id);
  if (!saveNewslettersSafe(next)) {
    return res.status(500).json({ ok: false, error: "Failed to write newsletters.json" });
  }
  restartScheduler();
  res.json({ ok: true, newsletters: next });
});

// Quick sanity ping for newsletters API
app.get("/api/newsletters/__ping", (_req, res) => {
  res.json({ ok: true, msg: "newsletters API is alive" });
});

/* -------------------------------- API routes ------------------------------ */
app.get("/api/config", (_req, res) => {
  const { smtpPass, ...rest } = CONFIG;
  res.json(rest);
});
app.post("/api/config", (req, res) => {
  const b = req.body || {};
  if (typeof b.plexUrl === "string") CONFIG.plexUrl = b.plexUrl;
  if (typeof b.plexToken === "string") CONFIG.plexToken = b.plexToken;
  if (typeof b.tautulliUrl === "string") CONFIG.tautulliUrl = b.tautulliUrl;
  if (typeof b.tautulliApiKey === "string") CONFIG.tautulliApiKey = b.tautulliApiKey;
  if (typeof b.lookbackDays === "number") CONFIG.lookbackDays = b.lookbackDays;
  if (b.ownerRecommendation && typeof b.ownerRecommendation === "object") {
    CONFIG.ownerRecommendation = b.ownerRecommendation;
  }
  if (b.schedule && typeof b.schedule === "object") CONFIG.schedule = b.schedule;
  applyIncomingSmtp(b, CONFIG);
  saveConfig(CONFIG);
  res.json({ ok: true });
});
app.get("/api/status", (_req, res) => {
  const s = CONFIG.lastTest || {};
  res.json({ emailOk: s.smtp === "ok", plexOk: s.plex === "ok", tautulliOk: s.tautulli === "ok" });
});

/* --------- test endpoints (unchanged) --------- */
app.post("/api/test/plex", async (req, res) => {
  const plexUrl = (req.body && req.body.plexUrl) || CONFIG.plexUrl;
  const plexToken = (req.body && req.body.plexToken) || CONFIG.plexToken;
  try {
    if (!plexUrl || !plexToken) throw new Error("Missing plexUrl or plexToken");
    const urlWithScheme = /^https?:\/\//i.test(plexUrl) ? plexUrl : `http://${plexUrl}`;
    const sep = urlWithScheme.includes("?") ? "&" : "?";
    const probe = `${urlWithScheme}${sep}X-Plex-Token=${encodeURIComponent(plexToken)}`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 5000);
    let r;
    try {
      r = await fetch(probe, { method: "GET", signal: ac.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
    CONFIG.lastTest.plex = "ok";
    saveConfig(CONFIG);
    res.json({ ok: true });
  } catch (e) {
    CONFIG.lastTest.plex = "fail";
    saveConfig(CONFIG);
    res.json({ ok: false, error: e?.message || String(e) });
  }
});
app.post("/api/test-plex", (req, res) =>
  app._router.handle({ ...req, url: "/api/test/plex", method: "POST" }, res, () => {})
);
app.post("/api/test/tautulli", async (req, res) => {
  const tUrlRaw = (req.body && req.body.tautulliUrl) || CONFIG.tautulliUrl;
  const apiKey = (req.body && req.body.tautulliApiKey) || CONFIG.tautulliApiKey;
  try {
    if (!tUrlRaw || !apiKey) throw new Error("Missing tautulliUrl or tautulliApiKey");
    const tUrl = /^https?:\/\//i.test(tUrlRaw) ? tUrlRaw : `http://${tUrlRaw}`;
    const base = `${tUrl}`.replace(/\/+$/, "");
    const probe = `${base}/api/v2?apikey=${encodeURIComponent(apiKey)}&cmd=get_activity`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 5000);
    let r;
    try {
      r = await fetch(probe, { method: "GET", signal: ac.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
    const json = await r.json().catch(() => null);
    const ok = json && json.response && json.response.result === "success";
    CONFIG.lastTest.tautulli = "ok";
    saveConfig(CONFIG);
    res.json({ ok: true });
  } catch (e) {
    CONFIG.lastTest.tautulli = "fail";
    saveConfig(CONFIG);
    res.json({ ok: false, error: e?.message || String(e) });
  }
});
app.post("/api/test-tautulli", (req, res) =>
  app._router.handle({ ...req, url: "/api/test/tautulli", method: "POST" }, res, () => {})
);
app.post("/api/test-email", async (req, res) => {
  // This route now handles BOTH: (1) SMTP verify/test and (2) a real send
  // when the body includes html/text (so "Send Now" calls that hit this
  // endpoint won't accidentally fire the plain test email).
  const merged = { ...CONFIG };
  if (req.body && typeof req.body === "object") {
    merged.smtpHost = req.body.smtpHost ?? merged.smtpHost;
    merged.smtpPort = typeof req.body.smtpPort === "number" ? req.body.smtpPort : merged.smtpPort;
    merged.smtpSecure = typeof req.body.smtpSecure === "boolean" ? req.body.smtpSecure : merged.smtpSecure;
    merged.smtpUser = req.body.smtpUser ?? merged.smtpUser;
    merged.smtpPass = req.body.smtpPass && req.body.smtpPass.length > 0 ? req.body.smtpPass : merged.smtpPass;
    merged.fromAddress = req.body.fromAddress ?? merged.fromAddress ?? merged.smtpUser;
  }
  try {
    if (!merged.smtpHost || !merged.smtpPort) throw new Error("Missing SMTP server/port");
    if (!merged.fromAddress) throw new Error("Missing From Address");

    const transport = nodemailer.createTransport(smtpTransportOptions(merged));
    await transport.verify();

    // If the request includes newsletter content, treat this as a real send.
    const hasHtml = typeof req.body?.html === "string" && req.body.html.trim().length > 0;
    const hasText = typeof req.body?.text === "string" && req.body.text.trim().length > 0;

    if (hasHtml || hasText) {
      const normalizeList = (v) =>
        (Array.isArray(v) ? v : (typeof v === "string" ? v.split(",") : []))
          .map((s) => String(s || "").trim().toLowerCase())
          .filter((s) => isEmail(s));

      let toList = normalizeList(req.body.to);
      let bccList = normalizeList(req.body.bcc);

      // Fallback to recipients.json -> BCC everyone if no explicit recipients provided
      if (toList.length === 0 && bccList.length === 0) {
        const saved = loadRecipientsSafe();
        bccList = saved
          .map((r) => String(r.email || "").trim().toLowerCase())
          .filter((s) => isEmail(s));
      }
      if (toList.length === 0 && bccList.length === 0) {
        return res.status(400).json({ ok: false, error: "No recipients found (recipients.json is empty)." });
      }

      const subject = String(req.body.subject || "Kunkflix Newsletter").trim();

      // Avoid "noreply@localhost" by using a safe To header when only BCC is used.
      const toHeader = toList.length ? toList.join(", ") : merged.fromAddress;

      const msg = {
        from: merged.fromAddress,
        to: toHeader,
        bcc: bccList.length ? bccList.join(", ") : undefined,
        subject,
        ...(hasHtml ? { html: req.body.html } : {}),
        ...(hasText ? { text: req.body.text } : {}),
        headers: { "X-Kunkflix-Path": "/api/test-email" },
      };

      const info = await transport.sendMail(msg);

      // Persist any updated SMTP details and mark as ok
      applyIncomingSmtp(req.body || {}, CONFIG);
      CONFIG.lastTest.smtp = "ok";
      saveConfig(CONFIG);

      return res.json({
        ok: true,
        sent: true,
        accepted: info.accepted || [],
        rejected: info.rejected || [],
        envelope: info.envelope || {},
        messageId: info.messageId || null,
        response: info.response || null,
        toCount: toList.length,
        bccCount: bccList.length,
      });
    }

    // Otherwise, behave like a simple SMTP test (previous behavior)
    if (req.body && typeof req.body.to === "string" && req.body.to.length > 0) {
      await transport.sendMail({
        from: merged.fromAddress,
        to: req.body.to,
        subject: "Kunkflix Newsletter SMTP Test",
        text: "This is a test email confirming your SMTP settings are working.",
      });
    }

    applyIncomingSmtp(req.body || {}, CONFIG);
    CONFIG.lastTest.smtp = "ok";
    saveConfig(CONFIG);
    res.json({ ok: true });
  } catch (e) {
    CONFIG.lastTest.smtp = "fail";
    saveConfig(CONFIG);
    res.json({ ok: false, error: e?.message || String(e) });
  }
});
app.post("/api/test/smtp", (req, res) =>
  app._router.handle({ ...req, url: "/api/test-email", method: "POST" }, res, () => {})
);

/* --------- Plex identity helpers (for official app.plex.tv links) --------- */
let CACHED_PLEX_SERVER_ID = null;
function trimRightSlash(u = "") { return String(u || "").replace(/\/+$/, ""); }
async function fetchPlexIdentity() {
  const base = trimRightSlash(CONFIG.plexUrl);
  const token = CONFIG.plexToken || "";
  if (!base || !token) throw new Error("Missing Plex URL or token in config.json");
  const url = `${base}/identity?X-Plex-Token=${encodeURIComponent(token)}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 5000);
  try {
    const r = await fetch(url, { signal: ac.signal });
    const txt = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}: ${txt}`);
    const idMatch = txt.match(/machineIdentifier="([^"]+)"/i);
    const nameMatch = txt.match(/friendlyName="([^"]+)"/i);
    const machineIdentifier = idMatch ? idMatch[1] : null;
    const friendlyName = nameMatch ? nameMatch[1] : null;
    return { machineIdentifier, friendlyName, raw: txt };
  } finally {
    clearTimeout(timer);
  }
}
app.get("/api/plex/identity", async (_req, res) => {
  try {
    const { machineIdentifier, friendlyName } = await fetchPlexIdentity();
    if (!machineIdentifier) return res.status(500).json({ error: "Unable to parse machineIdentifier" });
    CACHED_PLEX_SERVER_ID = machineIdentifier;
    res.json({ machineIdentifier, friendlyName });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});
app.get("/api/plex/server-id", async (_req, res) => {
  try {
    if (CACHED_PLEX_SERVER_ID) return res.json({ machineIdentifier: CACHED_PLEX_SERVER_ID });
    const { machineIdentifier } = await fetchPlexIdentity();
    if (!machineIdentifier) return res.status(500).json({ error: "Unable to parse machineIdentifier" });
    CACHED_PLEX_SERVER_ID = machineIdentifier;
    res.json({ machineIdentifier });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/* --- tiny fetch helpers --- */
function trimSlash(u = "") { return String(u || "").replace(/\/+$/, ""); }
async function fetchWithTimeout(url, ms = 6000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { signal: ac.signal }); }
  finally { clearTimeout(t); }
}
/* -------- Plex totals helpers (used by CARD_SERVER_TOTALS) -------- */

/** Fetch a Plex JSON endpoint relative to CONFIG.plexUrl, auto-adding X-Plex-Token. */
async function fetchPlexJson(pathAndQuery) {
  const base = (CONFIG.plexUrl || "").replace(/\/+$/, "");
  const token = CONFIG.plexToken || "";
  if (!base || !token) throw new Error("Missing Plex URL or token in config.json");

  // Ensure leading slash
  const rel = String(pathAndQuery || "");
  const path = rel.startsWith("/") ? rel : `/${rel}`;

  // Add token (preserve any existing query params)
  const sep = path.includes("?") ? "&" : "?";
  const url = `${base}${path}${sep}X-Plex-Token=${encodeURIComponent(token)}`;

  const r = await fetchWithTimeout(url, 7000);
  const txt = await r.text();
  if (!r.ok) {
    throw new Error(`Plex HTTP ${r.status} ${r.statusText}: ${txt.slice(0, 200)}`);
  }

  try {
    return JSON.parse(txt);
  } catch {
    return { _rawXml: txt };
  }
}

async function fetchPlexLibraryTotals() {
  const safeNum = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  // 1) Discover sections
  let sections;
  try {
    const j = await fetchPlexJson("/library/sections");
    if (j && j.MediaContainer && Array.isArray(j.MediaContainer.Directory)) {
      sections = j.MediaContainer.Directory.map(d => ({
        key: d.key,
        type: d.type, // "movie" | "show" | others
      }));
    } else if (j && j._rawXml) {
      const dirMatches = [...j._rawXml.matchAll(/<Directory\b[^>]*>/g)];
      sections = dirMatches.map(m => {
        const tag = m[0];
        const type = (tag.match(/\btype="([^"]+)"/) || [])[1];
        const key  = (tag.match(/\bkey="([^"]+)"/) || [])[1];
        return { key, type };
      }).filter(s => s.key && s.type);
    } else {
      sections = [];
    }
  } catch {
    sections = [];
  }

  const movieSections = sections.filter(s => s.type === "movie");
  const showSections  = sections.filter(s => s.type === "show");

  const readTotalFromAll = (res) => {
    if (res && res.MediaContainer) {
      const mc = res.MediaContainer;
      if (mc.totalSize != null) return safeNum(mc.totalSize);
      if (mc.size != null) return safeNum(mc.size);
    }
    if (res && res._rawXml) {
      const m1 = res._rawXml.match(/\btotalSize="(\d+)"/);
      if (m1) return safeNum(m1[1]);
      const m2 = res._rawXml.match(/\bsize="(\d+)"/);
      if (m2) return safeNum(m2[1]);
    }
    return 0;
  };

  // 2) Movies total
  let moviesTotal = 0;
  for (const s of movieSections) {
    try {
      const res = await fetchPlexJson(`/library/sections/${encodeURIComponent(s.key)}/all?type=1&X-Plex-Container-Start=0&X-Plex-Container-Size=0`);
      moviesTotal += readTotalFromAll(res);
    } catch {}
  }

  // 3) Shows + Episodes totals
  let showsTotal = 0;
  let episodesTotal = 0;
  for (const s of showSections) {
    try {
      const resShows = await fetchPlexJson(`/library/sections/${encodeURIComponent(s.key)}/all?type=2&X-Plex-Container-Start=0&X-Plex-Container-Size=0`);
      showsTotal += readTotalFromAll(resShows);
    } catch {}
    try {
      const resEps = await fetchPlexJson(`/library/sections/${encodeURIComponent(s.key)}/all?type=4&X-Plex-Container-Start=0&X-Plex-Container-Size=0`);
      episodesTotal += readTotalFromAll(resEps);
    } catch {}
  }

  return { moviesTotal, showsTotal, episodesTotal };
}

/* =============================== RENDERING ================================ */
function htmlEscape(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function cardHtml(title, bodyHtml) {
  return `<div style="border:1px solid #e5e7eb;border-radius:12px;padding:16px;background:#fff;margin:16px 0;">
    <h3 style="margin:0 0 10px 0;font-size:16px;line-height:1.2">${htmlEscape(title)}</h3>
    ${bodyHtml}
  </div>`;
}
function li(label, value) {
  return `<li>${htmlEscape(label)} <span style="opacity:.7">— ${htmlEscape(value)}</span></li>`;
}
function formatInt(n) {
  const m = Number(n);
  return Number.isFinite(m) ? m.toLocaleString("en-US") : String(n);
}
function formatHm(hours, minutes) {
  const h = Number.isFinite(hours) ? hours : 0;
  const m = Number.isFinite(minutes) ? minutes : 0;
  const hs = h === 1 ? "Hour" : "Hours";
  const ms = m === 1 ? "Minute" : "Minutes";
  return `${h.toLocaleString("en-US")} ${hs}, ${m.toLocaleString("en-US")} ${ms}`;
}
function posterFrom(row) {
  const p = row?.thumbPath || row?.thumb || row?.grandparentThumb || row?.parentThumb || row?.art || row?.poster || null;
  if (!p) return null;
  if (typeof p === "string" && p.startsWith("/")) {
    return absUrl(`/api/plex/image?path=${encodeURIComponent(p)}`);
  }
  return absUrl(`/api/plex/image?u=${encodeURIComponent(p)}`);
}
function posterImg(src, alt = "", w = 36, h = 54) {
  return `<img src="${src}" alt="${htmlEscape(alt)}" style="width:${w}px;height:${h}px;object-fit:cover;border-radius:6px;margin-right:10px;border:1px solid #e5e7eb" />`;
}
function platformIconUrl(nameRaw = "") {
  const base = absUrl("/assets/platforms");
  const s = String(nameRaw).toLowerCase();
  if (s.includes("tvos") || s.includes("apple tv")) return `${base}/atv.png`;
  if (s.includes("android tv")) return `${base}/androidtv.png`;
  if (s.includes("android")) return `${base}/android.png`;
  if (s.includes("roku")) return `${base}/roku.png`;
  if (s.includes("fire tv") || s.includes("firetv")) return `${base}/firetv.png`;
  if (s.includes("samsung") || s.includes("tizen")) return `${base}/samsung.png`;
  if (s.includes("lg")) return `${base}/lg.png`;
  if (s.includes("xbox")) return `${base}/xbox.png`;
  if (s.includes("playstation") || s.includes("ps4") || s.includes("ps5")) return `${base}/playstation.png`;
  if (s.includes("windows")) return `${base}/windows.png`;
  if (s.includes("ios")) return `${base}/ios.png`;
  if (s.includes("mac")) return `${base}/macos.png`;
  if (s.includes("linux")) return `${base}/linux.png`;
  if (s.includes("chrome")) return `${base}/chrome.png`;
  if (s.includes("safari")) return `${base}/safari.png`;
  if (s.includes("edge")) return `${base}/edge.png`;
  if (s.includes("web")) return `${base}/web.png`;
  return `${base}/generic.png`;
}
function platformDisplayName(nameRaw = "") {
  const s = String(nameRaw).toLowerCase();
  if (s.includes("tvos") || s.includes("apple tv")) return "Apple TV";
  if (s.includes("tizen") || s.includes("samsung")) return "Samsung TV";
  if (s.includes("roku")) return "Roku";
  if (s.includes("android tv")) return "Android TV";
  if (s === "android") return "Plex App (Android)";
  if (s.includes("ios")) return "Plex App (iOS)";
  if (s.includes("windows")) return "Windows";
  if (s.includes("mac")) return "macOS";
  if (s.includes("linux")) return "Linux";
  if (s.includes("chrome")) return "Chrome";
  if (s.includes("safari")) return "Safari";
  if (s.includes("edge")) return "Edge";
  if (s.includes("firefox")) return "Firefox";
  if (s.includes("fire tv") || s.includes("firetv")) return "Fire TV";
  if (s.includes("lg")) return "LG TV";
  if (s.includes("playstation") || s.includes("ps4") || s.includes("ps5")) return "PlayStation";
  if (s.includes("xbox")) return "Xbox";
  if (s.includes("web")) return "Web App";
  return "Other";
}
function rowType(row) {
  return String(row?.media_type || row?.type || row?.section_type || "").toLowerCase();
}

/* -------- app.plex.tv link helpers -------- */
async function buildAppPlexHref(ratingKey) {
  if (ratingKey == null) return null;
  try {
    const r = await fetch(absUrl("/api/plex/server-id"));
    if (!r.ok) return null;
    const j = await r.json();
    const sid = j?.machineIdentifier;
    if (!sid) return null;
    const key = `/library/metadata/${encodeURIComponent(String(ratingKey))}`;
    return `https://app.plex.tv/desktop/#!/server/${encodeURIComponent(sid)}/details?key=${encodeURIComponent(key)}`;
  } catch {
    return null;
  }
}
async function absolutizePlexHref(href, ratingKey) {
  const h = String(href || "");
  if (h.startsWith("http://") || h.startsWith("https://")) return h;
  const built = await buildAppPlexHref(ratingKey);
  return built || null;
}

/** Replace any/all occurrences of a list of tokens with provided html */
function replaceAnyToken(html, tokens, replacementHtml) {
  let out = html;
  for (const t of tokens) {
    if (out.includes(t)) out = out.replaceAll(t, replacementHtml);
  }
  return out;
}

/** Token aliases we’ll honor for Host Recommendation */
const OWNER_REC_TOKENS = [
  "{{CARD_OWNER_RECOMMENDATION}}",
  "{{CARD_HOST_RECOMMENDATION}}",
  "{{HOST_RECOMMENDATION}}",
  "{{HOSTS_RECOMMENDATION}}",
];

/** Tautulli home summary (days lookback) */
async function getHomeSummary(days) {
  try {
    const r = await fetch(absUrl(`/api/tautulli/summary?days=${encodeURIComponent(days)}`));
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}
function pickRows(blocks, ids) {
  const list = Array.isArray(blocks) ? blocks : [];
  for (const b of list) {
    const id = String(b?.stat_id || "");
    if (ids.includes(id)) return Array.isArray(b?.rows) ? b.rows : [];
  }
  return [];
}

/** Owner recommendation from CONFIG + plex item lookup */
async function buildOwnerRecommendationHtml() {
  const id = CONFIG?.ownerRecommendation?.plexItemId;
  const note = typeof CONFIG?.ownerRecommendation?.note === "string" ? CONFIG.ownerRecommendation.note : "";

  if (!id) {
    const body = note ? `<div>${htmlEscape(note)}</div>` : `<div style="opacity:.7">No item selected.</div>`;
    return cardHtml("Host’s Recommendation", body);
  }

  try {
    const r = await fetch(`http://localhost:3001/api/plex/item/${encodeURIComponent(String(id))}`);
    if (r.ok) {
      const j = await r.json();
      const item = j?.item || null;
      if (item) {
        const title = item.title || item.grandparentTitle || "Title";
        const year = item.year ? ` (${item.year})` : "";
        const hrefLocal = item.webHref || item.deepLink || item.href || null;
        const href = (await absolutizePlexHref(hrefLocal, id)) || "#";
        const pSrc = posterFrom(item);
        const img = pSrc ? posterImg(pSrc, title, 96, 144) : "";
        const info =
          `<div><a href="${href}" target="_blank" rel="noreferrer" style="text-decoration:none;color:#93c5fd"><strong>${htmlEscape(title)}${year}</strong></a>` +
          (note ? `<div style="margin-top:6px">${htmlEscape(note)}</div>` : "") +
          `</div>`;
        const body = `<div style="display:flex;align-items:flex-start">${img}${info}</div>`;
        return cardHtml("Host’s Recommendation", body);
      }
    }
  } catch {}
  const fallback = note ? `<div>${htmlEscape(note)}</div>` : `<div style="opacity:.7">Could not load item.</div>`;
  return cardHtml("Host’s Recommendation", fallback);
}

/** Expand tokens into full HTML */
async function renderTemplate(html, historyDays) {
  let out = String(html || "");
  const days = Math.max(1, Number(historyDays || CONFIG.lookbackDays || 7));
  const homeSummary = await getHomeSummary(days);

  // Host Recommendation
  if (OWNER_REC_TOKENS.some((t) => out.includes(t))) {
    const block = await buildOwnerRecommendationHtml();
    out = replaceAnyToken(out, OWNER_REC_TOKENS, block);
  }

  const blocks = Array.isArray(homeSummary?.home) ? homeSummary.home : [];
  const totals = homeSummary?.totals || {};

  // CARD_MOST_WATCHED_MOVIES
  if (out.includes("{{CARD_MOST_WATCHED_MOVIES}}")) {
    const rows = pickRows(blocks, ["top_movies", "most_watched_movies"]);
    const items = rows
      .filter((r) => rowType(r) === "movie")
      .map((r) => ({ title: r?.title || "Untitled", year: r?.year, plays: Number(r?.total_plays || r?.plays || 0), poster: posterFrom(r) }))
      .sort((a, b) => b.plays - a.plays)
      .slice(0, 5);
    const body = items.length
      ? `<ol style="margin:0;padding-left:18px">${items
          .map((x) => `<li style="display:flex;align-items:center;margin:6px 0;">${x.poster ? posterImg(x.poster, x.title) : ""}<div>${htmlEscape(x.title)}${x.year ? ` (${x.year})` : ""}<div style="opacity:.7;font-size:12px">${x.plays} plays</div></div></li>`)
          .join("")}</ol>`
      : `<div style="opacity:.7">No data</div>`;
    out = out.replaceAll("{{CARD_MOST_WATCHED_MOVIES}}", cardHtml("Most Watched Movies", body));
  }

  // CARD_MOST_WATCHED_SHOWS
  if (out.includes("{{CARD_MOST_WATCHED_SHOWS}}")) {
    const rows = pickRows(blocks, ["top_tv", "most_watched_tv_shows", "most_watched_tv"]);
    const items = rows
      .map((r) => ({ title: r?.grandparent_title || r?.title || "TV Show", plays: Number(r?.total_plays || r?.plays || 0), poster: posterFrom(r) }))
      .sort((a, b) => b.plays - a.plays)
      .slice(0, 5);
    const body = items.length
      ? `<ol style="margin:0;padding-left:18px">${items
          .map((x) => `<li style="display:flex;align-items:center;margin:6px 0;">${x.poster ? posterImg(x.poster, x.title) : ""}<div>${htmlEscape(x.title)}<div style="opacity:.7;font-size:12px">${x.plays} plays</div></div></li>`)
          .join("")}</ol>`
      : `<div style="opacity:.7">No data</div>`;
    out = out.replaceAll("{{CARD_MOST_WATCHED_SHOWS}}", cardHtml("Most Watched TV Shows", body));
  }

  // CARD_MOST_WATCHED_EPISODES
  if (out.includes("{{CARD_MOST_WATCHED_EPISODES}}")) {
    const rows = pickRows(blocks, ["top_tv", "most_watched_tv_shows", "most_watched_tv"]);
    const items = rows
      .filter((r) => ["episode", "season", "show"].includes(rowType(r)))
      .map((r) => {
        const show = r?.grandparent_title || r?.title || "Show";
        const title = r?.title && r?.grandparent_title ? `${show} — ${r.title}` : show;
        return { title, plays: Number(r?.total_plays || r?.plays || 0), poster: posterFrom(r) };
      })
      .sort((a, b) => b.plays - a.plays)
      .slice(0, 5);
    const body = items.length
      ? `<ol style="margin:0;padding-left:18px">${items
          .map((x) => `<li style="display:flex;align-items:center;margin:6px 0;">${x.poster ? posterImg(x.poster, x.title) : ""}<div>${htmlEscape(x.title)}<div style="opacity:.7;font-size:12px">${x.plays} plays</div></div></li>`)
          .join("")}</ol>`
      : `<div style="opacity:.7">No data</div>`;
    out = out.replaceAll("{{CARD_MOST_WATCHED_EPISODES}}", cardHtml("Most Watched Episodes", body));
  }

  // CARD_POPULAR_MOVIES
  if (out.includes("{{CARD_POPULAR_MOVIES}}")) {
    const rows = pickRows(blocks, ["popular_movies"]);
    const items = rows
      .filter((r) => rowType(r) === "movie")
      .map((r) => ({ title: r?.title || "Untitled", year: r?.year, users: Number(r?.users_watched || r?.unique_users || 0), poster: posterFrom(r) }))
      .sort((a, b) => b.users - a.users)
      .slice(0, 5);
    const body = items.length
      ? `<ol style="margin:0;padding-left:18px">${items
          .map((x) => `<li style="display:flex;align-items:center;margin:6px 0;">${x.poster ? posterImg(x.poster, x.title) : ""}<div>${htmlEscape(x.title)}${x.year ? ` (${x.year})` : ""}<div style="opacity:.7;font-size:12px">${x.users} unique viewers</div></div></li>`)
          .join("")}</ol>`
      : `<div style="opacity:.7">No data</div>`;
    out = out.replaceAll("{{CARD_POPULAR_MOVIES}}", cardHtml("Most Popular Movies", body));
  }

  // CARD_POPULAR_SHOWS
  if (out.includes("{{CARD_POPULAR_SHOWS}}")) {
    const rows = pickRows(blocks, ["popular_tv", "popular_shows"]);
    const items = rows
      .map((r) => ({ title: r?.grandparent_title || r?.title || "TV Show", users: Number(r?.users_watched || r?.unique_users || 0), poster: posterFrom(r) }))
      .sort((a, b) => b.users - a.users)
      .slice(0, 5);
    const body = items.length
      ? `<ol style="margin:0;padding-left:18px">${items
          .map((x) => `<li style="display:flex;align-items:center;margin:6px 0;">${x.poster ? posterImg(x.poster, x.title) : ""}<div>${htmlEscape(x.title)}<div style="opacity:.7;font-size:12px">${x.users} unique viewers</div></div></li>`)
          .join("")}</ol>`
      : `<div style="opacity:.7">No data</div>`;
    out = out.replaceAll("{{CARD_POPULAR_SHOWS}}", cardHtml("Most Popular TV Shows", body));
  }

  // CARD_POPULAR_PLATFORMS
  if (out.includes("{{CARD_POPULAR_PLATFORMS}}")) {
    const rows = pickRows(blocks, ["top_platforms", "most_used_platforms", "top_clients"]);
    const items = rows
      .map((r) => ({
        name: r?.platform || r?.label || "Platform",
        plays: Number(r?.total_plays || r?.plays || 0),
      }))
      .filter((x) => x.name && Number.isFinite(x.plays))
      .sort((a, b) => b.plays - a.plays)
      .slice(0, 6);

    const body = items.length
      ? `<ul style="list-style:none;padding:0;margin:0">
          ${items
            .map((x) => {
              const icon = platformIconUrl(x.name);
              return `<li style="display:flex;align-items:center;gap:10px;margin:8px 0;">
                        <img src="${icon}" alt="${htmlEscape(x.name)}" width="20" height="20" style="width:20px;height:20px;object-fit:contain;border-radius:4px;border:1px solid #e5e7eb;flex-shrink:0" />
                        <span style="flex:1;min-width:0">${htmlEscape(platformDisplayName(x.name))}</span>
                        <span style="opacity:.7">${x.plays} plays</span>
                      </li>`;
            })
            .join("")}
        </ul>`
      : `<div style="opacity:.7">No data</div>`;

    out = out.replaceAll("{{CARD_POPULAR_PLATFORMS}}", cardHtml("Most Popular Streaming Platforms", body));
  }

  // CARD_SERVER_TOTALS
  if (out.includes("{{CARD_SERVER_TOTALS}}")) {
    const totalsSafe = homeSummary && typeof homeSummary === "object" ? (homeSummary.totals || {}) : {};
    const moviesStreamed   = Number.isFinite(Number(totalsSafe.movies)) ? Number(totalsSafe.movies) : 0;
    const episodesStreamed = Number.isFinite(Number(totalsSafe.episodes)) ? Number(totalsSafe.episodes) : 0;
    const secRaw           = Number.isFinite(Number(totalsSafe.total_time_seconds)) ? Number(totalsSafe.total_time_seconds) : 0;

    const hours   = Math.floor(secRaw / 3600);
    const minutes = Math.floor((secRaw % 3600) / 60);
    const timeStr = formatHm(hours, minutes);

    // Try to extract library totals from Tautulli blocks
    let moviesTotal = null, showsTotal = null, episodesTotal = null;
    const blocksLocal = Array.isArray(homeSummary?.home) ? homeSummary.home : [];
    const coerceNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
    const readMaybe = (obj, keys) => { for (const k of keys) { if (obj && obj[k] != null) { const n = coerceNum(obj[k]); if (n != null) return n; } } return null; };

    for (const b of blocksLocal) {
      const rows = Array.isArray(b?.rows) ? b.rows : [];
      for (const r of rows) {
        if (moviesTotal   == null) moviesTotal   = readMaybe(r, ["total_movies", "movies", "movie_count", "count_movies"]);
        if (showsTotal    == null) showsTotal    = readMaybe(r, ["total_tv_shows", "tv_shows", "shows", "show_count", "count_shows"]);
        if (episodesTotal == null) episodesTotal = readMaybe(r, ["total_episodes", "episodes", "episode_count", "count_episodes"]);
      }
    }
    if (moviesTotal == null || showsTotal == null || episodesTotal == null) {
      for (const b of blocksLocal) {
        if (moviesTotal   == null) moviesTotal   = readMaybe(b, ["total_movies", "movies", "movie_count", "count_movies"]);
        if (showsTotal    == null) showsTotal    = readMaybe(b, ["total_tv_shows", "tv_shows", "shows", "show_count", "count_shows"]);
        if (episodesTotal == null) episodesTotal = readMaybe(b, ["total_episodes", "episodes", "episode_count", "count_episodes"]);
      }
    }

    // Fallback to Plex if any are missing or zero
    if (!(moviesTotal > 0 && showsTotal > 0 && episodesTotal > 0)) {
      try {
        const plexTotals = await fetchPlexLibraryTotals();
        if (moviesTotal   == null || moviesTotal   === 0) moviesTotal   = plexTotals.moviesTotal;
        if (showsTotal    == null || showsTotal    === 0) showsTotal    = plexTotals.showsTotal;
        if (episodesTotal == null || episodesTotal === 0) episodesTotal = plexTotals.episodesTotal;
      } catch {}
    }

    // Final safety
    moviesTotal   = moviesTotal   ?? 0;
    showsTotal    = showsTotal    ?? 0;
    episodesTotal = episodesTotal ?? 0;

    const ds = ` (Last ${days} Days)`;
    const body = `
      <ul style="margin:0;padding-left:18px">
        ${li("🎬 Movies Streamed" + ds, formatInt(moviesStreamed))}
        ${li("📺 TV Episodes Streamed" + ds, formatInt(episodesStreamed))}
        ${li("🕰️ Time Streamed" + ds, timeStr)}
      </ul>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:8px 0" />
      <ul style="margin:0;padding-left:18px">
        ${li("🎥 Movies (Entire Library)", formatInt(moviesTotal))}
        ${li("📺 TV Series (Entire Library)", formatInt(showsTotal))}
        ${li("🎞️ TV Episodes (Entire Library)", formatInt(episodesTotal))}
      </ul>`;

    out = out.replaceAll("{{CARD_SERVER_TOTALS}}", cardHtml("Plex Media Server Totals", body));
  }

  // RECENT MOVIES
  if (out.includes("{{CARD_RECENT_MOVIES}}")) {
    const daysLocal = Math.max(1, Number(historyDays || CONFIG.lookbackDays || 7));
    let rows = [];
    try {
      const r = await fetch(
        absUrl(`/api/tautulli/recent?type=movie&days=${encodeURIComponent(daysLocal)}&limit=20`)
      );
      if (r.ok) {
        const j = await r.json();
        rows = Array.isArray(j?.rows) ? j.rows : [];
      }
    } catch {}

    const baseItems = rows.slice(0, 8).map((r) => ({
      id: r?.rating_key || r?.ratingKey || r?.id,
      title: r?.title || "Untitled",
      year: r?.year,
      poster: posterFrom(r),
      href: r?.webHref || r?.deepLink || r?.href || null,
      summary: r?.summary || r?.plot || r?.tagline || "",
    }));

    await Promise.all(
      baseItems.map(async (it) => {
        if ((!it.href || !it.summary) && it.id != null) {
          try {
            const rr = await fetch(absUrl(`/api/plex/item/${encodeURIComponent(String(it.id))}`));
            if (rr.ok) {
              const jj = await rr.json().catch(() => null);
              const item = jj?.item;
              if (item) {
                if (!it.href) it.href = item.webHref || item.deepLink || item.href || null;
                if (!it.summary) it.summary = item.summary || item.plot || item.tagline || "";
              }
            }
          } catch {}
        }
        it.href = await absolutizePlexHref(it.href, it.id);
      })
    );

    const truncate = (s, n = 420) => {
      const t = String(s || "");
      return t.length > n ? t.slice(0, n - 1) + "…" : t;
    };

    const grid = baseItems.length
      ? `<div style="display:flex;flex-direction:column;gap:14px">
           ${baseItems
             .map((x) => {
               const img = x.poster ? posterImg(x.poster, x.title, 96, 144) : "";
               const titleHtml = x.href
                 ? `<a href="${x.href}" target="_blank" rel="noreferrer" style="text-decoration:none;color:#93c5fd;font-size:14px;font-weight:600;display:block;margin-bottom:6px">
                      ${htmlEscape(x.title)}${x.year ? ` (${x.year})` : ""}
                    </a>`
                 : `<div style="font-size:14px;font-weight:600;margin-bottom:6px">${htmlEscape(x.title)}${x.year ? ` (${x.year})` : ""}</div>`;
               const left = `<div style="width:110px;flex-shrink:0">${img}</div>`;
               const right = `<div style="flex:1;min-width:0;font-size:13px;line-height:1.45">
                                ${titleHtml}
                                ${htmlEscape(truncate(x.summary || "No description available.", 420))}
                              </div>`;
               return `<div style="display:flex;gap:14px;align-items:flex-start">${left}${right}</div>`;
             })
             .join("")}
         </div>`
      : `<div style="opacity:.75">No recent movies in the last ${daysLocal} days.</div>`;

    out = out.replaceAll("{{CARD_RECENT_MOVIES}}", cardHtml("Recently added Movies", grid));
  }

  // RECENT EPISODES
  if (out.includes("{{CARD_RECENT_EPISODES}}")) {
    const daysLocal = Math.max(1, Number(historyDays || CONFIG.lookbackDays || 7));

    let rows = [];
    try {
      const r = await fetch(
        absUrl(`/api/tautulli/recent?type=episode&days=${encodeURIComponent(daysLocal)}&limit=50`)
      );
      if (r.ok) {
        const j = await r.json();
        rows = Array.isArray(j?.rows) ? j.rows : [];
      }
    } catch {}

    const toIntOrNull = (v) => {
      const n = parseInt(v, 10);
      return Number.isFinite(n) ? n : null;
    };

    const bySeries = new Map();
    for (const r of rows) {
      const seriesTitleRaw = String(r?.grandparent_title || r?.title || "Series").trim();
      if (/^jeopardy!?$/i.test(seriesTitleRaw)) continue;

      const year = r?.grandparent_year || r?.year || null;
      const seriesKey = `${seriesTitleRaw}::${year || ""}`;

      const poster = posterFrom({
        grandparentThumb: r?.grandparent_thumb || r?.grandparentThumb,
        poster: r?.grandparent_poster || r?.poster || null,
      });

      if (!bySeries.has(seriesKey)) {
        bySeries.set(seriesKey, {
          title: seriesTitleRaw,
          year: year ? Number(year) : null,
          poster,
          episodes: [],
        });
      }

      const group = bySeries.get(seriesKey);
      group.episodes.push({
        id: r?.rating_key || r?.ratingKey || r?.id,
        season:
          toIntOrNull(r?.parent_index) ??
          toIntOrNull(r?.parentIndex) ??
          toIntOrNull(r?.parent_media_index) ??
          toIntOrNull(r?.seasonIndex) ??
          toIntOrNull(r?.season) ??
          null,
        ep:
          toIntOrNull(r?.index) ??
          toIntOrNull(r?.episode) ??
          toIntOrNull(r?.media_index) ??
          toIntOrNull(r?.episodeIndex) ??
          null,
        name: r?.title || "Episode",
        href: r?.webHref || r?.deepLink || r?.href || null,
      });
    }

    const seriesList = [...bySeries.values()];
    await Promise.all(
      seriesList.map(async (s) => {
        await Promise.all(
          s.episodes.map(async (e) => {
            e.href = await absolutizePlexHref(e.href, e.id);
          })
        );
      })
    );

    const makeTwoDigits = (n) => (n == null ? "??" : String(n).padStart(2, "0"));

    const grid = seriesList.length
      ? `<div style="display:flex;flex-direction:column;gap:16px">
           ${seriesList
             .map((s) => {
               const left = s.poster
                 ? `<div style="width:110px;flex-shrink:0">${posterImg(s.poster, s.title, 96, 144)}</div>`
                 : `<div style="width:110px;flex-shrink:0"></div>`;
               const header = `<div style="font-size:14px;font-weight:600;margin-bottom:6px">${htmlEscape(s.title)}${s.year ? ` (${s.year})` : ""}</div>`;
               const lines = s.episodes.slice(0, 5).map((e) => {
                 const label = `Season ${makeTwoDigits(e.season)}, Episode ${makeTwoDigits(e.ep)} — ${htmlEscape(e.name)}`;
                 return e.href
                   ? `<div><a href="${e.href}" target="_blank" rel="noreferrer" style="text-decoration:none;color:#93c5fd">${label}</a></div>`
                   : `<div>${label}</div>`;
               }).join("");
               const more = s.episodes.length > 5 ? `<div style="opacity:.7;margin-top:4px">And more…</div>` : "";
               const right = `<div style="flex:1;min-width:0;font-size:13px;line-height:1.45">${header}${lines}${more}</div>`;
               return `<div style="display:flex;gap:14px;align-items:flex-start">${left}${right}</div>`;
             })
             .join("")}
         </div>`
      : `<div style="opacity:.75">No recent TV episodes in the last ${daysLocal} days.</div>`;

    out = out.replaceAll("{{CARD_RECENT_EPISODES}}", cardHtml("Recently added TV Episodes", grid));
  }

  return out;
}

/* =============================== SCHEDULER ================================ */
let SCHEDULER_TIMER = null;
let LAST_SNAPSHOT = [];
function getScheduledJobsSnapshot() {
  const list = loadNewslettersSafe();
  const items = list
    .filter((n) => n.enabled && n.schedule)
    .map((n) => ({
      id: n.id,
      name: n.name,
      frequency: n.schedule?.cron ? `cron:${n.schedule.cron}` : (n.schedule?.frequency || "none"),
      next: "(computed on tick)",
      lastSentAt: n.lastSentAt || null,
      recipients: Array.isArray(n.recipients) ? n.recipients.length : 0,
      templateId: n.templateId || null,
    }));
  LAST_SNAPSHOT = items;
  return items;
}
function restartScheduler() {
  if (SCHEDULER_TIMER) clearInterval(SCHEDULER_TIMER);
  SCHEDULER_TIMER = setInterval(async () => {
    try { await schedulerTick(); } catch (e) { console.error("[scheduler] tick error:", e); }
  }, 30 * 1000);
  console.log("[scheduler] restarted");
  getScheduledJobsSnapshot();
}
restartScheduler();

function nowParts() {
  const d = new Date();
  return { m: d.getMinutes(), h: d.getHours(), dow: d.getDay(), dom: d.getDate(), mon: d.getMonth(), ms: d.getTime() };
}
const DOW_MAP = { sunday:0, monday:1, tuesday:2, wednesday:3, thursday:4, friday:5, saturday:6 };

function matchCronField(field, value) {
  if (field === "*") return true;
  return field.split(",").some((tok) => Number(tok) === value);
}
function isDueCron(expr) {
  const parts = String(expr || "").trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [m, h, dom, mon, dow] = parts;
  const p = nowParts();
  const cronDow = (x) => (x === 7 ? 0 : x);
  const dowOk =
    dow === "*" || dow.split(",").some((tok) => cronDow(Number(tok)) === p.dow);
  return (
    matchCronField(m, p.m) &&
    matchCronField(h, p.h) &&
    matchCronField(dom, p.dom) &&
    matchCronField(mon, p.mon + 1) &&
    dowOk
  );
}
function isDueStd(s) {
  const p = nowParts();
  const minuteMatch = typeof s.minute === "number" ? s.minute === p.m : p.m === 0;
  const hourMatch = typeof s.hour === "number" ? s.hour === p.h : true;
  const freq = String(s.frequency || "").toLowerCase();
  if (freq === "hour") return minuteMatch;
  if (freq === "day") return minuteMatch && hourMatch;
  if (freq === "week") {
    const want = DOW_MAP[(s.dayOfWeek || "monday").toLowerCase()] ?? 1;
    return p.dow === want && minuteMatch && hourMatch;
  }
  if (freq === "month") {
    const dom = typeof s.dayOfMonth === "number" ? s.dayOfMonth : 1;
    return p.dom === dom && minuteMatch && hourMatch;
  }
  if (freq === "year") {
    const mon = typeof s.month === "number" ? s.month : 0;
    return p.mon === mon && p.dom === 1 && minuteMatch && hourMatch;
  }
  return false;
}
function isDue(s) {
  if (!s) return false;
  if (s.cron && String(s.cron).trim()) return isDueCron(s.cron);
  return isDueStd(s);
}
function wasJustSent(n, nowMs) {
  const last = Number(n.lastSentAt || 0);
  return nowMs - last < 2 * 60 * 1000;
}
async function schedulerTick() {
  const list = loadNewslettersSafe();
  if (!Array.isArray(list) || list.length === 0) return;
  const now = nowParts();
  for (const n of list) {
    if (!n?.enabled || !n?.schedule) continue;
    if (wasJustSent(n, now.ms)) continue;
    if (isDue(n.schedule)) {
      try {
        console.log(`[scheduler] due -> ${n.name} (${n.id})`);
        const sent = await sendNewsletter(n);
        if (sent) {
          n.lastSentAt = Date.now();
          saveNewslettersSafe(list);
        }
      } catch (e) {
        console.error(`[scheduler] send failed for ${n.id}:`, e?.message || e);
      }
    }
  }
}

/* =============================== SENDING ================================== */
async function sendNewsletter(nl, { manual = false } = {}) {
  const toList = Array.isArray(nl.recipients) ? nl.recipients.filter(isEmail) : [];
  if (toList.length === 0) {
    console.log("[send] skipping — no recipients selected");
    return false;
  }
  const templates = loadTemplatesSafe();
  const tpl = templates.find((t) => t.id === nl.templateId);
  const rawHtml = tpl?.html || "<div style='opacity:.7'>No template selected.</div>";

  const historyDays = typeof nl.historyDays === "number" ? nl.historyDays : CONFIG.lookbackDays || 7;
  const builtHtml = await renderTemplate(rawHtml, historyDays);

  // >>> Subject uses newsletter.subject if present <<<
  const subject = (typeof nl.subject === "string" && nl.subject.trim())
    ? nl.subject.trim()
    : `Newsletter: ${nl.name || "Untitled"}`;

  const fromAddr = CONFIG.fromAddress || CONFIG.smtpUser;
  if (!fromAddr) {
    console.error("[send] missing fromAddress in config");
    return false;
  }

  const transport = nodemailer.createTransport(smtpTransportOptions(CONFIG));
  try {
    await transport.verify();
  } catch (e) {
    console.error("[send] SMTP verify failed:", e?.message || e);
    return false;
  }

  const info = await transport.sendMail({
    from: fromAddr,
    to: toList.join(","),
    subject,
    html: `
      <div style="font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5">
        ${builtHtml}
      </div>`,
  });

  console.log("[send] ok:", info.messageId);
  return true;
}

/* ----------------------- Newsletters: send-now (POST) ---------------------- */
app.post("/api/newsletters/:id/send-now", async (req, res) => {
  try {
    const id = String(req.params.id || "unknown");
    const body = req.body || {};

    if (!CONFIG.smtpHost || !CONFIG.smtpPort || !CONFIG.fromAddress) {
      return res.status(400).json({
        ok: false,
        error: "SMTP is not configured. Set smtpHost/smtpPort/fromAddress via /api/config.",
      });
    }

    // Load this newsletter so we can default recipients/subject/content from it
    const newsletters = loadNewslettersSafe();
    const nl = newsletters.find((x) => x.id === id) || {};

    const normalizeList = (v) =>
      (Array.isArray(v) ? v : (typeof v === "string" ? v.split(",") : []))
        .map((s) => String(s || "").trim().toLowerCase())
        .filter((s) => isEmail(s));

    // 1) Recipients: prefer explicit body, then newsletter.recipients; **NO** global fallback
    let toList = normalizeList(body.to);
    let bccList = normalizeList(body.bcc);

    if (toList.length === 0 && bccList.length === 0) {
      const fromNl = Array.isArray(nl.recipients) ? nl.recipients : [];
      toList = fromNl
        .map((e) => String(e || "").trim().toLowerCase())
        .filter((e) => isEmail(e));
    }

    if (toList.length === 0 && bccList.length === 0) {
      return res.status(400).json({ ok: false, error: "No recipients selected for this newsletter." });
    }

    // 2) Subject: body.subject > nl.subject > fallback
    const subject = String(body.subject || nl.subject || `Newsletter: ${nl.name || "Untitled"}`).trim();

    // 3) Content selection:
    //    - Default: ALWAYS render from the newsletter's template
    //    - If you explicitly want to send raw HTML/text, set body.raw === true
    const useRaw = body.raw === true || body.mode === "raw";

    const hasHtmlBody = typeof body.html === "string" && body.html.trim().length > 0;
    const hasTextBody = typeof body.text === "string" && body.text.trim().length > 0;

    let html;
    let text;

    if (useRaw && (hasHtmlBody || hasTextBody)) {
      html = hasHtmlBody ? body.html : undefined;
      text = hasTextBody ? body.text : undefined;
    } else {
      const templates = loadTemplatesSafe();
      const tpl = nl && nl.templateId ? templates.find((t) => t.id === nl.templateId) : null;
      const rawHtml = tpl?.html || "<div style='opacity:.7'>No template selected.</div>";
      const historyDays = typeof nl?.historyDays === "number" ? nl.historyDays : CONFIG.lookbackDays || 7;
      const builtHtml = await renderTemplate(rawHtml, historyDays);
      html = `
        <div style="font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5">
          ${builtHtml}
        </div>`;
    }

    const transport = nodemailer.createTransport(smtpTransportOptions(CONFIG));
    try { await transport.verify(); }
    catch (e) { return res.status(400).json({ ok: false, error: `SMTP verification failed: ${e?.message || e}` }); }

    // Safe To header: if only BCC, use configured From address
    const toHeader = toList.length ? toList.join(", ") : CONFIG.fromAddress;

    const msg = {
      from: CONFIG.fromAddress,
      to: toHeader,
      bcc: bccList.length ? bccList.join(", ") : undefined,
      subject,
      ...(html ? { html } : {}),
      ...(text ? { text } : {}),
      headers: { "X-Kunkflix-Newsletter-ID": id, "X-Kunkflix-Mode": useRaw ? "raw" : "template" },
    };

    if (body.dryRun) {
      return res.json({
        ok: true,
        dryRun: true,
        summary: { id, toCount: toList.length, bccCount: bccList.length, subject, mode: useRaw ? "raw" : "template" },
      });
    }

    const info = await transport.sendMail(msg);
    return res.json({
      ok: true,
      id,
      accepted: info.accepted || [],
      rejected: info.rejected || [],
      envelope: info.envelope || {},
      messageId: info.messageId || null,
      response: info.response || null,
      toCount: toList.length,
      bccCount: bccList.length,
      mode: useRaw ? "raw" : "template",
    });
  } catch (e) {
    console.error("[send-now] error:", e);
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

/* --------------------------------- start ---------------------------------- */
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`API listening on port ${PORT}`);
  console.log(`config.json -> ${CONFIG_PATH}`);
  console.log(`recipients.json -> ${RECIPIENTS_PATH}`);
  console.log(`emailtemplates.json -> ${TEMPLATES_PATH}`);
  console.log(`newsletters.json -> ${NEWSLETTERS_PATH}`);
});
