const tokenInput = document.querySelector<HTMLInputElement>("#token");
let loadSequence = 0;
let selectedRunId: string | undefined;

if (tokenInput) {
  tokenInput.value = window.localStorage.getItem("event-agent-token") ?? "";
}

interface RunSummary {
  id: string;
  status: string;
  queue: string;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  workerId?: string | null;
  error?: string | null;
  artifactCount?: number;
}

interface RunLog {
  at: string;
  stream: string;
  message: string;
}

interface RunArtifact {
  id: string;
  title: string;
  bucket: string;
  key: string;
  ticker?: string | null;
  contentType: string;
}

interface ArtifactAccess {
  access: {
    url: string;
    expiresAt: string;
  };
}

interface AgentSummary {
  id: string;
  name: string;
  description: string;
  modelProvider: string;
  model: string;
  enabled: boolean;
}

interface ScheduleSummary {
  id: string;
  name: string;
  expression: string;
  queue: string;
  enabled: boolean;
}

async function load(): Promise<void> {
  const sequence = ++loadSequence;
  const token = tokenInput?.value.trim() || window.localStorage.getItem("event-agent-token") || "";
  const agentsEl = document.querySelector("#agents");
  const schedulesEl = document.querySelector("#schedules");
  const runsEl = document.querySelector("#runs");
  const runDetailEl = document.querySelector("#run-detail");
  if (!agentsEl || !schedulesEl || !runsEl || !runDetailEl) return;

  if (!token) {
    agentsEl.textContent = "Enter the API token and refresh.";
    schedulesEl.textContent = "Enter the API token and refresh.";
    runsEl.textContent = "Enter the API token and refresh.";
    runDetailEl.textContent = "Enter the API token and refresh.";
    return;
  }

  const [agentsResponse, schedulesResponse, runsResponse] = await Promise.all([
    fetch("/api/agents", { headers: { authorization: `Bearer ${token}` } }),
    fetch("/api/schedules", { headers: { authorization: `Bearer ${token}` } }),
    fetch("/api/runs", { headers: { authorization: `Bearer ${token}` } })
  ]);

  if (sequence !== loadSequence) return;

  if (!agentsResponse.ok || !schedulesResponse.ok || !runsResponse.ok) {
    agentsEl.textContent = "API unavailable or unauthorized.";
    schedulesEl.textContent = "API unavailable or unauthorized.";
    runsEl.textContent = "Enter the API token and refresh.";
    runDetailEl.textContent = "Enter the API token and refresh.";
    return;
  }

  const agentsJson = (await agentsResponse.json()) as { agents: AgentSummary[] };
  const schedulesJson = (await schedulesResponse.json()) as { schedules: ScheduleSummary[] };
  const runsJson = (await runsResponse.json()) as { runs: RunSummary[] };

  agentsEl.innerHTML = agentsJson.agents.length
    ? agentsJson.agents
        .map(
          (agent) =>
            `<div class="row agent-row"><div><strong>${escapeHtml(agent.name)}</strong><span>${escapeHtml(agent.modelProvider)} / ${escapeHtml(agent.model)} · ${agent.enabled ? "enabled" : "disabled"}</span></div><button class="secondary compact" type="button" data-agent-trigger-id="${escapeHtml(agent.id)}">Run now</button></div>`
        )
        .join("")
    : "No agents yet.";

  agentsEl.querySelectorAll<HTMLButtonElement>("[data-agent-trigger-id]").forEach((button) => {
    button.addEventListener("click", () => {
      void triggerAgent(button.dataset.agentTriggerId, button);
    });
  });

  schedulesEl.innerHTML = schedulesJson.schedules.length
    ? schedulesJson.schedules
        .map(
          (schedule) =>
            `<div class="row schedule-row"><div><strong>${escapeHtml(schedule.name)}</strong><span>${escapeHtml(schedule.expression)} -> ${escapeHtml(schedule.queue)} · ${schedule.enabled ? "enabled" : "paused"}</span></div><button class="secondary compact" type="button" data-schedule-trigger-id="${escapeHtml(schedule.id)}">Run now</button></div>`
        )
        .join("")
    : "No schedules yet.";

  schedulesEl.querySelectorAll<HTMLButtonElement>("[data-schedule-trigger-id]").forEach((button) => {
    button.addEventListener("click", () => {
      void triggerSchedule(button.dataset.scheduleTriggerId, button);
    });
  });

  runsEl.innerHTML = runsJson.runs.length
    ? runsJson.runs
        .map(
          (run) =>
            `<button class="row row-button ${run.id === selectedRunId ? "selected" : ""}" type="button" data-run-id="${escapeHtml(run.id)}"><strong>${escapeHtml(run.status)}</strong><span>${escapeHtml(run.id)} on ${escapeHtml(run.queue)} · ${run.artifactCount ?? 0} artifacts</span></button>`
        )
        .join("")
    : "No runs yet.";

  runsEl.querySelectorAll<HTMLButtonElement>("[data-run-id]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedRunId = button.dataset.runId;
      void loadRunDetail();
      runsEl.querySelectorAll(".row-button").forEach((row) => row.classList.remove("selected"));
      button.classList.add("selected");
    });
  });

  if (!selectedRunId && runsJson.runs[0]) {
    selectedRunId = runsJson.runs[0].id;
  }
  await loadRunDetail();
}

