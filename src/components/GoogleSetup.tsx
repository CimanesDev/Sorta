"use client";
import { useState, useTransition } from "react";
import { connectGoogle, disconnectGoogle, syncGoogle } from "@/app/actions";

type Status = { connected: boolean; sheetUrl: string | null; syncedAt: string | null; error: string | null; syncing: boolean };

function ago(iso: string | null) {
  if (!iso) return "never";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return new Date(iso).toLocaleString();
}

export function GoogleSetup({ status, script, excelPath }: { status: Status; script: string; excelPath: string }) {
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function copy() {
    navigator.clipboard.writeText(script).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (status.connected)
    return (
      <>
        <section className="panel">
          <div className="panel-row">
            <div>
              <h2>
                <span className="dot" style={{ background: status.error ? "var(--danger)" : "var(--c-education)" }} />{" "}
                {status.error ? "Connected, but the last update failed" : "Connected"}
              </h2>
              <p className="muted" suppressHydrationWarning>
                {status.syncing ? "Updating now…" : `Last updated ${ago(status.syncedAt)}`}. The sheet updates by itself a few
                seconds after every change.
              </p>
              {(error ?? status.error) && <p className="error">{error ?? status.error}</p>}
            </div>
            <div className="panel-actions">
              {status.sheetUrl && (
                <a className="btn primary" href={status.sheetUrl} target="_blank" rel="noreferrer">
                  Open Google Sheet ↗
                </a>
              )}
              <button
                type="button"
                className="btn"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await syncGoogle();
                    setError(r.ok ? null : r.error ?? "Update failed.");
                  })
                }
              >
                {pending ? <span className="spinner tiny" /> : null} Update now
              </button>
            </div>
          </div>
        </section>
        <p className="note">
          Sent to Google: clinic and post codes, categories, who set them, the AI&apos;s confidence and short reason, and upload
          dates. <b>Not sent:</b> screenshots and the text read from posts. Those stay on this computer, in{" "}
          <span className="mono">{excelPath}</span>.
        </p>
        <button
          type="button"
          className="link-btn danger"
          onClick={() => {
            if (confirm("Stop updating the Google Sheet? The sheet itself is kept as it is.")) start(() => disconnectGoogle());
          }}
        >
          Disconnect
        </button>
      </>
    );

  return (
    <ol className="steps">
      <li>
        <h2>Create a blank Google Sheet</h2>
        <p>
          Go to{" "}
          <a href="https://sheets.new" target="_blank" rel="noreferrer">
            sheets.new
          </a>{" "}
          while signed in to the Google account that should own the results. Give it a name, for example{" "}
          <i>Post categories</i>. Keep it private (share it only with your research team).
        </p>
      </li>
      <li>
        <h2>Add the script</h2>
        <p>
          In the sheet, open <b>Extensions → Apps Script</b>. Delete everything in the editor, paste this script, and click the
          save icon.
        </p>
        <div className="code">
          <button type="button" className="btn small" onClick={copy}>
            {copied ? "✓ Copied" : "Copy script"}
          </button>
          <pre>{script}</pre>
        </div>
        <p className="muted small">The script contains a secret code so that only this website can write to your sheet.</p>
      </li>
      <li>
        <h2>Deploy it as a web app</h2>
        <p>
          Click <b>Deploy → New deployment</b>, then the gear icon → <b>Web app</b>. Set <b>Execute as: Me</b> and{" "}
          <b>Who has access: Anyone</b>, then <b>Deploy</b>. Google asks you to allow access the first time: choose your
          account → <i>Advanced</i> → <i>Go to project</i> → <i>Allow</i>. Copy the <b>Web app URL</b>.
        </p>
      </li>
      <li>
        <h2>Paste the link here</h2>
        <form
          className="connect"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await connectGoogle(url);
              setError(r.ok ? null : r.error ?? "Couldn't connect.");
            });
          }}
        >
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://script.google.com/macros/s/…/exec"
            required
            spellCheck={false}
          />
          <button type="submit" className="btn primary" disabled={pending || !url.trim()}>
            {pending ? (
              <>
                <span className="spinner tiny" /> Connecting…
              </>
            ) : (
              "Connect"
            )}
          </button>
        </form>
        {error && <p className="error">{error}</p>}
        <p className="muted small">Connecting fills the sheet straight away with everything sorted so far.</p>
      </li>
    </ol>
  );
}
