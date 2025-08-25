import { readFileSync } from "fs";
import { UndiciAgent, fetch as undiciFetch } from "undici";
import path from "path";
import url from "url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

function loadConfig() {
  // same place your other server code reads from
  const cfgPath = path.resolve(__dirname, "../../config/config.json");
  try {
    const raw = readFileSync(cfgPath, "utf8");
    const cfg = JSON.parse(raw || "{}");
    return cfg?.tautulli || {};
  } catch {
    return {};
  }
}

const AGENT = new UndiciAgent({
  // allow self-signed certs (Tautulli default)
  connect: { rejectUnauthorized: false },
});

export async function tCall(cmd, params = {}) {
  const { url: baseUrl, apiKey } = loadConfig();

  if (!baseUrl || !apiKey) {
    const e = new Error("Tautulli not configured (need tautulli.url and tautulli.apiKey in /config/config.json).");
    e.code = "TAUTULLI_MISCONFIGURED";
    throw e;
  }

  // Build URL (CherryPy’s /api/v2)
  const u = new URL("/api/v2", baseUrl);
  u.searchParams.set("apikey", apiKey);
  u.searchParams.set("cmd", cmd);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  }

  let res;
  try {
    res = await undiciFetch(u, { dispatcher: AGENT });
  } catch (err) {
    // surface connection resets / TLS issues clearly
    const e = new Error(`fetch failed: ${err?.message || err}`);
    e.cause = err;
    throw e;
  }

  if (!res.ok) {
    throw new Error(`Tautulli HTTP ${res.status}`);
  }

  const json = await res.json().catch(() => ({}));
  if (json?.response?.result !== "success") {
    const msg = json?.response?.message || "Tautulli API error";
    throw new Error(msg);
  }
  return json?.response?.data ?? json?.response ?? json;
}
