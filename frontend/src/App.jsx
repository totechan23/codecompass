
import { useState } from "react";
import "./App.css";
import ArchitectureMap from "./ArchitectureMap";

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

  // God Mode
  const [godMode, setGodMode] = useState(false);

  // Repository creator
  const [showRepoCreator, setShowRepoCreator] = useState(false);
  const [newRepoName, setNewRepoName] = useState("");
  const [newRepoDescription, setNewRepoDescription] = useState("");
  const [newRepoPrivate, setNewRepoPrivate] = useState(true);
  const [creatingRepo, setCreatingRepo] = useState(false);
  const [createRepoError, setCreateRepoError] = useState("");
  const [createdRepo, setCreatedRepo] = useState(null);

  // Collaborator management
  const [showCollaborators, setShowCollaborators] = useState(false);
  const [collabOwner, setCollabOwner] = useState("totechan23");
  const [collabRepo, setCollabRepo] = useState("");
  const [collabUsername, setCollabUsername] = useState("");
  const [collabPermission, setCollabPermission] = useState("push");
  const [addingCollaborator, setAddingCollaborator] = useState(false);
  const [collabError, setCollabError] = useState("");
  const [collabResult, setCollabResult] = useState(null);

  async function analyzeRepo(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setGuideError("");
    setRepo(null);
    setGuide("");

    try {
     const match = url.trim().match(
  /^https?:\/\/github\.com\/([^/]+)\/([^/?#]+)/
);

if (!match) {
  throw new Error("Enter a valid GitHub repository URL.");
}

const owner = match[1];
const repository = match[2].replace(/\.git$/, "");

const response = await fetch(
  `${API}/analyze?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repository)}`
);

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "Could not analyze repository.");
      }

      setRepo({
  ...data,
  name: data.repository?.name || data.repo,
  description: data.repository?.description || "",
  url: data.repository?.html_url || data.url,
  stars: data.repository?.stargazers_count ?? 0,
  forks: data.repository?.forks_count ?? 0,
  language: data.repository?.language || "Not specified",
  files: Array.isArray(data.files) ? data.files : [],
  issues: Array.isArray(data.issues) ? data.issues : [],
});
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
        body: JSON.stringify({
  owner: repo.owner || repo.repository?.owner?.login || "",
  repo: repo.repo || repo.repository?.name || "",
  question:
    "Explain this repository, its important files, how to run it, and how a beginner can contribute.",
  context: JSON.stringify({
    description: repo.repository?.description,
    language: repo.repository?.language,
    files: repo.files,
    readme: repo.readme,
  }),
}),
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

  async function createGithubRepo(event) {
    event.preventDefault();

    setCreatingRepo(true);
    setCreateRepoError("");
    setCreatedRepo(null);

    try {
      const response = await fetch(`${API}/github/repos`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: newRepoName.trim(),
          description: newRepoDescription.trim(),
          private: newRepoPrivate,
          auto_init: true,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "Could not create repository.");
      }

      setCreatedRepo(data);
      setNewRepoName("");
      setNewRepoDescription("");
    } catch (err) {
      setCreateRepoError(
        err.message || "Could not connect to the CodeCompass API."
      );
    } finally {
      setCreatingRepo(false);
    }
  }


  async function inviteCollaborator(event) {
    event.preventDefault();

    setAddingCollaborator(true);
    setCollabError("");
    setCollabResult(null);

    try {
      const response = await fetch(`${API}/github/collaborators`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          owner: collabOwner.trim(),
          repo: collabRepo.trim(),
          username: collabUsername.trim(),
          permission: collabPermission,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "Could not add collaborator.");
      }

      setCollabResult(data);
      setCollabUsername("");
    } catch (err) {
      setCollabError(
        err.message || "Could not connect to the CodeCompass API."
      );
    } finally {
      setAddingCollaborator(false);
    }
  }
  
