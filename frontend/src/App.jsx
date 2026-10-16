
import { useState } from "react";
import "./App.css";

const API = "http://127.0.0.1:8000";

export default function App() {
  const [url, setUrl] = useState("");
  const [repo, setRepo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [guide, setGuide] = useState("");
  const [guideLoading, setGuideLoading] = useState(false);
  const [error, setError] = useState("");
  const [guideError, setGuideError] = useState("");
  const [activeTab, setActiveTab] = useState("files");

  async function analyzeRepo(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setGuideError("");
    setRepo(null);
    setGuide("");

    try {
      const response = await fetch(
        `${API}/analyze?url=${encodeURIComponent(url.trim())}`
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "Could not analyze repository.");
      }

      setRepo(data);
    } catch (err) {
      setError(err.message || "Could not connect to CodeCompass API.");
    } finally {
      setLoading(false);
    }
  }

  async function generateGuide() {
    if (!repo) return;

    setGuide("");
    setGuideError("");
    setGuideLoading(true);

    try {
      const response = await fetch(`${API}/guide/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || "Could not generate the guide.");
      }

      if (!response.body) {
        throw new Error("Your browser does not support response streaming.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;

          const item = JSON.parse(line);

          if (item.error) throw new Error(item.error);
          if (item.response) {
            setGuide((previous) => previous + item.response);
          }
        }
      }

      if (buffer.trim()) {
        const item = JSON.parse(buffer);
        if (item.error) throw new Error(item.error);
        if (item.response) {
          setGuide((previous) => previous + item.response);
        }
      }
    } catch (err) {
      setGuideError(err.message || "Guide generation failed.");
    } finally {
      setGuideLoading(false);
    }
  }

  const files = repo?.files || [];
  const issues = repo?.issues || [];

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="CodeCompass home">
          <span className="brand-mark">C<span>.</span></span>
          <span>codecompass</span>
        </a>
        <div className="topbar-right">
          <span className="status-dot" />
          <span>Open-source explorer</span>
          <span className="version-tag">BETA</span>
        </div>
      </header>

      <main className="main-content">
        <section className="intro">
          <div className="eyebrow"><span /> YOUR STARTING POINT IN OPEN SOURCE</div>
          <h1>Every codebase has<br />a <em>way in.</em></h1>
          <p className="intro-copy">
            Understand an unfamiliar repository, find the important files,
            and discover where you can make your first contribution.
          </p>

          <form className="search-box" onSubmit={analyzeRepo}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m16 16 4 4" />
            </svg>
            <input
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="Paste a GitHub repository URL"
              required
            />
            <button type="submit" disabled={loading}>
              {loading ? "Exploring…" : "Explore repository"}
              {!loading && <span aria-hidden="true">↗</span>}
            </button>
          </form>
          <div className="search-foot">
            <span>PUBLIC REPOSITORIES</span>
            <button
              type="button"
              onClick={() => setUrl("https://github.com/octocat/Hello-World")}
            >
              Try a sample repository <span>↗</span>
            </button>
          </div>
        </section>

        {error && <div className="error-banner">{error}</div>}

        {loading && (
          <section className="loading-panel">
            <div className="loader" />
            <div>
              <strong>Mapping the codebase</strong>
              <p>Fetching repository details, files, and open issues…</p>
            </div>
          </section>
        )}

        {repo && !loading && (
          <section className="workspace">
            <div className="repo-heading">
              <div className="repo-avatar">
                {(repo.name || "R").split("/").pop().slice(0, 1).toUpperCase()}
              </div>
              <div className="repo-title">
                <div className="repo-kicker">REPOSITORY</div>
                <h2>{repo.name}</h2>
                <p>{repo.description || "No repository description provided."}</p>
                <a href={repo.url} target="_blank" rel="noreferrer">
                  View on GitHub ↗
                </a>
              </div>
              <span className="public-label">PUBLIC</span>
            </div>

            <div className="stats-row">
              <div className="stat">
                <span className="stat-label">STARS</span>
                <strong>★ {Number(repo.stars || 0).toLocaleString()}</strong>
              </div>
              <div className="stat">
                <span className="stat-label">PRIMARY LANGUAGE</span>
                <strong><span className="language-dot" />{repo.language || "Not specified"}</strong>
              </div>
              <div className="stat">
                <span className="stat-label">DEFAULT BRANCH</span>
                <strong><span className="branch-icon">⑂</span>{repo.default_branch}</strong>
              </div>
              <div className="stat">
                <span className="stat-label">FILES DISCOVERED</span>
                <strong>{files.length}</strong>
              </div>
            </div>

            <div className="content-grid">
              <section className="panel explorer-panel">
                <div className="panel-heading">
                  <div>
                    <div className="eyebrow">INSIDE THE PROJECT</div>
                    <h3>Repository explorer</h3>
                  </div>
                  <span className="count-label">{files.length} paths</span>
                </div>

                <div className="tabs">
                  <button
                    className={activeTab === "files" ? "tab active" : "tab"}
                    onClick={() => setActiveTab("files")}
                    type="button"
                  >
                    <span>⌘</span> Files <span className="tab-count">{files.length}</span>
                  </button>
                  <button
                    className={activeTab === "issues" ? "tab active" : "tab"}
                    onClick={() => setActiveTab("issues")}
                    type="button"
                  >
                    <span>◎</span> Issues <span className="tab-count">{issues.length}</span>
                  </button>
                </div>

                {activeTab === "files" ? (
                  <div className="file-list">
                    {files.slice(0, 35).map((file, index) => {
                      const path = typeof file === "string" ? file : file.path;
                      const isFolder = path?.endsWith("/");
                      const name = path?.split("/").filter(Boolean).pop() || path;

                      return (
                        <div className="file-row" key={`${path}-${index}`}>
                          <span className={isFolder ? "file-icon folder" : "file-icon"}>
                            {isFolder ? "▰" : "·"}
                          </span>
                          <span className="file-name">{name}</span>
                          <span className="file-path">{path}</span>
                        </div>
                      );
                    })}
                    {files.length === 0 && (
                      <p className="empty-state">No file paths were returned.</p>
                    )}
                    {files.length > 35 && (
                      <p className="list-note">
                        Showing 35 of {files.length} discovered paths.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="issue-list">
                    {issues.map((issue) => (
                      <a
                        className="issue-row"
                        href={issue.html_url}
                        target="_blank"
                        rel="noreferrer"
                        key={issue.number}
                      >
                        <span className="issue-symbol">◎</span>
                        <span className="issue-title">{issue.title}</span>
                        <span className="issue-number">#{issue.number} ↗</span>
                      </a>
                    ))}
                    {issues.length === 0 && (
                      <p className="empty-state">No open issues found.</p>
                    )}
                  </div>
                )}
              </section>

              <aside className="panel guide-panel">
                <div className="guide-topline">
                  <span className="guide-icon">✳</span>
                  <span>CODECOMPASS GUIDE</span>
                  <span className="local-tag">LOCAL AI</span>
                </div>

                <h3>Find your way<br />into this codebase.</h3>
                <p className="guide-description">
                  A practical guide to what this project does, where to start,
                  how to run it, and what you could contribute.
                </p>

                {!guide && !guideLoading && (
                  <button
                    className="generate-button"
                    type="button"
                    onClick={generateGuide}
                  >
                    Generate onboarding guide <span>→</span>
                  </button>
                )}

                {guideLoading && (
                  <div className="stream-status">
                    <span className="typing-indicator"><i /><i /><i /></span>
                    <span>Writing your guide…</span>
                  </div>
                )}

                {guideError && <div className="guide-error">{guideError}</div>}

                {guide && (
                  <div className="guide-output">
                    <div className="guide-output-head">
                      <span>ONBOARDING NOTES</span>
                      {guideLoading && <span className="live-label">LIVE</span>}
                    </div>
                    <pre>{guide}</pre>
                    {!guideLoading && (
                      <button
                        className="copy-button"
                        type="button"
                        onClick={() => navigator.clipboard.writeText(guide)}
                      >
                        Copy guide ↗
                      </button>
                    )}
                  </div>
                )}

                {guideError && !guideLoading && (
                  <button className="retry-button" onClick={generateGuide} type="button">
                    Try again ↻
                  </button>
                )}

                <div className="guide-foot">
                  <span className="status-dot" />
                  Powered by Qwen · Runs locally
                </div>
              </aside>
            </div>

            {repo.readme && (
              <section className="panel readme-panel">
                <div className="panel-heading">
                  <div>
                    <div className="eyebrow">PROJECT DOCUMENTATION</div>
                    <h3>README preview</h3>
                  </div>
                  <a href={`${repo.url}#readme`} target="_blank" rel="noreferrer">
                    Read on GitHub ↗
                  </a>
                </div>
                <pre className="readme-content">{repo.readme.slice(0, 5000)}</pre>
              </section>
            )}
          </section>
        )}

        {!repo && !loading && !error && (
          <section className="empty-workspace">
            <div className="empty-symbol">⌘</div>
            <div>
              <span className="eyebrow">A CLEARER WAY TO CONTRIBUTE</span>
              <h3>Start with a repository.</h3>
              <p>We'll map the files and surface a beginner-friendly path forward.</p>
            </div>
            <div className="empty-steps">
              <span><b>01</b> Explore</span>
              <span><b>02</b> Understand</span>
              <span><b>03</b> Contribute</span>
            </div>
          </section>
        )}
      </main>

      <footer className="footer">
        <a className="footer-brand" href="#">C.</a>
        <span>Built for the next open-source contributor.</span>
        <span>CODECOMPASS / 2026</span>
      </footer>
    </div>
  );
}
