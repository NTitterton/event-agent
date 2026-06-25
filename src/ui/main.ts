const tokenInput = document.querySelector<HTMLInputElement>("#token");
let loadSequence = 0;
let selectedRunId: string | undefined;
let selectedAgentId: string | undefined;
let selectedScheduleId: string | undefined;
let activeDetail: "agent" | "schedule" | "run" | undefined;
let editingScheduleId: string | undefined;
let latestAgents: AgentSummary[] = [];
let latestSchedules: ScheduleSummary[] = [];
let latestRuns: RunSummary[] = [];

if (tokenInput) {
  tokenInput.value = window.localStorage.getItem("event-agent-token") ?? "";
}

interface RunSummary {
  id: string;
  agentId?: string | null;
  scheduleId?: string | null;
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
  slug?: string;
  name: string;
  description: string;
  modelProvider: string;
  model: string;
  enabled: boolean;
}

interface AgentDetail extends AgentSummary {
  kind: string;
  systemPrompt: string;
  userPromptTemplate: string;
  config: Record<string, unknown>;
  output: {
    storage: string;
    bucket: string;
    prefix: string;
    filenameTemplate: string;
  };
  createdAt: string;
  updatedAt: string;
}

interface ScheduleSummary {
  id: string;
  name: string;
  expression: string;
  queue: string;
  enabled: boolean;
  timezone: string;
  event: {
    type: string;
    payload: Record<string, unknown>;
  };
}