async function loadRunDetail(): Promise<void> {
  const token = tokenInput?.value.trim() || window.localStorage.getItem("event-agent-token") || "";
  const runDetailEl = document.querySelector("#run-detail");
  if (!runDetailEl) return;
  if (!token) {
    runDetailEl.textContent = "Enter the API token and refresh.";
    return;
  }
  if (!selectedRunId) {
    runDetailEl.textContent = "Select a run to inspect logs and artifacts.";
    return;
  }

  const response = await fetch(`/api/runs/${encodeURIComponent(selectedRunId)}`, {
    headers: { authorization: `Bearer ${token}` }
  });
  if (!response.ok) {
    runDetailEl.textContent = "Run detail unavailable.";
    return;
  }

  const json = (await response.json()) as {
    run: RunSummary & { agentId?: string | null; scheduleId?: string | null; attempt: number };
    logs: RunLog[];
    artifacts: RunArtifact[];
  };
  const run = json.run;
  runDetailEl.classList.remove("muted");
  runDetailEl.innerHTML = `
    <div class="detail-grid">
      ${detailItem("Status", run.status)}
      ${detailItem("Run", run.id)}
      ${detailItem("Agent", run.agentId ?? "n/a")}
      ${detailItem("Schedule", run.scheduleId ?? "n/a")}
      ${detailItem("Attempt", String(run.attempt))}
      ${detailItem("Worker", run.workerId ?? "n/a")}
      ${detailItem("Started", formatTime(run.startedAt))}
      ${detailItem("Finished", formatTime(run.finishedAt))}
    </div>
    ${run.error ? `<div class="error-box">${escapeHtml(run.error)}</div>` : ""}
    <h3>Artifacts</h3>
    <div class="list">${renderArtifacts(json.artifacts)}</div>
    <div id="artifact-preview" class="artifact-preview muted">Select an artifact preview.</div>
    <h3>Logs</h3>
    <div class="log-list">${renderLogs(json.logs)}</div>
  `;
  runDetailEl.querySelectorAll<HTMLButtonElement>("[data-artifact-open-id]").forEach((button) => {
    button.addEventListener("click", () => {
      void openArtifact(button.dataset.artifactOpenId);
    });
  });
  runDetailEl.querySelectorAll<HTMLButtonElement>("[data-artifact-preview-id]").forEach((button) => {
    button.addEventListener("click", () => {
      void previewArtifact(button.dataset.artifactPreviewId);
    });
  });
}

