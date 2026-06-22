const token = window.localStorage.getItem("event-agent-token") ?? "dev-token";

async function load(): Promise<void> {
  const [schedulesResponse, runsResponse] = await Promise.all([
    fetch("/api/schedules", { headers: { authorization: `Bearer ${token}` } }),
    fetch("/api/runs", { headers: { authorization: `Bearer ${token}` } })
  ]);

  const schedulesEl = document.querySelector("#schedules");
  const runsEl = document.querySelector("#runs");
  if (!schedulesEl || !runsEl) return;

  if (!schedulesResponse.ok || !runsResponse.ok) {
    schedulesEl.textContent = "API unavailable or unauthorized.";
    runsEl.textContent = "Set localStorage event-agent-token to the API bearer token.";
    return;
  }

  const schedulesJson = (await schedulesResponse.json()) as { schedules: Array<{ name: string; expression: string; queue: string }> };
  const runsJson = (await runsResponse.json()) as { runs: Array<{ id: string; status: string; queue: string; createdAt: string }> };

  schedulesEl.innerHTML = schedulesJson.schedules.length
    ? schedulesJson.schedules
        .map((schedule) => `<div class="row"><strong>${escapeHtml(schedule.name)}</strong><span>${escapeHtml(schedule.expression)} -> ${escapeHtml(schedule.queue)}</span></div>`)
        .join("")
    : "No schedules yet.";

  runsEl.innerHTML = runsJson.runs.length
    ? runsJson.runs
        .map((run) => `<div class="row"><strong>${escapeHtml(run.status)}</strong><span>${escapeHtml(run.id)} on ${escapeHtml(run.queue)}</span></div>`)
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

void load();