async function load(): Promise<void> {
  const sequence = ++loadSequence;
  const token = tokenInput?.value.trim() || window.localStorage.getItem("event-agent-token") || "";
  const agentsEl = document.querySelector("#agents");
  const schedulesEl = document.querySelector("#schedules");
  const runsEl = document.querySelector("#runs");
  const runDetailEl = document.querySelector("#run-detail");
  const agentDetailEl = document.querySelector("#agent-detail");
  const scheduleDetailEl = document.querySelector("#schedule-detail");
  if (!agentsEl || !schedulesEl || !runsEl || !runDetailEl || !agentDetailEl || !scheduleDetailEl) return;

  if (!token) {
    activeDetail = undefined;
    updateDetailPanels();
    agentsEl.textContent = "Enter the API token and refresh.";
    schedulesEl.textContent = "Enter the API token and refresh.";
    runsEl.textContent = "Enter the API token and refresh.";
    runDetailEl.textContent = "Enter the API token and refresh.";
    agentDetailEl.textContent = "Enter the API token and refresh.";
    scheduleDetailEl.textContent = "Enter the API token and refresh.";
    return;
  }

  const [agentsResponse, schedulesResponse, runsResponse] = await Promise.all([
    fetch("/api/agents", { headers: { authorization: `Bearer ${token}` } }),
    fetch("/api/schedules", { headers: { authorization: `Bearer ${token}` } }),
    fetch("/api/runs", { headers: { authorization: `Bearer ${token}` } })
  ]);

  if (sequence !== loadSequence) return;

  if (!agentsResponse.ok || !schedulesResponse.ok || !runsResponse.ok) {
    activeDetail = undefined;
    updateDetailPanels();
    agentsEl.textContent = "API unavailable or unauthorized.";
    schedulesEl.textContent = "API unavailable or unauthorized.";
    runsEl.textContent = "Enter the API token and refresh.";
    runDetailEl.textContent = "Enter the API token and refresh.";
    agentDetailEl.textContent = "Enter the API token and refresh.";
    scheduleDetailEl.textContent = "Enter the API token and refresh.";
    return;
  }

  const agentsJson = (await agentsResponse.json()) as { agents: AgentSummary[] };
  const schedulesJson = (await schedulesResponse.json()) as { schedules: ScheduleSummary[] };
  const runsJson = (await runsResponse.json()) as { runs: RunSummary[] };
  latestAgents = agentsJson.agents;
  latestSchedules = schedulesJson.schedules;
  latestRuns = runsJson.runs;
  if (selectedScheduleId && !latestSchedules.some((schedule) => schedule.id === selectedScheduleId)) selectedScheduleId = undefined;
  renderScheduleAgentOptions();

  agentsEl.innerHTML = agentsJson.agents.length
    ? agentsJson.agents
        .map(
          (agent) =>
            `<div class="row agent-row ${agent.id === selectedAgentId ? "selected" : ""} ${agent.enabled ? "status-enabled" : "status-paused"}"><div><strong>${escapeHtml(agent.name)}</strong><span>${escapeHtml(agent.modelProvider)} / ${escapeHtml(agent.model)} · ${agent.enabled ? "enabled" : "disabled"}</span></div><div class="row-actions"><button class="secondary compact" type="button" data-agent-detail-id="${escapeHtml(agent.id)}">Details</button><button class="secondary compact" type="button" data-agent-trigger-id="${escapeHtml(agent.id)}">Run now</button></div></div>`
        )
        .join("")
    : "No agents yet.";

  agentsEl.querySelectorAll<HTMLButtonElement>("[data-agent-detail-id]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedAgentId = button.dataset.agentDetailId;
      activeDetail = "agent";
      updateDetailPanels();
      void loadAgentDetail();
      agentsEl.querySelectorAll(".agent-row").forEach((row) => row.classList.remove("selected"));
      button.closest(".agent-row")?.classList.add("selected");
    });
  });

  agentsEl.querySelectorAll<HTMLButtonElement>("[data-agent-trigger-id]").forEach((button) => {
    button.addEventListener("click", () => {
      void triggerAgent(button.dataset.agentTriggerId, button);
    });
  });

  schedulesEl.innerHTML = schedulesJson.schedules.length
    ? schedulesJson.schedules
        .map(
          (schedule) =>
            `<div class="row schedule-row ${schedule.id === selectedScheduleId ? "selected" : ""} ${schedule.enabled ? "status-enabled" : "status-paused"}"><div><strong>${escapeHtml(schedule.name)}</strong><span>${escapeHtml(schedule.expression)} -> ${escapeHtml(schedule.queue)} · ${schedule.enabled ? "enabled" : "paused"}</span></div><div class="row-actions"><button class="secondary compact" type="button" data-schedule-detail-id="${escapeHtml(schedule.id)}">Details</button></div></div>`
        )
        .join("")
    : "No schedules yet.";

  schedulesEl.querySelectorAll<HTMLButtonElement>("[data-schedule-detail-id]").forEach((button) => {
    button.addEventListener("click", () => {
      selectSchedule(button.dataset.scheduleDetailId);
    });
  });

  runsEl.innerHTML = runsJson.runs.length
    ? runsJson.runs
        .map(
          (run) =>
            `<button class="row row-button ${run.id === selectedRunId ? "selected" : ""} ${statusClass(run.status)}" type="button" data-run-id="${escapeHtml(run.id)}"><strong>${escapeHtml(run.status)}</strong><span>${escapeHtml(run.id)} on ${escapeHtml(run.queue)} · ${run.artifactCount ?? 0} artifacts</span></button>`
        )
        .join("")
    : "No runs yet.";

  runsEl.querySelectorAll<HTMLButtonElement>("[data-run-id]").forEach((button) => {
    button.addEventListener("click", () => {
      selectRun(button.dataset.runId);
    });
  });

  if (!selectedRunId && runsJson.runs[0]) {
    selectedRunId = runsJson.runs[0].id;
    if (!activeDetail) activeDetail = "run";
  }
  updateDetailPanels();
  await loadAgentDetail();
  renderScheduleDetail();
  await loadRunDetail();
}