function detailItem(label: string, value: string): string {
  return `<div class="detail-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function renderArtifacts(artifacts: RunArtifact[]): string {
  if (!artifacts.length) return `<div class="muted">No artifacts.</div>`;
  return artifacts
    .map(
      (artifact) =>
        `<div class="row artifact-row"><div class="artifact-main"><strong>${escapeHtml(artifact.title)}</strong><span>${escapeHtml(artifact.ticker ?? "artifact")} · ${escapeHtml(artifact.contentType)}</span><code>s3://${escapeHtml(artifact.bucket)}/${escapeHtml(artifact.key)}</code></div><div class="artifact-actions"><button class="secondary" type="button" data-artifact-preview-id="${escapeHtml(artifact.id)}">Preview</button><button class="secondary" type="button" data-artifact-open-id="${escapeHtml(artifact.id)}">Open</button></div></div>`
    )
    .join("");
}

async function openArtifact(artifactId: string | undefined): Promise<void> {
  const access = await loadArtifactAccess(artifactId);
  if (!access) return;
  window.open(access.access.url, "_blank", "noopener,noreferrer");
}

async function previewArtifact(artifactId: string | undefined): Promise<void> {
  const previewEl = document.querySelector("#artifact-preview");
  if (!previewEl) return;
  previewEl.classList.add("muted");
  previewEl.textContent = "Loading artifact preview...";
  const access = await loadArtifactAccess(artifactId);
  if (!access) {
    previewEl.textContent = "Artifact preview unavailable.";
    return;
  }

  let response: Response;
  try {
    response = await fetch(access.access.url);
  } catch {
    previewEl.textContent = "Artifact preview unavailable.";
    return;
  }
  if (!response.ok) {
    previewEl.textContent = "Artifact preview unavailable.";
    return;
  }
  const markdown = await response.text();
  previewEl.classList.remove("muted");
  previewEl.innerHTML = `<div class="preview-heading"><strong>Markdown Preview</strong><span>Link expires ${escapeHtml(formatTime(access.access.expiresAt))}</span></div><pre>${escapeHtml(markdown)}</pre>`;
}

async function loadArtifactAccess(artifactId: string | undefined): Promise<ArtifactAccess | undefined> {
  if (!artifactId) return;
  const token = tokenInput?.value.trim() || window.localStorage.getItem("event-agent-token") || "";
  if (!token) return;
  const response = await fetch(`/api/artifacts/${encodeURIComponent(artifactId)}/access-url`, {
    headers: { authorization: `Bearer ${token}` }
  });
  if (!response.ok) return;
  return (await response.json()) as ArtifactAccess;
}

async function triggerSchedule(scheduleId: string | undefined, button: HTMLButtonElement): Promise<void> {
  if (!scheduleId) return;
  const token = tokenInput?.value.trim() || window.localStorage.getItem("event-agent-token") || "";
  if (!token) {
    setStatus("Enter the API token before triggering a schedule.", true);
    return;
  }

  button.disabled = true;
  setStatus("Queueing schedule run...");
  try {
    const response = await fetch(`/api/schedules/${encodeURIComponent(scheduleId)}/trigger`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` }
    });
    if (!response.ok) {
      setStatus("Schedule trigger failed.", true);
      return;
    }

    const json = (await response.json()) as { run?: RunSummary; message?: unknown };
    if (json.run?.id) selectedRunId = json.run.id;
    setStatus("Schedule run queued.");
    await load();
    window.setTimeout(() => {
      void load();
    }, 1800);
  } catch {
    setStatus("Schedule trigger failed.", true);
  } finally {
    button.disabled = false;
  }
}

async function triggerAgent(agentId: string | undefined, button: HTMLButtonElement): Promise<void> {
  if (!agentId) return;
  const token = tokenInput?.value.trim() || window.localStorage.getItem("event-agent-token") || "";
  if (!token) {
    setStatus("Enter the API token before triggering an agent.", true);
    return;
  }

  button.disabled = true;
  setStatus("Queueing agent run...");
  try {
    const response = await fetch(`/api/agents/${encodeURIComponent(agentId)}/trigger`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` }
    });
    if (!response.ok) {
      setStatus("Agent trigger failed.", true);
      return;
    }

    setStatus("Agent run queued.");
    await load();
    window.setTimeout(() => {
      void load();
    }, 1800);
  } catch {
    setStatus("Agent trigger failed.", true);
  } finally {
    button.disabled = false;
  }
}

