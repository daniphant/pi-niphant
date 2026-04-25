import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type Stance = "for" | "against" | "neutral";
type RunStatus = "queued" | "running" | "complete" | "failed" | "cancelled";

type Reviewer = {
  id: string;
  label: string;
  model: string;
  stance?: Stance;
  prompt: string;
};

type Stack = {
  id: string;
  label: string;
  description: string;
  costTier?: string;
  reviewers: Reviewer[];
  minSuccessfulReviewers: number;
};

type Config = {
  reviewers: Reviewer[];
  minSuccessfulReviewers: number;
  stacks: Record<string, Stack>;
  defaultStack: string;
  autoStack: boolean;
  maxReviewers: number;
  sources: Array<{ path: string; kind: string; status: string; reason?: string }>;
};

type Run = {
  id: string;
  status: RunStatus;
  startedAt: string;
  completedAt?: string;
  planFile: string;
  artifactDir: string;
  error?: string;
  findingsPath?: string;
  warnings?: Array<{ code: string; message: string; details?: unknown }>;
};

type EventLine = { type: string; data: Record<string, unknown> };

const emptyReviewer = (index: number): Reviewer => ({
  id: `reviewer-${index + 1}`,
  label: `Reviewer ${index + 1}`,
  model: "flash",
  stance: "neutral",
  prompt: "Review for correctness and risks.",
});

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || `Request failed: ${response.status}`);
  return json as T;
}

function duplicatePair(reviewers: Reviewer[]): string | undefined {
  const seen = new Set<string>();
  for (const reviewer of reviewers) {
    const key = `${reviewer.model}:${reviewer.stance || "neutral"}`;
    if (seen.has(key)) return key;
    seen.add(key);
  }
}

