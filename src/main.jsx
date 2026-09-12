import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const AUTH_API_URL = import.meta.env.VITE_RAG_AUTH_URL || "http://localhost:3000";
const RASA_URL = import.meta.env.VITE_RASA_URL || "http://localhost:5005";
const USER_KEY = "markdown-rag-user-id";
const AUTH_KEY = "markdown-rag-auth";

function getStoredAuth() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_KEY)) || null;
  } catch {
    localStorage.removeItem(AUTH_KEY);
    return null;
  }
}

function getUserId() {
  const auth = getStoredAuth();
  if (auth?.user?.id) return auth.user.id;

  let userId = localStorage.getItem(USER_KEY);
  if (!userId) {
    userId = `browser-user-${crypto.randomUUID()}`;
    localStorage.setItem(USER_KEY, userId);
  }
  return userId;
}

async function authRequest(path, options = {}) {
  const storedToken = getStoredAuth()?.token || "";
  const response = await fetch(`${AUTH_API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(storedToken ? { Authorization: `Bearer ${storedToken}` } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed with status ${response.status}`);
  return data;
}

async function rasaMessage(sender, message) {
  const response = await fetch(`${RASA_URL}/webhooks/rest/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sender, message }),
  });
  const data = await response.json().catch(() => []);
  if (!response.ok) throw new Error(`Rasa request failed with status ${response.status}`);
  return Array.isArray(data) ? data : [];
}

function renderInlineMarkdown(text) {
  return String(text).split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    return part;
  });
}

function MarkdownMessage({ text }) {
  return String(text).split(/\r?\n/).map((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return <br key={index} />;

    const heading = trimmed.match(/^#{1,4}\s+(.+)$/);
    if (heading) return <h4 className="markdown-heading" key={index}>{renderInlineMarkdown(heading[1])}</h4>;

    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    if (bullet) return <p className="markdown-list-item" key={index}><span>•</span><span>{renderInlineMarkdown(bullet[1])}</span></p>;

    const numbered = trimmed.match(/^(\d+)\.\s+(.+)$/);
    if (numbered) return <p className="markdown-list-item" key={index}><span>{numbered[1]}.</span><span>{renderInlineMarkdown(numbered[2])}</span></p>;

    return <p key={index}>{renderInlineMarkdown(line)}</p>;
  });
}

function AuthScreen({ onAuthenticated, theme, onToggleTheme }) {
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const data = await authRequest(`/auth/${mode}`, { method: "POST", body: JSON.stringify({ name, email, password }) });
      localStorage.setItem(AUTH_KEY, JSON.stringify(data));
      localStorage.setItem(USER_KEY, data.user.id);
      onAuthenticated(data);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <button className="theme-toggle login-theme-toggle" type="button" onClick={onToggleTheme}>{theme === "dark" ? "☼ Light" : "☾ Dark"}</button>
      <section className="auth-intro"><div className="brand-mark">MR</div><p className="overline">A quieter way to read</p><h1>Your documents,<br /><em>understood.</em></h1><p className="intro-copy">Bring your markdown into one thoughtful workspace. Ask questions, find the details, and keep your attention on the work.</p><div className="intro-note"><span className="note-mark">⌁</span><span>Private by default<br /><small>Built for your local knowledge</small></span></div></section>
      <section className="auth-card"><div className="auth-card-top"><div><p className="overline">Welcome back</p><h2>{mode === "login" ? "Sign in to your workspace" : "Create your workspace"}</h2><p>{mode === "login" ? "Pick up where you left off." : "A small space for the things you are learning."}</p></div></div><button className="google-button" type="button" onClick={() => { window.location.href = `${AUTH_API_URL}/auth/google`; }}> <span className="google-g">G</span> Continue with Google</button><div className="auth-divider"><span>or use your email</span></div><form onSubmit={submit}>{mode === "signup" && <label>What should we call you<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" autoComplete="name" required /></label>}<label>Email address<input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" type="email" autoComplete="email" required /></label><label>Password<input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength="8" required /></label>{error && <div className="auth-error" role="alert">{error}</div>}<button className="primary-action" disabled={busy}>{busy ? "One moment..." : mode === "login" ? "Sign in" : "Create account"}<span>→</span></button></form><div className="auth-switch">{mode === "login" ? "New here?" : "Already have an account?"}<button type="button" onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); }}>{mode === "login" ? "Create an account" : "Sign in instead"}</button></div></section>
    </main>
  );
}

function Workspace({ auth, onLogout, theme, onToggleTheme }) {
  const [userId] = useState(getUserId);
  const [messages, setMessages] = useState([
    { role: "assistant", text: "Good to see you. Send a raw markdown URL, then ask me questions about it." },
  ]);
  const [question, setQuestion] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const displayName = auth?.user?.name || auth?.user?.email || "My account";

  async function sendToRasa(text, { showUser = true } = {}) {
    const cleanMessage = text.trim();
    if (!cleanMessage || busy) return;

    setError("");
    setQuestion("");
    if (showUser) setMessages((current) => [...current, { role: "user", text: cleanMessage }]);
    setBusy(true);

    try {
      const replies = await rasaMessage(userId, cleanMessage);
      if (!replies.length) {
        setMessages((current) => [...current, { role: "assistant", text: "Rasa did not return a message." }]);
        return;
      }

      const combinedReply = replies
        .map((reply) => reply.text || reply.image || "I received a response from Rasa, but it did not include displayable text.")
        .filter(Boolean)
        .join("\n\n");
      setMessages((current) => [...current, { role: "assistant", text: combinedReply }]);
    } catch (requestError) {
      setError("I could not reach Rasa. Make sure `rasa run --enable-api --cors \"*\"` is running on port 5005.");
    } finally {
      setBusy(false);
    }
  }

  async function loadUrl(event) {
    event.preventDefault();
    if (!url.trim()) return;
    const message = `load this document ${url.trim()}`;
    setUrl("");
    setPanelOpen(false);
    await sendToRasa(message);
  }

  const quickActions = [
    ["List", "list documents"],
    ["Summarize", "summarize current document"],
    ["Setup", "explain setup steps"],
    ["Commands", "extract commands"],
    ["Troubleshoot", "show troubleshooting steps"],
    ["Compare", "compare document 1 and document 2"],
  ];

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark">MR</div>
        <div><h1>Markdown RAG Assistant</h1></div>
        <div className="topbar-user">
          <button className="theme-toggle inline" type="button" onClick={onToggleTheme}>{theme === "dark" ? "☼" : "☾"}</button>
          <div className="account-menu">
            <button className="account-button" type="button" onClick={() => setAccountOpen((open) => !open)} aria-expanded={accountOpen}>{displayName}<span>⌄</span></button>
            {accountOpen && <div className="account-dropdown"><div><strong>{displayName}</strong>{auth?.user?.email && <small>{auth.user.email}</small>}</div><button type="button" onClick={onLogout}>Sign out</button></div>}
          </div>
        </div>
      </header>

      {error && <div className="error-banner" role="alert"><span>!</span><p>{error}</p><button type="button" onClick={() => setError("")}>Dismiss</button></div>}

      <div className="workspace rasa-workspace">
        <aside className="sidebar">
          <section className="active-card">
            <h2>Read markdown with context</h2>
            <p className="muted">Load a raw markdown source, then ask for summaries, setup steps, commands, troubleshooting help, or comparisons across loaded documents.</p>
          </section>

          <button className="upload-trigger" type="button" onClick={() => setPanelOpen((open) => !open)}><span>+</span> Add a markdown source</button>
          {panelOpen && <section className="upload-panel"><div className="section-heading"><span>Add source</span><button className="close-button" type="button" onClick={() => setPanelOpen(false)}>×</button></div><form onSubmit={loadUrl}><label htmlFor="markdown-url">Raw markdown URL</label><div className="url-row"><input id="markdown-url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://raw.githubusercontent.com/.../README.md" /><button type="submit" disabled={busy || !url.trim()}>Load</button></div></form><p className="panel-note">Use a raw GitHub README or any public markdown URL.</p></section>}

          <section className="source-section"><div className="section-heading"><span>Shortcuts</span><span className="count">{quickActions.length}</span></div><div className="flow-grid">{quickActions.map(([label, prompt]) => <button key={prompt} type="button" onClick={() => sendToRasa(prompt)} disabled={busy}>{label}</button>)}</div></section>
        </aside>

        <section className="chat-panel">
          <div className="chat-header"><div><h2>Chat with your documents</h2></div><div className="quick-actions"><button type="button" onClick={() => sendToRasa("summarize current document") } disabled={busy}>Summarize</button><button type="button" className="ghost-button" onClick={() => setMessages([])} disabled={!messages.length}>Clear history</button></div></div>
          <div className="chat-history" aria-live="polite">{messages.length ? messages.map((message, index) => <div className={`message ${message.role}`} key={`${message.role}-${index}`}><div className="message-label">{message.role === "user" ? "You" : "Assistant"}</div><div className="message-text"><MarkdownMessage text={message.text} /></div>{message.meta && <div className="message-meta">{message.meta}</div>}</div>) : <div className="empty-chat"><div className="empty-symbol">?</div><h3>Your conversation is clear</h3><p>Send a raw markdown URL or ask what this assistant can do.</p></div>}{busy && <div className="message assistant loading"><div className="message-label">Assistant</div><div className="loading-line" /><div className="loading-line short" /></div>}</div>
          <form className="composer" onSubmit={(event) => { event.preventDefault(); sendToRasa(question); }}><input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask a question or choose a shortcut..." disabled={busy} /><button type="submit" disabled={!question.trim() || busy}>Send <span>↗</span></button></form>
        </section>
      </div>
    </main>
  );
}