async function createAgent(form: HTMLFormElement): Promise<void> {
  const token = tokenInput?.value.trim() || window.localStorage.getItem("event-agent-token") || "";
  if (!token) {
    setStatus("Enter the API token before creating an agent.", true);
    return;
  }

  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  const data = new FormData(form);
  const payload = {
    name: String(data.get("name") ?? ""),
    description: String(data.get("description") ?? ""),
    modelProvider: String(data.get("modelProvider") ?? "openai"),
    model: String(data.get("model") ?? "gpt-4.1-mini"),
    systemPrompt: String(data.get("systemPrompt") ?? ""),
    userPromptTemplate: String(data.get("userPromptTemplate") ?? ""),
    outputPrefix: String(data.get("outputPrefix") ?? "").trim() || undefined
  };

  submit?.setAttribute("disabled", "true");
  setStatus("Creating agent...");
  try {
    const response = await fetch("/api/agents", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const error = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
      setStatus(error?.error ?? "Agent creation failed.", true);
      return;
    }

    form.reset();
    const modelInput = document.querySelector<HTMLInputElement>("#agent-model");
    if (modelInput) modelInput.value = "gpt-4.1-mini";
    const providerInput = document.querySelector<HTMLSelectElement>("#agent-provider");
    if (providerInput) providerInput.value = "openai";
    setAgentFormOpen(false);
    setStatus("Agent created.");
    await load();
  } catch {
    setStatus("Agent creation failed.", true);
  } finally {
    submit?.removeAttribute("disabled");
  }
}

function setStatus(message: string, isError = false): void {
  const statusEl = document.querySelector("#status");
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.classList.toggle("error-text", isError);
  statusEl.classList.toggle("muted", !isError);
}

function renderLogs(logs: RunLog[]): string {
  if (!logs.length) return `<div class="muted">No logs.</div>`;
  return logs
    .map(
      (log) =>
        `<div class="log-row"><span>${escapeHtml(formatTime(log.at))}</span><strong>${escapeHtml(log.stream)}</strong><p>${escapeHtml(log.message)}</p></div>`
    )
    .join("");
}

function formatTime(value: string | null | undefined): string {
  if (!value) return "n/a";
  return new Date(value).toLocaleString();
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };
    return entities[char] ?? char;
  });
}

document.querySelector("#refresh")?.addEventListener("click", () => {
  void load();
});

document.querySelector("#clear-selection")?.addEventListener("click", () => {
  selectedRunId = undefined;
  const runDetailEl = document.querySelector("#run-detail");
  if (runDetailEl) {
    runDetailEl.classList.add("muted");
    runDetailEl.textContent = "Select a run to inspect logs and artifacts.";
  }
  document.querySelectorAll(".row-button").forEach((row) => row.classList.remove("selected"));
});

document.querySelector<HTMLFormElement>("#agent-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  void createAgent(event.currentTarget as HTMLFormElement);
});

function setAgentFormOpen(open: boolean): void {
  const panel = document.querySelector<HTMLElement>("#agent-create-panel");
  const toggle = document.querySelector<HTMLButtonElement>("#toggle-agent-form");
  if (!panel || !toggle) return;
  panel.hidden = !open;
  toggle.setAttribute("aria-expanded", String(open));
  toggle.textContent = open ? "Hide" : "Create";
  if (open) {
    document.querySelector<HTMLInputElement>("#agent-name")?.focus();
  }
}

document.querySelector("#toggle-agent-form")?.addEventListener("click", () => {
  const panel = document.querySelector<HTMLElement>("#agent-create-panel");
  setAgentFormOpen(Boolean(panel?.hidden));
});

document.querySelector("#close-agent-form")?.addEventListener("click", () => {
  setAgentFormOpen(false);
});

document.querySelector("#save-token")?.addEventListener("click", () => {
  const token = tokenInput?.value.trim();
  if (token) window.localStorage.setItem("event-agent-token", token);
  if (!token) window.localStorage.removeItem("event-agent-token");
  void load();
});

void load();
