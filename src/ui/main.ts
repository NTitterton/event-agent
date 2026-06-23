const tokenInput = document.querySelector<HTMLInputElement>("#token");
let loadSequence = 0;

if (tokenInput) {
  tokenInput.value = window.localStorage.getItem("event-agent-token") ?? "";
}

async function load(): Promise<void> {
  const sequence = ++loadSequence;
  const token = tokenInput?.value.trim() || window.localStorage.getItem("event-agent-token") || "";
  const agentsEl = document.querySelector("#agents");
  const schedulesEl = document.querySelector("#schedules");
  const runsEl = document.querySelector("#runs");
  if (!agentsEl || !schedulesEl || !runsEl) return;

  if (!token) {
    agentsEl.textContent = "Enter the API token and refresh.";
    schedulesEl.textContent = "Enter the API token and refresh.";
    runsEl.textContent = "Enter the API token and refresh.";
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
    return;
  }

  const agentsJson = (await agentsResponse.json()) as { agents: Array<{ name: string; modelProvider: string; model: string; enabled: boolean }> };
  const schedulesJson = (await schedulesResponse.json()) as { schedules: Array<{ name: string; expression: string; queue: string }> };
  const runsJson = (await runsResponse.json()) as { runs: Array<{ id: string; status: string; queue: string; createdAt: string; artifactCount?: number }> };

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
            `<div class="row"><strong>${escapeHtml(run.status)}</strong><span>${escapeHtml(run.id)} on ${escapeHtml(run.queue)} · ${run.artifactCount ?? 0} artifacts</span></div>`
        )
        .join("")
    : "No runs yet.";
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

document.querySelector("#save-token")?.addEventListener("click", () => {
  const token = tokenInput?.value.trim();
  if (token) window.localStorage.setItem("event-agent-token", token);
  if (!token) window.localStorage.removeItem("event-agent-token");
  void load();
});

void load();
