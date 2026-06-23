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

  const agentsJson = (await agentsResponse.json()) as { agents: Array<{ name: string; modelProvider: string; model: string; enabled: boolean }> };
  const schedulesJson = (await schedulesResponse.json()) as { schedules: Array<{ name: string; expression: string; queue: string }> };
  const runsJson = (await runsResponse.json()) as { runs: RunSummary[] };

  agentsEl.innerHTML = agentsJson.agents.length
    ? agentsJson.agents
        .map(
          (agent) =>
            `<div class="row"><strong>${escapeHtml(agent.name)}</strong><span>${escapeHtml(agent.modelProvider)} / ${escapeHtml(agent.model)} · ${agent.enabled ? "enabled" : "disabled"}</span></div>`
        )
        .join("")
    : "No agents yet.";

  schedulesEl.innerHTML = schedulesJson.schedules.length
    ? schedulesJson.schedules
        .map((schedule) => `<div class="row"><strong>${escapeHtml(schedule.name)}</strong><span>${escapeHtml(schedule.expression)} -> ${escapeHtml(schedule.queue)}</span></div>`)
        .join("")
    : "No schedules yet.";

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
    <h3>Logs</h3>
    <div class="log-list">${renderLogs(json.logs)}</div>
  `;
  runDetailEl.querySelectorAll<HTMLButtonElement>("[data-artifact-id]").forEach((button) => {
    button.addEventListener("click", () => {
      void openArtifact(button.dataset.artifactId);
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
        `<div class="row artifact-row"><div><strong>${escapeHtml(artifact.title)}</strong><span>${escapeHtml(artifact.ticker ?? "artifact")} · ${escapeHtml(artifact.contentType)}</span><code>s3://${escapeHtml(artifact.bucket)}/${escapeHtml(artifact.key)}</code></div><button class="secondary" type="button" data-artifact-id="${escapeHtml(artifact.id)}">Open</button></div>`
    )
    .join("");
}

async function openArtifact(artifactId: string | undefined): Promise<void> {
  if (!artifactId) return;
  const token = tokenInput?.value.trim() || window.localStorage.getItem("event-agent-token") || "";
  if (!token) return;
  const response = await fetch(`/api/artifacts/${encodeURIComponent(artifactId)}/access-url`, {
    headers: { authorization: `Bearer ${token}` }
  });
  if (!response.ok) return;
  const json = (await response.json()) as { access: { url: string } };
  window.open(json.access.url, "_blank", "noopener,noreferrer");
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

document.querySelector("#save-token")?.addEventListener("click", () => {
  const token = tokenInput?.value.trim();
  if (token) window.localStorage.setItem("event-agent-token", token);
  if (!token) window.localStorage.removeItem("event-agent-token");
  void load();
});

void load();