function duration(run: Run): string {
  const end = run.completedAt ? Date.parse(run.completedAt) : Date.now();
  const start = Date.parse(run.startedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "—";
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [sessionToken, setSessionToken] = useState("");
  const [planFile, setPlanFile] = useState("");
  const [stackId, setStackId] = useState("custom");
  const [reviewers, setReviewers] = useState<Reviewer[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedRun, setSelectedRun] = useState<string | null>(() => location.hash.replace(/^#run=/, "") || null);
  const [events, setEvents] = useState<EventLine[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([api<Config>("/api/config"), api<{ csrfToken: string }>("/api/session")])
      .then(([cfg, session]) => {
        setConfig(cfg);
        setSessionToken(session.csrfToken);
        const initialStack = cfg.defaultStack || "standard-modern";
        setStackId(initialStack);
        setReviewers(cfg.stacks[initialStack]?.reviewers || cfg.reviewers || []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  async function refreshRuns() {
    try {
      const data = await api<{ runs: Run[] }>("/api/runs");
      setRuns(data.runs);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void refreshRuns();
    const timer = setInterval(() => void refreshRuns(), 5000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selectedRun || !sessionToken) return;
    location.hash = `run=${selectedRun}`;
    setEvents([]);
    const source = new EventSource(`/api/runs/${selectedRun}/events?token=${encodeURIComponent(sessionToken)}`);
    const eventTypes = ["run_queued", "model_availability_warning", "model_discovery_warning", "run_started", "pal_starting", "pal_connected", "reviewer_started", "reviewer_completed", "reviewer_failed", "synthesis_completed", "synthesis_skipped", "run_completed", "run_failed", "run_timeout", "run_cancelled", "run_cancel_requested"];
    for (const type of eventTypes) {
      source.addEventListener(type, (event) => {
        setEvents((current) => [...current, { type, data: JSON.parse((event as MessageEvent).data) }]);
        void refreshRuns();
      });
    }
    source.onerror = () => void refreshRuns();
    return () => source.close();
  }, [selectedRun, sessionToken]);

  const selectedStack = config?.stacks[stackId];
  const activeRun = useMemo(() => runs.find((run) => run.id === selectedRun), [runs, selectedRun]);

  function applyStack(nextStackId: string) {
    setStackId(nextStackId);
    const stack = config?.stacks[nextStackId];
    if (stack) setReviewers(stack.reviewers);
  }

  async function startRun(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!planFile.trim()) return setError("Plan file is required.");
    if (stackId === "custom") {
      const duplicate = duplicatePair(reviewers);
      if (duplicate) return setError(`PAL requires unique model+stance pairs. Duplicate: ${duplicate}`);
    }
    try {
      const body = {
        planFile,
        stackId,
        reviewers: stackId === "custom" ? reviewers : [],
        minSuccessfulReviewers: stackId === "custom" ? Math.min(config?.minSuccessfulReviewers || 2, reviewers.length) : undefined,
      };
      const data = await api<{ run: Run }>("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json", "x-pal-sidecar-token": sessionToken },
        body: JSON.stringify(body),
      });
      await refreshRuns();
      setSelectedRun(data.run.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function cancelRun(id: string) {
    await api(`/api/runs/${id}/cancel`, { method: "POST", headers: { "x-pal-sidecar-token": sessionToken } });
    await refreshRuns();
  }

  return <main className="shell">
    <section className="hero panel">
      <div>
        <div className="kicker">PAL MCP × Local SSE</div>
        <h1>Consensus run room</h1>
        <p className="lede">Review markdown plans through PAL MCP, stream each model consult, and keep raw evidence plus deterministic findings on disk.</p>
      </div>
      <div className="source-card">
        <strong>Config sources</strong>
        {(config?.sources || []).map((source) => <div className={`source ${source.status}`} key={source.path}>
          <span>{source.kind}</span><code>{source.status}</code><small>{source.path}</small>
        </div>)}
      </div>
    </section>

    {error && <div className="error" role="alert">{error}</div>}

    <section className="workspace">
      <form className="panel composer" onSubmit={startRun}>
        <label>Plan file path</label>
        <input value={planFile} onChange={(event) => setPlanFile(event.target.value)} placeholder="/Users/me/project/plan.md" />

        <label>Reviewer stack</label>
        <select value={stackId} onChange={(event) => applyStack(event.target.value)}>
          <option value="custom">Custom form reviewers</option>
          <option value="auto">Auto-select from plan</option>
          {Object.values(config?.stacks || {}).map((stack) => <option key={stack.id} value={stack.id}>{stack.label} · {stack.costTier || "unknown"}</option>)}
        </select>
        <p className="hint">{stackId === "auto" ? "Sidecar chooses a stack from plan keywords." : selectedStack ? `${selectedStack.description} Cost tier: ${selectedStack.costTier}.` : "Custom reviewer form."}</p>

        <div className="reviewer-list">
          {reviewers.map((reviewer, index) => <article className="reviewer" key={`${reviewer.id}-${index}`}>
            <div className="grid three">
              <div><label>ID</label><input value={reviewer.id} onChange={(event) => setReviewers((items) => items.map((item, i) => i === index ? { ...item, id: event.target.value } : item))} /></div>
              <div><label>Label</label><input value={reviewer.label} onChange={(event) => setReviewers((items) => items.map((item, i) => i === index ? { ...item, label: event.target.value } : item))} /></div>
              <div><label>PAL model</label><input value={reviewer.model} onChange={(event) => setReviewers((items) => items.map((item, i) => i === index ? { ...item, model: event.target.value } : item))} /></div>
            </div>
            <label>Stance</label>
            <select value={reviewer.stance || "neutral"} onChange={(event) => setReviewers((items) => items.map((item, i) => i === index ? { ...item, stance: event.target.value as Stance } : item))}>
              <option value="neutral">neutral</option><option value="for">for</option><option value="against">against</option>
            </select>
            <label>Role prompt</label>
            <textarea value={reviewer.prompt} onChange={(event) => setReviewers((items) => items.map((item, i) => i === index ? { ...item, prompt: event.target.value } : item))} />
          </article>)}
        </div>

        <div className="actions">
          <button type="button" className="secondary" onClick={() => { setStackId("custom"); setReviewers((items) => [...items, emptyReviewer(items.length)]); }}>Add reviewer</button>
          <button type="submit">Start PAL run</button>
        </div>
      </form>

      <aside className="panel runs">
        <h2>Runs</h2>
        <div className="run-list">
          {runs.map((run) => <button type="button" className={`run-card ${run.id === selectedRun ? "active" : ""}`} key={run.id} onClick={() => setSelectedRun(run.id)}>
            <span className={`status ${run.status}`}>{run.status}</span>
            <strong>{run.id}</strong>
            <small>{duration(run)} · {run.planFile}</small>
            <code>{run.artifactDir}</code>
            {Boolean(run.warnings?.length) && <span className="warning-pill">{run.warnings?.length} warning{run.warnings?.length === 1 ? "" : "s"}</span>}
            {run.status === "running" && <span className="cancel" onClick={(event) => { event.stopPropagation(); void cancelRun(run.id); }}>Cancel</span>}
          </button>)}
        </div>
      </aside>
    </section>

    <section className="panel event-panel">
      <div className="event-head"><h2>Event stream</h2>{activeRun?.findingsPath && <code>{activeRun.findingsPath}</code>}</div>
      <div className="events">
        {events.length === 0 ? <p>No run selected.</p> : events.map((event, index) => <div className="event" key={`${event.type}-${index}`}>
          <b>{event.type}</b><pre>{JSON.stringify(event.data, null, 2)}</pre>
        </div>)}
      </div>
    </section>
  </main>;
}

createRoot(document.getElementById("root")!).render(<App />);
