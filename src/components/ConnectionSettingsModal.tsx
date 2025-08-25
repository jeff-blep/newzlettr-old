// src/components/ConnectionSettingsModal.tsx
import React, { useEffect, useState } from "react";
import { getConfig, postConfig, testPlex, testTautulli, testSmtp } from "../api";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
};

type Cfg = {
  plexUrl: string;
  plexToken: string;
  tautulliUrl: string;
  tautulliApiKey: string;

  fromAddress?: string;
  smtpEmailLogin?: string;
  smtpServer?: string;
  smtpPort?: number;
  smtpEncryption?: "TLS/SSL" | "STARTTLS" | "None";
};

export default function ConnectionSettingsModal({ isOpen, onClose, onSaved }: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<null | "plex" | "tautulli" | "smtp">(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Plex / Tautulli
  const [plexUrl, setPlexUrl] = useState("");
  const [plexToken, setPlexToken] = useState("");
  const [tautulliUrl, setTautulliUrl] = useState("");
  const [tautulliApiKey, setTautulliApiKey] = useState("");

  // SMTP
  const [smtpEmailLogin, setSmtpEmailLogin] = useState("");
  const [smtpEmailPassword, setSmtpEmailPassword] = useState("");
  const [smtpServer, setSmtpServer] = useState("");
  const [smtpPort, setSmtpPort] = useState(587);
  const [smtpEncryption, setSmtpEncryption] =
    useState<"TLS/SSL" | "STARTTLS" | "None">("TLS/SSL");
  const [fromAddress, setFromAddress] = useState("");
  const [sendTestTo, setSendTestTo] = useState("");

  // NEW: Track if a password already exists server-side (without revealing it)
  const [hasSavedPassword, setHasSavedPassword] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    (async () => {
      setLoading(true);
      setError(null);
      setNotice(null);
      try {
        const cfg = (await getConfig()) as Cfg;
        setPlexUrl(cfg.plexUrl || "");
        setPlexToken(cfg.plexToken || "");
        setTautulliUrl(cfg.tautulliUrl || "");
        setTautulliApiKey(cfg.tautulliApiKey || "");

        setFromAddress(cfg.fromAddress || "");
        setSmtpEmailLogin(cfg.smtpEmailLogin || "");
        setSmtpServer(cfg.smtpServer || "");
        setSmtpPort(typeof cfg.smtpPort === "number" ? cfg.smtpPort : 587);
        setSmtpEncryption(cfg.smtpEncryption || "TLS/SSL");

        // If we have enough SMTP fields to have previously worked, assume a password exists.
        // We do NOT read the password from the server for security.
        setHasSavedPassword(!!(cfg.smtpEmailLogin || cfg.smtpServer));
        setSmtpEmailPassword(""); // keep input blank; we only send if user types a new one
      } catch (e: any) {
        setError(e?.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [isOpen]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await postConfig({
        plexUrl,
        plexToken,
        tautulliUrl,
        tautulliApiKey,
        fromAddress,
        smtpEmailLogin,
        // Only send smtpEmailPassword if the user typed something.
        // If blank, backend keeps existing smtpPass in config.json.
        smtpEmailPassword: smtpEmailPassword.length > 0 ? smtpEmailPassword : undefined,
        smtpServer,
        smtpPort,
        smtpEncryption,
      });
      if (smtpEmailPassword.length > 0) {
        setHasSavedPassword(true);
        setSmtpEmailPassword(""); // clear the input after successful save
      }
      setNotice("Settings saved.");
      onSaved?.();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleTest(kind: "plex" | "tautulli" | "smtp") {
    setTesting(kind);
    setError(null);
    setNotice(null);
    try {
      if (kind === "plex") {
        const r = await testPlex({ plexUrl, plexToken });
        if (r?.ok) setNotice("Plex connection OK.");
        else throw new Error(r?.error || "Plex test failed");
      } else if (kind === "tautulli") {
        const r = await testTautulli({ tautulliUrl, tautulliApiKey });
        if (r?.ok) setNotice("Tautulli connection OK.");
        else throw new Error(r?.error || "Tautulli test failed");
      } else {
        const r = await testSmtp({
          smtpEmailLogin,
          // Only send a password for testing if user typed something; otherwise the server uses stored pass.
          smtpEmailPassword: smtpEmailPassword.length > 0 ? smtpEmailPassword : undefined,
          smtpServer,
          smtpPort,
          smtpEncryption,
          fromAddress,
          to: sendTestTo,
        } as any);
        if (r?.ok) setNotice("SMTP connection OK.");
        else throw new Error(r?.error || "SMTP test failed");
      }
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setTesting(null);
    }
  }

  async function handleSendTestEmail() {
    setTesting("smtp");
    setError(null);
    setNotice(null);
    try {
      const r = await testSmtp({
        smtpEmailLogin,
        smtpEmailPassword: smtpEmailPassword.length > 0 ? smtpEmailPassword : undefined,
        smtpServer,
        smtpPort,
        smtpEncryption,
        fromAddress,
        to: sendTestTo,
      } as any);
      if (r?.ok) setNotice("Sent test email (if server supports sending).");
      else throw new Error(r?.error || "Test email failed");
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setTesting(null);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-base-300/60 backdrop-blur-sm">
      <div className="w-full max-w-3xl rounded-xl shadow-xl bg-base-100 border border-base-300">
        {/* Header */}
        <div className="px-4 py-3 border-b border-base-300 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Connection Settings</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-8">
          {loading && <div>Loading…</div>}
          {notice && (
            <div className="p-2 rounded bg-green-500/15 text-green-700">{notice}</div>
          )}
          {error && (
            <div className="p-2 rounded bg-red-500/15 text-red-700">{error}</div>
          )}

          {/* SMTP (compact 2-col layout) */}
          <section className="space-y-3">
            <h3 className="font-semibold">SMTP</h3>

            {/* Row 1: Login | Password */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <input
                className="input input-bordered w-full"
                placeholder="Login (name@domain.com)"
                value={smtpEmailLogin}
                onChange={(e) => setSmtpEmailLogin(e.target.value)}
              />
              <input
                type="password"
                className="input input-bordered w-full"
                placeholder={hasSavedPassword ? "Password (saved)" : "Password"}
                value={smtpEmailPassword}
                onChange={(e) => setSmtpEmailPassword(e.target.value)}
              />
            </div>

            {/* Row 2: SMTP Server | Send As */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <input
                className="input input-bordered w-full"
                placeholder="SMTP Server (e.g. smtp.mail.com)"
                value={smtpServer}
                onChange={(e) => setSmtpServer(e.target.value)}
              />
              <input
                className="input input-bordered w-full"
                placeholder="Send As (From Address)"
                value={fromAddress}
                onChange={(e) => setFromAddress(e.target.value)}
              />
            </div>

            {/* Row 3: TLS/SSL | Port */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <select
                className="select select-bordered w-full"
                value={smtpEncryption}
                onChange={(e) => setSmtpEncryption(e.target.value as any)}
              >
                <option value="TLS/SSL">TLS/SSL</option>
                <option value="STARTTLS">STARTTLS</option>
                <option value="None">None</option>
              </select>
              <input
                type="number"
                className="input input-bordered w-full"
                placeholder="587"
                value={smtpPort}
                onChange={(e) => setSmtpPort(Number(e.target.value))}
              />
            </div>

            {/* Row 4: Buttons under TLS/SSL | Send Test To */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div>
                <button
                  className={`btn ${testing === "smtp" ? "btn-disabled" : "btn-primary"}`}
                  onClick={() => handleTest("smtp")}
                  disabled={testing === "smtp" || !sendTestTo}
                >
                  {testing === "smtp" ? "Testing…" : "Test SMTP"}
                </button>
              </div>

              <input
                className="input input-bordered w-full"
                placeholder="Send Test To (email)"
                value={sendTestTo}
                onChange={(e) => setSendTestTo(e.target.value)}
              />
            </div>
          </section>

          {/* Plex */}
          <section className="space-y-3">
            <h3 className="font-semibold">Plex</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <input
                className="input input-bordered w-full"
                placeholder="Plex URL (http://your-plex-host:32400)"
                value={plexUrl}
                onChange={(e) => setPlexUrl(e.target.value)}
              />
              <input
                className="input input-bordered w-full"
                placeholder="Plex Token"
                value={plexToken}
                onChange={(e) => setPlexToken(e.target.value)}
              />
            </div>
            <div className="flex flex-col md:flex-row gap-2">
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                className={`btn ${testing === "plex" ? "btn-disabled" : ""}`}
                onClick={() => handleTest("plex")}
                disabled={testing === "plex"}
              >
                {testing === "plex" ? "Testing…" : "Test Plex"}
              </button>
            </div>
          </section>

          {/* Tautulli */}
          <section className="space-y-3">
            <h3 className="font-semibold">Tautulli</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <input
                className="input input-bordered w-full"
                placeholder="Tautulli URL (http://your-tautulli-host:8181)"
                value={tautulliUrl}
                onChange={(e) => setTautulliUrl(e.target.value)}
              />
              <input
                className="input input-bordered w-full"
                placeholder="Tautulli API Key"
                value={tautulliApiKey}
                onChange={(e) => setTautulliApiKey(e.target.value)}
              />
            </div>
            <div className="flex flex-col md:flex-row gap-2">
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                className={`btn ${testing === "tautulli" ? "btn-disabled" : ""}`}
                onClick={() => handleTest("tautulli")}
                disabled={testing === "tautulli"}
              >
                {testing === "tautulli" ? "Testing…" : "Test Tautulli"}
              </button>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-base-300 flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save All"}
          </button>
        </div>
      </div>
    </div>
  );
}
