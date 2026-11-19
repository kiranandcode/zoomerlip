import { useState, useEffect, useRef } from "react";
import { ArrowRight, KeyRound, X } from "lucide-react";
import { Appearance } from "./Appearance";
import { login } from "../api";
import type { Account } from "../types";
export function Login({
  onLogin,
  onClose,
}: {
  onLogin: (account: Account) => void | Promise<void>;
  onClose?: () => void;
}) {
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const cancel = () => {
    pending.current?.abort();
    onClose?.();
  };
  const [appearance, setAppearance] = useState(false);
  const [useKey, setUseKey] = useState(false),
    [url, setUrl] = useState(""),
    [email, setEmail] = useState(""),
    [secret, setSecret] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="login-screen">
      <section className="login-story">
        <div className="wordmark">
          <img src="/logo.svg" alt="" />
          zoomerlip<span>FOR ZULIP</span>
        </div>
        <div className="story-copy">
          <div className="eyebrow">CHANNELS · THREADS · DMs</div>
          <h1>
            Zulip,
            <br />
            <span>a little more familiar.</span>
          </h1>
          <p>
            Keep your organisations together. Follow topics as threads and pick
            your own colours.
          </p>
          <div className="story-tags">
            <span># your-community</span>
            <span>↳ a conversation</span>
          </div>
        </div>
        <footer>
          <a
            href="https://github.com/kiranandcode/zoomerlip"
            target="_blank"
            rel="noopener noreferrer"
          >
            Source on GitHub
          </a>
        </footer>
      </section>
      {appearance && <Appearance onClose={() => setAppearance(false)} />}
      <section className="login-side">
        <button
          type="button"
          className="login-appearance"
          onClick={() => setAppearance(true)}
        >
          Appearance
        </button>
        <form
          className="login-card"
          onSubmit={async (event) => {
            event.preventDefault();
            pending.current?.abort();
            const controller = new AbortController();
            pending.current = controller;
            setBusy(true);
            setError("");
            try {
              const account = await login(
                url,
                email,
                secret,
                useKey,
                controller.signal,
              );
              if (!controller.signal.aborted) await onLogin(account);
            } catch (e) {
              if (controller.signal.aborted) return;
              setError(
                e instanceof TypeError
                  ? "Cannot reach this org. Check the URL, connection, and server CORS settings."
                  : (e as Error).message,
              );
            } finally {
              if (!controller.signal.aborted) setBusy(false);
            }
          }}
        >
          {onClose && (
            <button
              type="button"
              className="close icon-button"
              aria-label="Close login"
              onClick={cancel}
            >
              <X size={20} />
            </button>
          )}
          <div className="login-symbol">
            <KeyRound size={24} />
          </div>
          <h2>Sign in</h2>
          <p>Connect your Zulip organization.</p>
          <label>
            Organization URL
            <input
              required
              placeholder="https://your-team.zulipchat.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              autoComplete="url"
            />
          </label>
          <label>
            Email address
            <input
              required
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
            />
          </label>
          <div className="login-tabs">
            <button
              type="button"
              className={!useKey ? "active" : ""}
              aria-pressed={!useKey}
              disabled={busy}
              onClick={() => {
                setUseKey(false);
                setSecret("");
              }}
            >
              Password
            </button>
            <button
              type="button"
              className={useKey ? "active" : ""}
              aria-pressed={useKey}
              disabled={busy}
              onClick={() => {
                setUseKey(true);
                setSecret("");
              }}
            >
              API key / SSO
            </button>
          </div>
          <label>
            {useKey ? "API key" : "Password"}
            <input
              required
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              autoComplete={useKey ? "off" : "current-password"}
              placeholder={
                useKey ? "Paste your Zulip API key" : "Your Zulip password"
              }
            />
          </label>
          {useKey && (
            <small>
              Find your key in Zulip → Personal settings → Account & privacy →
              API key.
            </small>
          )}
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          <button className="primary connect" disabled={busy}>
            {busy ? "Connecting…" : "Let’s go"}
            <ArrowRight size={18} />
          </button>
          <p className="privacy">
            Connects directly to your org. API keys stay in this browser’s local
            storage. Passwords are never saved.
          </p>
        </form>
        <span className="independent">An independent Zulip client.</span>
      </section>
    </div>
  );
}
