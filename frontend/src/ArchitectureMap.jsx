import { useEffect, useMemo, useState } from "react";
import { ReactFlow, 
  Background,
  Controls,
  MiniMap,
  MarkerType,
  useNodesState,
  useEdgesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./ArchitectureMap.css";

const API = "http://127.0.0.1:8000";

function positionNodes(nodes, edges) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const children = new Map(nodes.map((node) => [node.id, []]));
  const incoming = new Map(nodes.map((node) => [node.id, 0]));

  edges.forEach((edge) => {
    if (children.has(edge.source) && incoming.has(edge.target)) {
      children.get(edge.source).push(edge.target);
      incoming.set(edge.target, incoming.get(edge.target) + 1);
    }
  });

  // Layer dependency targets after the files they depend on.
  const level = new Map(nodes.map((node) => [node.id, 0]));
  for (let pass = 0; pass < 8; pass++) {
    edges.forEach((edge) => {
      if (level.has(edge.source) && level.has(edge.target)) {
        level.set(
          edge.source,
          Math.max(level.get(edge.source), level.get(edge.target) + 1)
        );
      }
    });
  }

  const columns = new Map();
  nodes.forEach((node) => {
    const x = (level.get(node.id) || 0) * 300;
    if (!columns.has(x)) columns.set(x, []);
    columns.get(x).push(node);
  });

  const positions = new Map();
  columns.forEach((column, x) => {
    column.forEach((node, index) => {
      positions.set(node.id, { x, y: index * 105 });
    });
  });

  return nodes.map((node) => ({
    id: node.id,
    position: positions.get(node.id) || { x: 0, y: 0 },
    data: {
      label: (
        <div className="graph-node-content">
          <span className="graph-node-language">{node.language}</span>
          <strong>{node.label}</strong>
          <small>{node.path}</small>
        </div>
      ),
      file: node,
    },
    className: `file-graph-node ${node.language.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    style: {
      width: 220,
      borderRadius: 10,
      border: "1px solid #4b435d",
      padding: 12,
      color: "#f2edf9",
      background: "#1a1821",
    },
  }));
}

export default function ArchitectureMap({ repo, onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [explanation, setExplanation] = useState(null);
  const [explaining, setExplaining] = useState(false);
  const [search, setSearch] = useState("");
  const [language, setLanguage] = useState("All");

  useEffect(() => {
    if (!repo?.owner || !repo?.repo) return;
    const controller = new AbortController();

    async function load() {
      setLoading(true);
      setError("");
      setData(null);
      setSelected(null);
      setExplanation(null);
      try {
        const response = await fetch(
          `${API}/architecture?owner=${encodeURIComponent(repo.owner)}&repo=${encodeURIComponent(repo.repo)}`,
          { signal: controller.signal }
        );
        const result = await response.json();
        if (!response.ok) throw new Error(result.detail || "Could not load graph.");
        setData(result);
        setSelected(result.nodes[0] || null);
      } catch (err) {
        if (err.name !== "AbortError") setError(err.message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    load();
    return () => controller.abort();
  }, [repo?.owner, repo?.repo]);

  const languages = useMemo(
    () => ["All", ...new Set((data?.nodes || []).map((node) => node.language))],
    [data]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.nodes || []).filter((node) =>
      (!q || node.path.toLowerCase().includes(q)) &&
      (language === "All" || node.language === language)
    );
  }, [data, search, language]);

  const filteredIds = useMemo(
    () => new Set(filtered.map((node) => node.id)),
    [filtered]
  );

  const nodes = useMemo(
    () => positionNodes(filtered, data?.edges || []),
    [filtered, data]
  );

  const edges = useMemo(
    () => (data?.edges || [])
      .filter((edge) => filteredIds.has(edge.source) && filteredIds.has(edge.target))
      .map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: "imports",
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed, color: "#8f7ac6" },
        style: { stroke: "#8f7ac6", strokeWidth: 1.6 },
        labelStyle: { fill: "#c5b4ff", fontSize: 10 },
      })),
    [data, filteredIds]
  );

  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState([]);
  const [flowEdges, setFlowEdges, onEdgesChange] = useEdgesState([]);

  useEffect(() => setFlowNodes(nodes), [nodes, setFlowNodes]);
  useEffect(() => setFlowEdges(edges), [edges, setFlowEdges]);

  async function inspectFile(node) {
    setSelected(node.data?.file || node);
    setExplanation(null);
    setExplaining(true);
    const file = node.data?.file || node;
    try {
      const response = await fetch(`${API}/architecture/explain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: repo.owner,
          repo: repo.repo,
          path: file.path,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || "Could not explain file.");
      setExplanation(result);
    } catch (err) {
      setExplanation({ error: err.message });
    } finally {
      setExplaining(false);
    }
  }

  return (
    <section className="architecture-screen">
      <header className="architecture-topbar">
        <button className="architecture-back-button" onClick={onBack} type="button">
          ← Back to dashboard
        </button>
        <div className="architecture-title">
          <span>CODECOMPASS / CODE INTELLIGENCE</span>
          <h2>Repository architecture</h2>
        </div>
        <a href={repo.url} target="_blank" rel="noreferrer">Open GitHub ↗</a>
      </header>

      <div className="architecture-toolbar">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search file or folder path..."
          aria-label="Search file paths"
        />
        <select value={language} onChange={(event) => setLanguage(event.target.value)} aria-label="Filter by language">
          {languages.map((item) => <option key={item}>{item}</option>)}
        </select>
        <span>{filtered.length} files · {edges.length} detected dependencies</span>
      </div>

      {error && <div className="architecture-error">{error}</div>}
      {loading && <div className="architecture-loading">Building the dependency graph from GitHub source files...</div>}

      {!loading && data && (
        <div className="architecture-layout">
          <div className="architecture-flow">
            <ReactFlow
              nodes={flowNodes}
              edges={flowEdges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={(_, node) => inspectFile(node)}
              fitView
              minZoom={0.1}
              maxZoom={2}
              nodesDraggable
              nodesConnectable={false}
              elementsSelectable
              proOptions={{ hideAttribution: true }}
            >
              <Background color="#302b3b" gap={22} />
              <MiniMap
                pannable
                zoomable
                nodeColor={(node) => node.id === selected?.path ? "#c5b4ff" : "#4b8e89"}
                maskColor="rgba(10,10,14,0.7)"
              />
              <Controls />
            </ReactFlow>
            {data.truncated && (
              <div className="architecture-map-note">
                Showing up to 100 source files for performance. Some files and dependencies may be outside this graph.
              </div>
            )}
          </div>

          <aside className="architecture-inspector">
            <div className="inspector-eyebrow">FILE INSPECTOR</div>
            {selected ? (
              <>
                <h3>{selected.label || selected.path?.split("/").pop()}</h3>
                <code className="inspector-path">{selected.path}</code>
                <div className="inspector-section">
                  <label>LANGUAGE</label>
                  <strong>{explanation?.language || selected.language || "Detecting..."}</strong>
                </div>
                <div className="inspector-section">
                  <label>PURPOSE</label>
                  <p>{explanation?.purpose || selected.purpose || "Select a node to inspect its purpose."}</p>
                </div>
                <div className="inspector-section">
                  <label>AI EXPLANATION · QWEN 2.5 3B</label>
                  {explaining && <p>Reading the file and generating an explanation...</p>}
                  {explanation?.error && <p className="architecture-error">{explanation.error}</p>}
                  {explanation?.explanation && <p className="inspector-explanation">{explanation.explanation}</p>}
                  {!explaining && !explanation && (
                    <button className="explain-file-button" onClick={() => inspectFile(selected)} type="button">
                      Explain this file
                    </button>
                  )}
                  {explanation?.explanation && (
                    <button className="explain-file-button" onClick={() => inspectFile(selected)} type="button">
                      Regenerate explanation
                    </button>
                  )}
                </div>
                <a className="inspector-github-link" href={selected.url || `https://github.com/${repo.owner}/${repo.repo}/blob/${data.branch}/${selected.path}`} target="_blank" rel="noreferrer">
                  View file on GitHub ↗
                </a>
              </>
            ) : (
              <p>Select a graph node to see its details.</p>
            )}
            <div className="inspector-footer">
              {data.inspected_files} source files inspected<br />
              Import relationships are shown when confidently detected.
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}