function App() {
  const [auth, setAuth] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const callbackToken = params.get("auth_token");
    const callbackUser = params.get("auth_user");
    if (callbackToken && callbackUser) {
      const callbackAuth = { token: callbackToken, user: JSON.parse(callbackUser) };
      localStorage.setItem(AUTH_KEY, JSON.stringify(callbackAuth));
      window.history.replaceState({}, "", window.location.pathname);
      return callbackAuth;
    }
    return getStoredAuth();
  });
  const [theme, setTheme] = useState(() => localStorage.getItem("markdown-rag-theme") || "dark");

  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem("markdown-rag-theme", theme); }, [theme]);

  useEffect(() => {
    if (auth?.token) authRequest("/auth/me").catch(() => { localStorage.removeItem(AUTH_KEY); setAuth(null); });
  }, [auth?.token]);

  function logout() {
    authRequest("/auth/logout", { method: "POST" }).catch(() => {});
    localStorage.removeItem(AUTH_KEY);
    localStorage.removeItem(USER_KEY);
    setAuth(null);
  }

  const toggleTheme = () => setTheme((current) => current === "dark" ? "light" : "dark");
  return auth ? <Workspace auth={auth} onLogout={logout} theme={theme} onToggleTheme={toggleTheme} /> : <AuthScreen onAuthenticated={setAuth} theme={theme} onToggleTheme={toggleTheme} />;
}

createRoot(document.getElementById("root")).render(<App />);