const files = repo?.files || [];
  const issues = repo?.issues || [];

  return (
    <div className={godMode ? "app-shell god-mode" : "app-shell"}>
      <header className="topbar">
        <a className="brand" href="#" aria-label="CodeCompass home">
          <span className="brand-mark">
            C<span>.</span>
          </span>
          <span>codecompass</span>
        </a>

        <div className="topbar-right">
          <span className="status-dot" />
          <span>Open-source explorer</span>
          <span className="version-tag">BETA</span>

          <button
            type="button"
            className="god-mode-toggle"
            onClick={() => setGodMode((active) => !active)}
            aria-pressed={godMode}
          >
            <span className="god-mode-icon">CC</span>
            {godMode ? "EXIT GOD MODE" : "GOD MODE"}
          </button>


        </div>
      </header>

      <main className="main-content">

      {godMode && (
        <section className="god-mode-hub">
          <div className="god-mode-hub-head">
            <div className="eyebrow">
              <span className="god-mode-pulse" />
              GOD MODE / CONTROL CENTER
            </div>
            <h2>Build your open-source <em>empire.</em></h2>
            <p>
              Create repositories, bring your team together, and get your
              next project moving.
            </p>
          </div>

          <div className="god-mode-actions">
            <button
              type="button"
              className="god-action-card create-action"
              onClick={() => {
                setShowRepoCreator((visible) => !visible);
                setCreateRepoError("");
              }}
              aria-expanded={showRepoCreator}
            >
              <span className="god-action-icon">＋</span>
              <span className="god-action-copy">
                <small>01 / REPOSITORIES</small>
                <strong>
                  {showRepoCreator ? "Close repository creator" : "Create a repository"}
                </strong>
                <span>Launch a project with your own settings.</span>
              </span>
              <span className="god-action-arrow">↗</span>
            </button>

            <button
              type="button"
              className="god-action-card contributor-action"
              onClick={() => {
                setShowCollaborators((visible) => !visible);
                setCollabError("");
                setCollabResult(null);
              }}
              aria-expanded={showCollaborators}
            >
              <span className="god-action-icon">⌘</span>
              <span className="god-action-copy">
                <small>02 / TEAM ACCESS</small>
                <strong>
                  {showCollaborators ? "Close contributor manager" : "Invite contributors"}
                </strong>
                <span>Bring collaborators into your repository.</span>
              </span>
              <span className="god-action-arrow">↗</span>
            </button>
          </div>
          <div className="god-mode-hub-foot">
            <span className="god-mode-pulse" />
            POWER TOOLS ENABLED
            <span>GITHUB CONNECTED WORKFLOW</span>
          </div>
        </section>
      )}

      
        {godMode && showCollaborators && (
          <section className="panel repo-creator-panel">
            <div className="panel-heading">
              <div>
                <div className="eyebrow">GOD MODE / TEAM</div>
                <h3>Manage collaborators</h3>
              </div>
              <span className="count-label">GITHUB ACCESS</span>
            </div>

            <form
              className="repo-creator-form"
              onSubmit={inviteCollaborator}
            >
              <label htmlFor="collab-owner">Repository owner</label>
              <input
                id="collab-owner"
                value={collabOwner}
                onChange={(event) => setCollabOwner(event.target.value)}
                placeholder="totechan23"
                required
              />

              <label htmlFor="collab-repo">Repository name</label>
              <input
                id="collab-repo"
                value={collabRepo}
                onChange={(event) => setCollabRepo(event.target.value)}
                placeholder="my-awesome-project"
                required
              />

              <label htmlFor="collab-username">
                Teammate's GitHub username
              </label>
              <input
                id="collab-username"
                value={collabUsername}
                onChange={(event) => setCollabUsername(event.target.value)}
                placeholder="teammate-username"
                pattern="[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?"
                required
              />

              <label htmlFor="collab-permission">Permission level</label>
              <select
                id="collab-permission"
                value={collabPermission}
                onChange={(event) => setCollabPermission(event.target.value)}
              >
                <option value="pull">Read — view and clone</option>
                <option value="triage">Triage — manage issues</option>
                <option value="push">Write — contribute code</option>
                <option value="maintain">Maintain — manage repository</option>
                <option value="admin">Admin — full repository control</option>
              </select>

              <button type="submit" disabled={addingCollaborator}>
                {addingCollaborator
                  ? "SENDING INVITATION..."
                  : "SEND INVITATION"}
              </button>
            </form>

            {collabError && (
              <p role="alert" className="error-message">
                {collabError}
              </p>
            )}

            {collabResult && (
              <div className="repo-created-message" role="status">
                <strong>Request successful</strong>
                <p>{collabResult.message}</p>
                <p>
                  Repository: {collabResult.repository}
                  <br />
                  Username: {collabResult.username}
                  <br />
                  Permission: {collabResult.permission}
                </p>
                <a
                  href={`https://github.com/${collabOwner}/${collabRepo}/settings/access`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View repository access on GitHub
                </a>
              </div>
            )}
          </section>
        )}
  {godMode && showRepoCreator && (
          <section className="panel repo-creator-panel">
            <div className="panel-heading">
              <div>
                <div className="eyebrow">GOD MODE / GITHUB</div>
                <h3>Create a repository</h3>
              </div>
              <span className="count-label">NEW PROJECT</span>
            </div>

            <form
              onSubmit={createGithubRepo}
              className="repo-creator-form"
            >
              <label htmlFor="new-repo-name">
                Repository name
              </label>

              <input
                id="new-repo-name"
                value={newRepoName}
                onChange={(event) => setNewRepoName(event.target.value)}
                placeholder="my-awesome-project"
                pattern="[A-Za-z0-9._-]+"
                maxLength={100}
                required
              />

              <label htmlFor="new-repo-description">
                Description
              </label>

              <input
                id="new-repo-description"
                value={newRepoDescription}
                onChange={(event) =>
                  setNewRepoDescription(event.target.value)
                }
                placeholder="What are you building?"
                maxLength={350}
              />

              <label className="repo-visibility-option">
                <input
                  type="checkbox"
                  checked={newRepoPrivate}
                  onChange={(event) =>
                    setNewRepoPrivate(event.target.checked)
                  }
                />
                Create as a private repository
              </label>

              <button type="submit" disabled={creatingRepo}>
                {creatingRepo
                  ? "CREATING REPOSITORY..."
                  : "CREATE ON GITHUB ↗"}
              </button>
            </form>

            {createRepoError && (
              <div className="error-banner" role="alert">
                {createRepoError}
              </div>
            )}

            {createdRepo && (
              <div className="repo-created-message" role="status">
                <strong>Repository created successfully.</strong>
                <p>{createdRepo.name}</p>

                <a
                  href={createdRepo.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open repository on GitHub ↗
                </a>
              </div>
            )}
          </section>
        )}

        <section className="intro">
          <div className="eyebrow">
            <span /> YOUR STARTING POINT IN OPEN SOURCE
          </div>

          <h1>
            Every codebase has
            <br />
            a <em>way in.</em>
          </h1>

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
              onClick={() =>
                setUrl("https://github.com/octocat/Hello-World")
              }
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
                {(repo.name || "R")
                  .split("/")
                  .pop()
                  .slice(0, 1)
                  .toUpperCase()}
              </div>

              <div className="repo-title">
                <div className="repo-kicker">REPOSITORY</div>
                <h2>{repo.name}</h2>

                <p>
                  {repo.description ||
                    "No repository description provided."}
                </p>

                <a
                  href={repo.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  View on GitHub ↗
                </a>
              </div>

              <span className="public-label">PUBLIC</span>
            </div>

            <div className="stats-row">
              <div className="stat">
                <span className="stat-label">STARS</span>
                <strong>
                  ★ {Number(repo.stars || 0).toLocaleString()}
                </strong>
              </div>

              <div className="stat">
                <span className="stat-label">PRIMARY LANGUAGE</span>
                <strong>
                  <span className="language-dot" />
                  {repo.language || "Not specified"}
                </strong>
              </div>

              <div className="stat">
                <span className="stat-label">DEFAULT BRANCH</span>
                <strong>
                  <span className="branch-icon">⑂</span>
                  {repo.default_branch}
                </strong>
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

                  <span className="count-label">
                    {files.length} paths
                  </span>
                </div>

                <div className="tabs">
                  <button
                    className={activeTab === "architecture" ? "tab active" : "tab"}
                    onClick={() => setActiveTab("architecture")}
                    type="button"
                  >
                    Architecture
                  </button>

                  <button
                    className={
                      activeTab === "files" ? "tab active" : "tab"
                    }
                    onClick={() => setActiveTab("files")}
                    type="button"
                  >
                    <span>⌘</span> Files
                    <span className="tab-count">{files.length}</span>
                  </button>

                  <button
                    className={
                      activeTab === "issues" ? "tab active" : "tab"
                    }
                    onClick={() => setActiveTab("issues")}
                    type="button"
                  >
                    <span>◎</span> Issues
                    <span className="tab-count">{issues.length}</span>
                  </button>
                </div>

                {activeTab === "architecture" ? (
                  <ArchitectureMap repo={repo} onBack={() => setActiveTab("files")} />
                ) : activeTab === "files" ? (
                  <div className="file-list">
                    {files.slice(0, 35).map((file, index) => {
                      const path =
                        typeof file === "string" ? file : file.path;

                      const isFolder = path?.endsWith("/");
                      const name =
                        path?.split("/").filter(Boolean).pop() || path;

                      return (
                        <div
                          className="file-row"
                          key={`${path}-${index}`}
                        >
                          <span
                            className={
                              isFolder ? "file-icon folder" : "file-icon"
                            }
                          >
                            {isFolder ? "▰" : "·"}
                          </span>

                          <span className="file-name">{name}</span>
                          <span className="file-path">{path}</span>
                        </div>
                      );
                    })}

                    {files.length === 0 && (
                      <p className="empty-state">
                        No file paths were returned.
                      </p>
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
                        <span className="issue-title">
                          {issue.title}
                        </span>
                        <span className="issue-number">
                          #{issue.number} ↗
                        </span>
                      </a>
                    ))}

                    {issues.length === 0 && (
                      <p className="empty-state">
                        No open issues found.
                      </p>
                    )}
                  </div>
                )}
              </section>

              <aside className="panel guide-panel">
                <div className="guide-topline">
                  <span className="guide-icon">CC</span>
                  <span>CODECOMPASS GUIDE</span>
                  <span className="local-tag">LOCAL AI</span>
                </div>

                <h3>
                  Find your way
                  <br />
                  into this codebase.
                </h3>

                <p className="guide-description">
                  A practical guide to what this project does, where to
                  start, how to run it, and what you could contribute.
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
                    <span className="typing-indicator">
                      <i />
                      <i />
                      <i />
                    </span>
                    <span>Writing your guide…</span>
                  </div>
                )}

                {guideError && (
                  <div className="guide-error">{guideError}</div>
                )}

                {guide && (
                  <div className="guide-output">
                    <div className="guide-output-head">
                      <span>ONBOARDING NOTES</span>
                      {guideLoading && (
                        <span className="live-label">LIVE</span>
                      )}
                    </div>

                    <pre>{guide}</pre>

                    {!guideLoading && (
                      <button
                        className="copy-button"
                        type="button"
                        onClick={() =>
                          navigator.clipboard.writeText(guide)
                        }
                      >
                        Copy guide ↗
                      </button>
                    )}
                  </div>
                )}

                {guideError && !guideLoading && (
                  <button
                    className="retry-button"
                    onClick={generateGuide}
                    type="button"
                  >
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
                    <div className="eyebrow">
                      PROJECT DOCUMENTATION
                    </div>
                    <h3>README preview</h3>
                  </div>

                  <a
                    href={`${repo.url}#readme`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Read on GitHub ↗
                  </a>
                </div>

                <pre className="readme-content">
                  {repo.readme.slice(0, 5000)}
                </pre>
              </section>
            )}
          </section>
        )}

        {!repo && !loading && !error && (
          <section className="empty-workspace">
            <div className="empty-symbol">⌘</div>

            <div>
              <span className="eyebrow">
                A CLEARER WAY TO CONTRIBUTE
              </span>
              <h3>Start with a repository.</h3>
              <p>
                We'll map the files and surface a beginner-friendly path
                forward.
              </p>
            </div>

            <div className="empty-steps">
              <span>
                <b>01</b> Explore
              </span>
              <span>
                <b>02</b> Understand
              </span>
              <span>
                <b>03</b> Contribute
              </span>
            </div>
          </section>
        )}
      </main>

      <footer className="footer">
        <a className="footer-brand" href="#">
          C.
        </a>
        <span>Built for the next open-source contributor.</span>
        <span>CODECOMPASS / 2026</span>
      </footer>
    </div>
  );
}