async function loadAgentDetail(): Promise<void> {
  const token = tokenInput?.value.trim() || window.localStorage.getItem("event-agent-token") || "";
  const agentDetailEl = document.querySelector("#agent-detail");
  if (!agentDetailEl) return;
  if (!token) {
    agentDetailEl.textContent = "Enter the API token and refresh.";
    return;
  }
  if (!selectedAgentId) {
    agentDetailEl.classList.add("muted");
    agentDetailEl.textContent = "Select an agent to inspect prompt, config, schedules, and runs.";
    updateDetailPanels();
    return;
  }

  const response = await fetch(`/api/agents/${encodeURIComponent(selectedAgentId)}`, {
    headers: { authorization: `Bearer ${token}` }
  });
  if (!response.ok) {
    agentDetailEl.classList.add("muted");
    agentDetailEl.textContent = "Agent detail unavailable.";
    return;
  }

  const json = (await response.json()) as { agent: AgentDetail };
  const agent = json.agent;
  agentDetailEl.classList.remove("muted");
  agentDetailEl.innerHTML = renderAgentDetail(agent);
  agentDetailEl.querySelectorAll<HTMLButtonElement>("[data-agent-detail-trigger-id]").forEach((button) => {
    button.addEventListener("click", () => {
      void triggerAgent(button.dataset.agentDetailTriggerId, button);
    });
  });
  agentDetailEl.querySelectorAll<HTMLButtonElement>("[data-agent-run-id]").forEach((button) => {
    button.addEventListener("click", () => {
      selectRun(button.dataset.agentRunId);
    });
  });
  agentDetailEl.querySelectorAll<HTMLButtonElement>("[data-agent-schedule-trigger-id]").forEach((button) => {
    button.addEventListener("click", () => {
      void triggerSchedule(button.dataset.agentScheduleTriggerId, button);
    });
  });
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

function renderAgentDetail(agent: AgentDetail): string {
  const schedules = latestSchedules.filter((schedule) => schedule.event.type === "agent.trigger" && schedule.event.payload.agentId === agent.id);
  const runs = latestRuns.filter((run) => run.agentId === agent.id).slice(0, 8);
  return `
    <div class="detail-heading inline-heading">
      <div>
        <h3>${escapeHtml(agent.name)}</h3>
        <p class="muted">${escapeHtml(agent.description || "No description.")}</p>
      </div>
      <button class="secondary" type="button" data-agent-detail-trigger-id="${escapeHtml(agent.id)}">Run now</button>
    </div>
    <div class="detail-grid">
      ${detailItem("Status", agent.enabled ? "enabled" : "disabled")}
      ${detailItem("Provider", agent.modelProvider)}
      ${detailItem("Model", agent.model)}
      ${detailItem("Kind", agent.kind)}
      ${detailItem("Slug", agent.slug ?? "n/a")}
      ${detailItem("Output prefix", agent.output.prefix)}
      ${detailItem("Created", formatTime(agent.createdAt))}
      ${detailItem("Updated", formatTime(agent.updatedAt))}
    </div>
    <h3>Prompt</h3>
    <div class="prompt-grid">
      ${codeBlock("System", agent.systemPrompt)}
      ${codeBlock("User Template", agent.userPromptTemplate)}
    </div>
    <h3>Config</h3>
    <div class="prompt-grid">
      ${codeBlock("Resolver Config", JSON.stringify(agent.config, null, 2))}
      ${codeBlock("Output", JSON.stringify(agent.output, null, 2))}
    </div>
    <h3>Schedules</h3>
    <div class="list">${renderAgentSchedules(schedules)}</div>
    <h3>Recent Runs</h3>
    <div class="list">${renderAgentRuns(runs)}</div>
  `;
}

function codeBlock(label: string, value: string): string {
  return `<div class="code-panel"><strong>${escapeHtml(label)}</strong><pre>${escapeHtml(value)}</pre></div>`;
}

function renderAgentSchedules(schedules: ScheduleSummary[]): string {
  if (!schedules.length) return `<div class="muted">No schedules target this agent.</div>`;
  return schedules
    .map(
      (schedule) =>
        `<div class="row schedule-row ${schedule.enabled ? "status-enabled" : "status-paused"}"><div><strong>${escapeHtml(schedule.name)}</strong><span>${escapeHtml(schedule.expression)} · ${escapeHtml(schedule.timezone)} · ${schedule.enabled ? "enabled" : "paused"}</span></div><button class="secondary compact" type="button" data-agent-schedule-trigger-id="${escapeHtml(schedule.id)}">Run now</button></div>`
    )
    .join("");
}

function renderScheduleDetail(): void {
  const scheduleDetailEl = document.querySelector("#schedule-detail");
  if (!scheduleDetailEl) return;
  const schedule = latestSchedules.find((candidate) => candidate.id === selectedScheduleId);
  if (!schedule) {
    scheduleDetailEl.classList.add("muted");
    scheduleDetailEl.textContent = "Select a schedule to inspect and manage it.";
    updateDetailPanels();
    return;
  }

  const agentName = latestAgents.find((agent) => agent.id === schedule.event.payload.agentId)?.name ?? "n/a";
  scheduleDetailEl.classList.remove("muted");
  scheduleDetailEl.innerHTML = `
    <div class="detail-heading inline-heading">
      <div>
        <h3>${escapeHtml(schedule.name)}</h3>
        <p class="muted">${escapeHtml(schedule.enabled ? "Enabled" : "Paused")} · ${escapeHtml(schedule.expression)} · ${escapeHtml(schedule.timezone)}</p>
      </div>
      <div class="detail-actions">
        <button class="secondary" type="button" data-schedule-detail-edit-id="${escapeHtml(schedule.id)}">Edit</button>
        <button class="secondary" type="button" data-schedule-detail-toggle-id="${escapeHtml(schedule.id)}">${schedule.enabled ? "Pause" : "Resume"}</button>
        <button class="secondary" type="button" data-schedule-detail-trigger-id="${escapeHtml(schedule.id)}">Run now</button>
        <button class="secondary danger" type="button" data-schedule-detail-delete-id="${escapeHtml(schedule.id)}">Delete</button>
      </div>
    </div>
    <div class="detail-grid">
      ${detailItem("Status", schedule.enabled ? "enabled" : "paused")}
      ${detailItem("Agent", agentName)}
      ${detailItem("Queue", schedule.queue)}
      ${detailItem("Timezone", schedule.timezone)}
      ${detailItem("Expression", schedule.expression)}
      ${detailItem("Event type", schedule.event.type)}
      ${detailItem("Subject", String(schedule.event.payload.agentId ?? "n/a"))}
      ${detailItem("Schedule", schedule.id)}
    </div>
  `;

  scheduleDetailEl.querySelector<HTMLButtonElement>("[data-schedule-detail-edit-id]")?.addEventListener("click", (event) => {
    editSchedule((event.currentTarget as HTMLButtonElement).dataset.scheduleDetailEditId);
  });
  scheduleDetailEl.querySelector<HTMLButtonElement>("[data-schedule-detail-toggle-id]")?.addEventListener("click", (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    void toggleSchedule(button.dataset.scheduleDetailToggleId, button);
  });
  scheduleDetailEl.querySelector<HTMLButtonElement>("[data-schedule-detail-trigger-id]")?.addEventListener("click", (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    void triggerSchedule(button.dataset.scheduleDetailTriggerId, button);
  });
  scheduleDetailEl.querySelector<HTMLButtonElement>("[data-schedule-detail-delete-id]")?.addEventListener("click", (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    void deleteSchedule(button.dataset.scheduleDetailDeleteId, button);
  });
}

function renderAgentRuns(runs: RunSummary[]): string {
  if (!runs.length) return `<div class="muted">No runs for this agent yet.</div>`;
  return runs
    .map(
      (run) =>
        `<button class="row row-button ${statusClass(run.status)}" type="button" data-agent-run-id="${escapeHtml(run.id)}"><strong>${escapeHtml(run.status)}</strong><span>${escapeHtml(run.id)} · ${formatTime(run.finishedAt ?? run.startedAt ?? run.createdAt)} · ${run.artifactCount ?? 0} artifacts</span></button>`
    )
    .join("");
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
    scheduleRefreshes();
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
    scheduleRefreshes();
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

async function createSchedule(form: HTMLFormElement): Promise<void> {
  const token = tokenInput?.value.trim() || window.localStorage.getItem("event-agent-token") || "";
  if (!token) {
    setStatus("Enter the API token before creating a schedule.", true);
    return;
  }

  const data = new FormData(form);
  const payload = schedulePayloadFromForm(data);
  await saveSchedulePayload(payload, form);
}

function schedulePayloadFromForm(data: FormData) {
  const agentId = String(data.get("agentId") ?? "");
  const agent = latestAgents.find((candidate) => candidate.id === agentId);
  const name = String(data.get("name") ?? "");
  return {
    name,
    expression: String(data.get("expression") ?? ""),
    timezone: String(data.get("timezone") ?? "UTC"),
    enabled: true,
    queue: "default",
    event: {
      source: "event-agent.scheduler",
      type: "agent.trigger",
      subject: agent?.name ? slugify(agent.name) : slugify(name),
      payload: { agentId }
    }
  };
}

async function saveSchedulePayload(payload: ReturnType<typeof schedulePayloadFromForm>, form: HTMLFormElement): Promise<void> {
  const token = tokenInput?.value.trim() || window.localStorage.getItem("event-agent-token") || "";
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  submit?.setAttribute("disabled", "true");
  const isEdit = Boolean(editingScheduleId);
  setStatus(isEdit ? "Updating schedule..." : "Creating schedule...");
  try {
    const response = await fetch(editingScheduleId ? `/api/schedules/${encodeURIComponent(editingScheduleId)}` : "/api/schedules", {
      method: editingScheduleId ? "PATCH" : "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const error = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
      setStatus(error?.error ?? (isEdit ? "Schedule update failed." : "Schedule creation failed."), true);
      return;
    }

    resetScheduleForm();
    renderScheduleAgentOptions();
    setScheduleFormOpen(false);
    setStatus(isEdit ? "Schedule updated." : "Schedule created.");
    await load();
  } catch {
    setStatus(isEdit ? "Schedule update failed." : "Schedule creation failed.", true);
  } finally {
    submit?.removeAttribute("disabled");
  }
}

async function toggleSchedule(scheduleId: string | undefined, button: HTMLButtonElement): Promise<void> {
  const schedule = latestSchedules.find((candidate) => candidate.id === scheduleId);
  if (!schedule) return;
  await patchSchedule(schedule.id, { enabled: !schedule.enabled }, button, schedule.enabled ? "Pausing schedule..." : "Resuming schedule...");
}

async function deleteSchedule(scheduleId: string | undefined, button: HTMLButtonElement): Promise<void> {
  const schedule = latestSchedules.find((candidate) => candidate.id === scheduleId);
  if (!schedule) return;
  if (!window.confirm(`Delete schedule "${schedule.name}"?`)) return;
  const token = tokenInput?.value.trim() || window.localStorage.getItem("event-agent-token") || "";
  if (!token) {
    setStatus("Enter the API token before deleting a schedule.", true);
    return;
  }

  button.disabled = true;
  setStatus("Deleting schedule...");
  try {
    const response = await fetch(`/api/schedules/${encodeURIComponent(schedule.id)}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` }
    });
    if (!response.ok) {
      const error = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
      setStatus(error?.error ?? "Schedule delete failed.", true);
      return;
    }
    if (editingScheduleId === schedule.id) resetScheduleForm();
    if (selectedScheduleId === schedule.id) selectedScheduleId = undefined;
    setStatus("Schedule deleted.");
    await load();
  } catch {
    setStatus("Schedule delete failed.", true);
  } finally {
    button.disabled = false;
  }
}

async function patchSchedule(scheduleId: string, patch: Partial<ScheduleSummary>, button: HTMLButtonElement, statusMessage: string): Promise<void> {
  const token = tokenInput?.value.trim() || window.localStorage.getItem("event-agent-token") || "";
  if (!token) {
    setStatus("Enter the API token before updating a schedule.", true);
    return;
  }

  button.disabled = true;
  setStatus(statusMessage);
  try {
    const response = await fetch(`/api/schedules/${encodeURIComponent(scheduleId)}`, {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(patch)
    });
    if (!response.ok) {
      const error = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
      setStatus(error?.error ?? "Schedule update failed.", true);
      return;
    }
    setStatus("Schedule updated.");
    await load();
  } catch {
    setStatus("Schedule update failed.", true);
  } finally {
    button.disabled = false;
  }
}

function setStatus(message: string, isError = false): void {
  const statusEl = document.querySelector("#status");
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.classList.toggle("error-text", isError);
  statusEl.classList.toggle("muted", !isError);
}

function updateDetailPanels(): void {
  document.querySelector<HTMLElement>("#agent-detail-panel")?.toggleAttribute("hidden", activeDetail !== "agent");
  document.querySelector<HTMLElement>("#schedule-detail-panel")?.toggleAttribute("hidden", activeDetail !== "schedule");
  document.querySelector<HTMLElement>("#run-detail-panel")?.toggleAttribute("hidden", activeDetail !== "run");
}

function scheduleRefreshes(): void {
  for (const delay of [1500, 4000, 8000]) {
    window.setTimeout(() => {
      void load();
    }, delay);
  }
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

function renderScheduleAgentOptions(): void {
  const select = document.querySelector<HTMLSelectElement>("#schedule-agent");
  if (!select) return;
  const current = select.value;
  select.innerHTML = latestAgents
    .map((agent) => `<option value="${escapeHtml(agent.id)}">${escapeHtml(agent.name)}</option>`)
    .join("");
  if (latestAgents.some((agent) => agent.id === current)) select.value = current;
}

function editSchedule(scheduleId: string | undefined): void {
  const schedule = latestSchedules.find((candidate) => candidate.id === scheduleId);
  if (!schedule) return;
  editingScheduleId = schedule.id;
  setScheduleFormOpen(true);
  const nameInput = document.querySelector<HTMLInputElement>("#schedule-name");
  const agentSelect = document.querySelector<HTMLSelectElement>("#schedule-agent");
  const expressionInput = document.querySelector<HTMLInputElement>("#schedule-expression");
  const timezoneInput = document.querySelector<HTMLInputElement>("#schedule-timezone");
  if (nameInput) nameInput.value = schedule.name;
  if (expressionInput) expressionInput.value = schedule.expression;
  if (timezoneInput) timezoneInput.value = schedule.timezone;
  if (agentSelect && typeof schedule.event.payload.agentId === "string") agentSelect.value = schedule.event.payload.agentId;
  setScheduleSubmitLabel();
}

function resetScheduleForm(): void {
  editingScheduleId = undefined;
  const form = document.querySelector<HTMLFormElement>("#schedule-form");
  form?.reset();
  const expressionInput = document.querySelector<HTMLInputElement>("#schedule-expression");
  if (expressionInput) expressionInput.value = "cron(0 9 * * ? *)";
  const timezoneInput = document.querySelector<HTMLInputElement>("#schedule-timezone");
  if (timezoneInput) timezoneInput.value = "America/Los_Angeles";
  renderScheduleAgentOptions();
  setScheduleSubmitLabel();
}

function setScheduleSubmitLabel(): void {
  const submit = document.querySelector<HTMLButtonElement>('#schedule-form button[type="submit"]');
  const title = document.querySelector<HTMLElement>("#schedule-form-title");
  if (submit) submit.textContent = editingScheduleId ? "Save Schedule" : "Create Schedule";
  if (title) title.textContent = editingScheduleId ? "Edit Schedule" : "Create Schedule";
}

function selectRun(runId: string | undefined): void {
  if (!runId) return;
  selectedRunId = runId;
  activeDetail = "run";
  updateDetailPanels();
  void loadRunDetail();
  document.querySelectorAll(".row-button").forEach((row) => row.classList.remove("selected"));
  document.querySelectorAll<HTMLButtonElement>(`[data-run-id="${cssEscape(runId)}"], [data-agent-run-id="${cssEscape(runId)}"]`).forEach((button) =>
    button.classList.add("selected")
  );
}

function selectSchedule(scheduleId: string | undefined): void {
  if (!scheduleId) return;
  selectedScheduleId = scheduleId;
  activeDetail = "schedule";
  updateDetailPanels();
  renderScheduleDetail();
  document.querySelectorAll(".schedule-row").forEach((row) => row.classList.remove("selected"));
  document.querySelectorAll<HTMLElement>(`.schedule-row [data-schedule-detail-id="${cssEscape(scheduleId)}"]`).forEach((button) =>
    button.closest(".schedule-row")?.classList.add("selected")
  );
}

function statusClass(status: string): string {
  const normalized = status.toLowerCase();
  if (["succeeded", "success", "enabled"].includes(normalized)) return "status-enabled";
  if (["running", "in_progress", "processing"].includes(normalized)) return "status-running";
  if (["failed", "error", "deleted", "delete_failed"].includes(normalized)) return "status-danger";
  return "status-paused";
}

function slugify(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "schedule"
  );
}

function cssEscape(value: string): string {
  if ("CSS" in window && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/["\\]/g, "\\$&");
}

document.querySelector("#refresh")?.addEventListener("click", () => {
  void load();
});

document.querySelector("#clear-selection")?.addEventListener("click", () => {
  selectedRunId = undefined;
  activeDetail = undefined;
  updateDetailPanels();
  const runDetailEl = document.querySelector("#run-detail");
  if (runDetailEl) {
    runDetailEl.classList.add("muted");
    runDetailEl.textContent = "Select a run to inspect logs and artifacts.";
  }
  document.querySelectorAll(".row-button").forEach((row) => row.classList.remove("selected"));
});

document.querySelector("#clear-agent-selection")?.addEventListener("click", () => {
  selectedAgentId = undefined;
  activeDetail = undefined;
  updateDetailPanels();
  const agentDetailEl = document.querySelector("#agent-detail");
  if (agentDetailEl) {
    agentDetailEl.classList.add("muted");
    agentDetailEl.textContent = "Select an agent to inspect prompt, config, schedules, and runs.";
  }
  document.querySelectorAll(".agent-row").forEach((row) => row.classList.remove("selected"));
});

document.querySelector("#clear-schedule-selection")?.addEventListener("click", () => {
  selectedScheduleId = undefined;
  activeDetail = undefined;
  updateDetailPanels();
  const scheduleDetailEl = document.querySelector("#schedule-detail");
  if (scheduleDetailEl) {
    scheduleDetailEl.classList.add("muted");
    scheduleDetailEl.textContent = "Select a schedule to inspect and manage it.";
  }
  document.querySelectorAll(".schedule-row").forEach((row) => row.classList.remove("selected"));
});

document.querySelector<HTMLFormElement>("#agent-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  void createAgent(event.currentTarget as HTMLFormElement);
});

document.querySelector<HTMLFormElement>("#schedule-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  void createSchedule(event.currentTarget as HTMLFormElement);
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

function setScheduleFormOpen(open: boolean): void {
  const panel = document.querySelector<HTMLElement>("#schedule-create-panel");
  const toggle = document.querySelector<HTMLButtonElement>("#toggle-schedule-form");
  if (!panel || !toggle) return;
  panel.hidden = !open;
  toggle.setAttribute("aria-expanded", String(open));
  toggle.textContent = open ? "Hide" : "Create";
  renderScheduleAgentOptions();
  setScheduleSubmitLabel();
  if (open) {
    document.querySelector<HTMLInputElement>("#schedule-name")?.focus();
  }
}

document.querySelector("#toggle-agent-form")?.addEventListener("click", () => {
  const panel = document.querySelector<HTMLElement>("#agent-create-panel");
  setAgentFormOpen(Boolean(panel?.hidden));
});

document.querySelector("#close-agent-form")?.addEventListener("click", () => {
  setAgentFormOpen(false);
});

document.querySelector("#toggle-schedule-form")?.addEventListener("click", () => {
  const panel = document.querySelector<HTMLElement>("#schedule-create-panel");
  if (panel?.hidden) resetScheduleForm();
  setScheduleFormOpen(Boolean(panel?.hidden));
});

document.querySelector("#close-schedule-form")?.addEventListener("click", () => {
  resetScheduleForm();
  setScheduleFormOpen(false);
});

document.querySelector("#save-token")?.addEventListener("click", () => {
  const token = tokenInput?.value.trim();
  if (token) window.localStorage.setItem("event-agent-token", token);
  if (!token) window.localStorage.removeItem("event-agent-token");
  void load();
});

void load();
