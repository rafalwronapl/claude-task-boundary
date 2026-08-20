let trendChart;
let decisionChart;
let latestData;

const usd = value => `$${Number(value || 0).toFixed(2)}`;
const number = value => Number(value || 0).toLocaleString();
const el = id => document.getElementById(id);
const tokenInput = () => el("api-token");
const demoMode = location.hostname.endsWith("github.io") || new URLSearchParams(location.search).has("demo");

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
}
function renderSummary(summary) {
  el("cost").textContent = usd(summary.cost_usd);
  el("sessions").textContent = number(summary.sessions);
  el("agents").textContent = number(summary.agents);
  el("leaky-cost").textContent = usd(summary.leaky_cost_usd);
  el("leaky").textContent = number(summary.leaky_sessions);
  el("tokens").textContent = number(summary.tokens_billed);
}
function renderTeams(teams) {
  el("teams-body").innerHTML = teams.length ? teams.map(team => `
    <tr><td>${escapeHtml(team.team_id)}</td><td>${number(team.sessions)}</td>
    <td>${number(team.leaky_sessions)}</td><td>${usd(team.cost_usd)}</td></tr>`).join("")
    : `<tr><td colspan="4">No metrics received.</td></tr>`;
}
function renderSessions(sessions) {
  el("sessions-body").innerHTML = sessions.length ? sessions.map(session => `
    <tr><td><code>${escapeHtml(session.session_id_hash)}</code></td>
    <td>${escapeHtml(session.team_id)}</td><td>${escapeHtml(session.source)}</td>
    <td class="decision-${session.decision}">${escapeHtml(session.decision)}</td>
    <td>${(Number(session.context_pct) * 100).toFixed(0)}%</td>
    <td>${usd(session.cost_usd)}</td><td>${new Date(session.observed_at).toLocaleDateString()}</td></tr>`).join("")
    : `<tr><td colspan="7">No sessions in this period.</td></tr>`;
}
function renderCharts(data) {
  if (!window.Chart) return;
  if (trendChart) trendChart.destroy();
  if (decisionChart) decisionChart.destroy();
  const grid = { color: "#253451" };
  const ticks = { color: "#96a6c5" };
  trendChart = new Chart(el("trend-chart"), {
    type: "line",
    data: { labels: data.trend.map(row => row.day), datasets: [{
      label: "Incremental cost (USD)", data: data.trend.map(row => row.cost_usd),
      borderColor: "#35bdf5", backgroundColor: "#35bdf533", fill: true, tension: .32
    }] },
    options: { plugins: { legend: { labels: ticks } }, scales: { x: { grid, ticks }, y: { grid, ticks } } }
  });
  decisionChart = new Chart(el("decision-chart"), {
    type: "doughnut",
    data: { labels: data.decisions.map(row => row.decision), datasets: [{
      data: data.decisions.map(row => row.sessions),
      backgroundColor: ["#ffb547", "#33d29a", "#35bdf5", "#7587a8", "#d993ff"]
    }] },
    options: { plugins: { legend: { labels: ticks } } }
  });
}

function demoAggregate(days, team) {
  const rows = (window.FINOPS_DEMO_SESSIONS || [])
    .filter(row => row.days_ago < days && (!team || row.team_id === team))
    .map(row => ({
      ...row,
      observed_at: new Date(Date.now() - row.days_ago * 86400000).toISOString()
    }));
  const teamMap = new Map();
  const decisionMap = new Map();
  const trendMap = new Map();
  rows.forEach(row => {
    const teamRow = teamMap.get(row.team_id) || { team_id: row.team_id, sessions: 0, cost_usd: 0, tokens_billed: 0, leaky_sessions: 0 };
    teamRow.sessions += 1;
    teamRow.cost_usd += row.cost_usd;
    teamRow.tokens_billed += row.tokens_billed;
    teamRow.leaky_sessions += row.decision === "new_task" ? 1 : 0;
    teamMap.set(row.team_id, teamRow);
    decisionMap.set(row.decision, (decisionMap.get(row.decision) || 0) + 1);
    const day = row.observed_at.slice(0, 10);
    trendMap.set(day, (trendMap.get(day) || 0) + row.cost_usd);
  });
  const cost = rows.reduce((sum, row) => sum + row.cost_usd, 0);
  const leaky = rows.filter(row => row.decision === "new_task");
  return {
    days,
    team: team || null,
    summary: {
      sessions: rows.length,
      agents: new Set(rows.map(row => row.agent_id_hash)).size,
      cost_usd: cost,
      tokens_billed: rows.reduce((sum, row) => sum + row.tokens_billed, 0),
      leaky_sessions: leaky.length,
      leaky_cost_usd: leaky.reduce((sum, row) => sum + row.cost_usd, 0)
    },
    teams: [...teamMap.values()].sort((a, b) => b.cost_usd - a.cost_usd),
    top_sessions: [...rows].sort((a, b) => (a.decision === "new_task" ? -1 : 1) - (b.decision === "new_task" ? -1 : 1) || b.cost_usd - a.cost_usd).slice(0, 20),
    trend: [...trendMap].sort(([a], [b]) => a.localeCompare(b)).map(([day, cost_usd]) => ({ day, cost_usd })),
    decisions: [...decisionMap].map(([decision, sessions]) => ({ decision, sessions })).sort((a, b) => b.sessions - a.sessions)
  };
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function exportCsv() {
  if (!latestData) return;
  const columns = ["session", "team", "source", "model", "decision", "context_pct", "cost_usd", "tokens_billed", "observed_at"];
  const lines = [columns.join(","), ...latestData.top_sessions.map(row => [
    row.session_id_hash, row.team_id, row.source, row.model, row.decision,
    row.context_pct, row.cost_usd, row.tokens_billed, row.observed_at
  ].map(csvCell).join(","))];
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([lines.join("\n") + "\n"], { type: "text/csv" }));
  link.download = `task-boundary-finops-${latestData.days}d.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function refresh() {
  const params = new URLSearchParams({ days: el("days").value });
  if (el("team").value.trim()) params.set("team", el("team").value.trim());
  const token = tokenInput().value.trim();
  if (token) localStorage.setItem("finopsApiToken", token);
  else localStorage.removeItem("finopsApiToken");
  el("status").className = "status";
  el("status").textContent = "Loading metrics...";
  try {
    let data;
    if (demoMode) {
      data = demoAggregate(Number(el("days").value), el("team").value.trim());
    } else {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const response = await fetch(`/aggregate?${params}`, { headers });
      if (response.status === 401) throw new Error("API token is missing or invalid");
      if (!response.ok) throw new Error(`API returned HTTP ${response.status}`);
      data = await response.json();
    }
    latestData = data;
    renderSummary(data.summary);
    renderTeams(data.teams);
    renderSessions(data.top_sessions);
    renderCharts(data);
    el("status").textContent = `${demoMode ? "Generated demo metrics" : `Updated ${new Date().toLocaleTimeString()}`} | ${data.days}-day view`;
  } catch (error) {
    el("status").className = "status error";
    el("status").textContent = `Failed to load dashboard: ${error.message}`;
  }
}
tokenInput().value = localStorage.getItem("finopsApiToken") || "";
if (demoMode) {
  el("mode-badge").textContent = "DEMO DATA";
  tokenInput().disabled = true;
  tokenInput().placeholder = "not used in demo";
}
el("refresh").addEventListener("click", refresh);
el("export-csv").addEventListener("click", exportCsv);
refresh();
