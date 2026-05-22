const SHEET_ID = "1myL8VYT_oivDdqBfZO6A6AsC1clzGxvX7wUBALZzgXM";
const STATUS = ["Filled", "Offered", "TBO", "Open", "Cancelled"];
const BLT_COLORS = ["#F75D34", "#5D34F7", "#3643AA", "#25B062", "#F79D34", "#8A8C91", "#DE532E", "#6B7FCC"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FIELD_ALIASES = {
  serialNo: ["s.no.", "s no", "serial no", "serial number"],
  reqId: ["req code", "req_id", "req id", "reqid", "requisition id", "requisition", "jd id"],
  blt: ["bu head", "blt", "leader", "business leader", "bl", "owner", "blt name"],
  businessUnit: ["business unit", "bu"],
  span: ["span", "business", "business span", "vertical", "department"],
  role: ["designation", "role_title", "job title", "position", "role"],
  location: ["location", "city"],
  zone: ["zone", "region"],
  band: ["band", "grade", "level"],
  reqType: ["vacancy type newreplacement", "vacancy type", "req_type", "req type", "hiring_mode", "hiring mode", "new/replacement", "requirement type"],
  reqOpenMonth: ["month & year", "month year", "req_open_month", "req open month", "open month", "opened month"],
  reqOpenDate: ["vacancy assigned date", "req_open_date", "req open date", "opening date", "created date"],
  status: ["vacancy status openfilledofferedtbocancelled", "vacancy status", "final status openfilled", "status", "current status"],
  tat: ["tat calendar days", "tat net work days", "tat", "turnaround time", "age", "days open"],
  overBudget: ["over_budget", "over budget", "budget", "budget status"],
  hike: ["hike_pct", "hike %", "hike", "hike given"],
  sourceMix: ["source_mix", "source mix", "source", "channel", "sourcing channel"],
  recruiter: ["recruiter name", "lead recruiter", "recruiter", "ta", "ta owner", "assigned recruiter"],
  offerMonth: ["offer_month", "offer month"],
  dojMonth: ["doj_month", "doj month", "joining month"],
  offerDate: ["offer accepted date", "offer_date", "offer date"],
  joiningDate: ["joining_date", "joining date", "doj", "date of joining"],
  offeredCtc: ["overall ctc", "offered fixed", "offered_ctc", "offered ctc", "offer ctc"],
  maxBudget: ["max_budget", "max budget", "approved budget"]
};

const state = {
  rows: [],
  filters: { blt: new Set(), businessUnit: new Set(), status: new Set(), reqType: new Set(), band: new Set(), fy: new Set() },
  search: "",
  view: "overview",
  lens: "all",
  scope: { type: "all", value: "All" },
  sort: { table: "business", key: "closure", dir: "desc" },
  shareable: true,
  pollTimer: null,
  lastGoodSync: null
};

const $ = (id) => document.getElementById(id);
const pct = (n) => Number.isFinite(n) ? `${Math.round(n * 100)}%` : "NA";
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const safe = (v) => v == null || v === "" ? "Unknown" : String(v).trim();
const normalizeHeader = (h) => String(h || "").toLowerCase().trim().replace(/\s+/g, " ").replace(/[^\w% /-]/g, "");

function csvUrl(gid) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${encodeURIComponent(gid)}`;
  // Use CORS proxy for GitHub Pages compatibility
  return `https://cors-anywhere.herokuapp.com/${url}`;
}

function jsonpUrl(gid, callbackName) {
  const tqx = `out:json;responseHandler:${callbackName}`;
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=${encodeURIComponent(tqx)}&gid=${encodeURIComponent(gid)}`;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"' && quoted && next === '"') {
      cell += '"';
      i++;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (ch === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && next === "\n") i++;
      row.push(cell);
      if (row.some((v) => v.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some((v) => v.trim() !== "")) rows.push(row);
  return rows;
}

function makeMapper(headers) {
  const normalized = headers.map(normalizeHeader);
  const findIndex = (aliases) => {
    const wanted = aliases.map(normalizeHeader);
    let idx = -1;
    for (const alias of wanted) {
      idx = normalized.findIndex((h) => h && h === alias);
      if (idx !== -1) return idx;
    }
    idx = normalized.findIndex((h) => h && wanted.some((w) => h.includes(w)));
    if (idx !== -1) return idx;
    return -1;
  };
  const map = {};
  Object.entries(FIELD_ALIASES).forEach(([field, aliases]) => {
    map[field] = findIndex(aliases);
  });
  return (cells) => {
    const out = {};
    Object.keys(FIELD_ALIASES).forEach((field) => {
      const idx = map[field];
      out[field] = idx >= 0 ? cells[idx] : "";
    });
    return out;
  };
}

function parseNumber(value) {
  if (value == null || value === "") return null;
  const cleaned = String(value).replace(/,/g, "").replace(/%/g, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return String(value).includes("%") ? n / 100 : n;
}

function parseMonth(value, fallbackDate) {
  const raw = String(value || "").trim();
  if (raw) {
    const match = raw.match(/([A-Za-z]{3,})[\s'-]*(\d{2,4})/);
    if (match) {
      const m = MONTHS.findIndex((x) => x.toLowerCase() === match[1].slice(0, 3).toLowerCase());
      const yy = match[2].length === 2 ? Number(`20${match[2]}`) : Number(match[2]);
      if (m >= 0 && yy) return `${MONTHS[m]}-${String(yy).slice(-2)}`;
    }
  }
  const d = parseDate(fallbackDate);
  if (d) return `${MONTHS[d.getMonth()]}-${String(d.getFullYear()).slice(-2)}`;
  return "";
}

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function monthToFY(dojMonth) {
  if (!dojMonth) return null;
  const match = dojMonth.match(/^([A-Za-z]{3})-(\d{2,4})$/);
  if (!match) return null;
  const mIdx = MONTHS.findIndex((m) => m.toLowerCase() === match[1].toLowerCase());
  if (mIdx < 0) return null;
  const yy = Number(match[2]) % 100;
  // April (idx 3) onwards is the start of the next FY; Jan-Mar belongs to current FY
  if (mIdx >= 3) {
    return `FY ${yy}-${yy + 1}`;
  } else {
    return `FY ${yy - 1}-${yy}`;
  }
}

function normalizeStatus(value) {
  const raw = safe(value).toLowerCase().replace(/[^a-z]/g, "");
  if (raw.includes("cancel")) return "Cancelled";
  if (raw.includes("fill") || raw.includes("join")) return "Filled";
  if (raw.includes("offer") && !raw.includes("tbo") && !raw.includes("tobe")) return "Offered";
  if (raw === "tbo" || raw.includes("tobeoffered") || raw.includes("selected")) return "TBO";
  return "Open";
}

function normalizeRow(row, idx, sourceGid) {
  const status = normalizeStatus(row.status);
  const reqOpenDate = parseDate(row.reqOpenDate);
  const offerDate = parseDate(row.offerDate);
  const joiningDate = parseDate(row.joiningDate);
  const tatRaw = parseNumber(row.tat);
  const today = new Date();
  const derivedTat = reqOpenDate ? Math.max(0, Math.round(((status === "Open" ? today : (offerDate || joiningDate || today)) - reqOpenDate) / 86400000)) : null;
  const overBudgetRaw = safe(row.overBudget).toLowerCase();
  const offeredCtc = parseNumber(row.offeredCtc);
  const maxBudget = parseNumber(row.maxBudget);
  const overBudget = overBudgetRaw.includes("yes") || (offeredCtc != null && maxBudget != null && maxBudget > 0 && offeredCtc > maxBudget) ? "Yes" : "No";
  const hikeRaw = parseNumber(row.hike);
  return {
    id: `${sourceGid}-${idx}`,
    serialNo: safe(row.serialNo) === "Unknown" ? "" : safe(row.serialNo),
    reqId: safe(row.reqId) === "Unknown" ? `REQ-${idx + 1}` : safe(row.reqId),
    blt: safe(row.blt),
    businessUnit: safe(row.businessUnit) === "Unknown" ? safe(row.span) : safe(row.businessUnit),
    span: safe(row.span),
    role: safe(row.role),
    location: safe(row.location),
    zone: safe(row.zone) === "Unknown" ? inferZone(row.location) : safe(row.zone),
    band: safe(row.band),
    reqType: safe(row.reqType),
    reqOpenMonth: parseMonth(row.reqOpenMonth, row.reqOpenDate),
    reqOpenDate,
    status,
    tat: tatRaw != null ? Math.round(tatRaw) : derivedTat,
    overBudget,
    hike: hikeRaw != null && hikeRaw > 1 ? hikeRaw / 100 : hikeRaw,
    sourceMix: safe(row.sourceMix),
    recruiter: safe(row.recruiter),
    offerMonth: parseMonth(row.offerMonth, row.offerDate),
    dojMonth: parseMonth(row.dojMonth, row.joiningDate),
    fy: monthToFY(parseMonth(row.dojMonth, row.joiningDate) || parseMonth(row.offerMonth, row.offerDate) || parseMonth(row.reqOpenMonth, row.reqOpenDate)),
    offeredCtc,
    maxBudget
  };
}

function inferZone(location) {
  const city = safe(location).toLowerCase();
  const north = ["delhi", "gurugram", "gurgaon", "noida", "jaipur", "lucknow", "kanpur", "chandigarh", "ludhiana", "dehradun", "jodhpur", "ajmer", "meerut", "bareilly", "allahabad", "varanasi"];
  const west = ["mumbai", "pune", "ahmedabad", "vadodara", "surat", "nashik", "indore", "bhopal", "rajkot"];
  const south = ["bangalore", "bengaluru", "hyderabad", "chennai", "kochi", "cochin", "mysore", "vizag", "vijayawada", "karimnagar", "kollam"];
  const east = ["kolkata", "ranchi", "patna", "bhubaneswar", "guwahati", "jamshedpur", "dhanbad", "raipur"];
  if (north.some((x) => city.includes(x))) return "North";
  if (west.some((x) => city.includes(x))) return "West";
  if (south.some((x) => city.includes(x))) return "South";
  if (east.some((x) => city.includes(x))) return "East";
  return "Unknown";
}

async function syncData() {
  const button = $("syncButton");
  button.disabled = true;
  button.textContent = "Syncing...";
  setSyncMeta("Connecting to Google Sheets...");
  try {
    const gids = $("gidInput").value.split(",").map((v) => v.trim()).filter(Boolean);
    const allRows = [];
    for (const gid of gids.length ? gids : ["0"]) {
      const matrix = await fetchSheetMatrix(gid);
      if (matrix.length < 2) continue;
      const mapper = makeMapper(matrix[0]);
      matrix.slice(1).forEach((cells, idx) => {
        const row = normalizeRow(mapper(cells), idx, gid);
        if (isValidTrackerRecord(row)) allRows.push(row);
      });
    }
    state.rows = dedupeRows(allRows);
    state.lastGoodSync = new Date();
    localStorage.setItem("ta-dashboard-cache", JSON.stringify({ rows: state.rows, syncedAt: state.lastGoodSync.toISOString() }));
    const fyCount = {};
    state.rows.forEach(r => {
      if (r.fy) fyCount[r.fy] = (fyCount[r.fy] || 0) + 1;
    });
    console.log("Data loaded:", { total: state.rows.length, byFY: fyCount });
    setSyncMeta(`Synced ${state.rows.length} reqs at ${state.lastGoodSync.toLocaleTimeString()}`);
    buildFilters();
    render();
  } catch (error) {
    loadCachedRows();
    setSyncMeta(`Sync failed: ${error.message}`);
    $("narrativeBanner").className = "narrative-banner risk";
    $("narrativeText").textContent = state.rows.length
      ? `Using last good cached data. Google Sheets sync failed: ${error.message}`
      : `Google Sheets sync failed. Make the sheet readable to anyone with the link or publish the tab, then click Sync data.`;
    render();
  } finally {
    button.disabled = false;
    button.textContent = "Sync data";
  }
}

async function fetchSheetMatrix(gid) {
  try {
    const response = await fetch(csvUrl(gid), { cache: "no-store" });
    if (!response.ok) throw new Error(`Google Sheets returned ${response.status}`);
    const text = await response.text();
    if (/<!doctype html|<html/i.test(text)) throw new Error("Sheet did not return CSV. Check sharing or gid.");
    return parseCsv(text);
  } catch (error) {
    return fetchSheetMatrixJsonp(gid);
  }
}

function fetchSheetMatrixJsonp(gid) {
  return new Promise((resolve, reject) => {
    const callbackName = `__taSheetCallback_${Date.now()}_${Math.round(Math.random() * 100000)}`;
    const script = document.createElement("script");
    const cleanup = () => {
      delete window[callbackName];
      script.remove();
    };
    window[callbackName] = (payload) => {
      cleanup();
      if (payload?.status === "error") {
        reject(new Error(payload.errors?.[0]?.detailed_message || "Google Sheets returned an error"));
        return;
      }
      resolve(gvizToMatrix(payload));
    };
    script.onerror = () => {
      cleanup();
      reject(new Error("Google Sheets script sync failed. Check sheet sharing and network access."));
    };
    script.src = jsonpUrl(gid, callbackName);
    document.head.appendChild(script);
  });
}

function gvizToMatrix(payload) {
  const cols = payload?.table?.cols || [];
  const rows = payload?.table?.rows || [];
  const headers = cols.map((col) => col.label || col.id || "");
  const body = rows.map((row) => (row.c || []).map((cell) => cell?.f ?? cell?.v ?? ""));
  return [headers, ...body];
}

function dedupeRows(rows) {
  const seen = new Map();
  rows.forEach((row) => seen.set(row.reqId.trim(), row));
  return [...seen.values()];
}

function isValidTrackerRecord(row) {
  return row.reqId && row.reqId !== "Unknown";
}

function loadCachedRows() {
  try {
    const cached = JSON.parse(localStorage.getItem("ta-dashboard-cache") || "{}");
    if (Array.isArray(cached.rows)) {
      state.rows = cached.rows
        .map((r) => ({ ...r, businessUnit: r.businessUnit || r.span || "Unknown", reqOpenDate: parseDate(r.reqOpenDate) }))
        .filter(isValidTrackerRecord);
      state.lastGoodSync = cached.syncedAt ? new Date(cached.syncedAt) : null;
    }
  } catch {
    state.rows = [];
  }
}

function setSyncMeta(text) {
  $("syncMeta").textContent = text;
}

function unique(rows, key) {
  return [...new Set(rows.map((r) => r[key]).filter((v) => v && v !== "Unknown"))].sort((a, b) => a.localeCompare(b));
}

function buildFilters() {
  const config = [
    ["blt", "Leader"],
    ["businessUnit", "Business Unit"],
    ["status", "Status"],
    ["reqType", "Req Type"],
    ["band", "Band"],
    ["fy", "Financial Year"]
  ];
  $("filters").innerHTML = config.map(([key, label]) => {
    let values;
    if (key === "status") values = STATUS;
    else if (key === "fy") values = [...new Set(state.rows.map((r) => r.fy).filter(Boolean))].sort((a, b) => {
      const aNum = parseInt(a.match(/\d+/)[0]);
      const bNum = parseInt(b.match(/\d+/)[0]);
      return aNum - bNum;
    });
    else values = unique(state.rows, key).slice(0, 14);
    const checks = values.map((v) => `<label class="check-option"><input type="checkbox" data-filter="${key}" value="${escapeHtml(v)}"> <span>${escapeHtml(v)}</span></label>`).join("");
    return `<div class="filter-group"><label>${label}</label><details class="multi-filter"><summary id="summary-${key}">All ${label}</summary><div class="check-list">${checks}</div></details></div>`;
  }).join("");
  updateFilterSummaries();
  renderScopeTabs();
}

function updateFilterSummaries() {
  const labels = { blt: "Leader", businessUnit: "Business Unit", status: "Status", reqType: "Req Type", band: "Band", fy: "Financial Year" };
  Object.entries(labels).forEach(([key, label]) => {
    const summary = $(`summary-${key}`);
    if (!summary) return;
    const set = state.filters[key];
    summary.textContent = set.size ? `${set.size} ${label}${set.size > 1 ? "s" : ""} selected` : `All ${label}`;
  });
}

function renderScopeTabs() {
  const buTabs = unique(state.rows, "businessUnit").map((value) => ["bu", value]);
  const leadTabs = unique(state.rows, "blt").map((value) => ["lead", value]);
  const tabs = [["all", "All"], ...buTabs, ...leadTabs];
  const label = ([type, value]) => type === "bu" ? `BU: ${value}` : type === "lead" ? `Lead: ${value}` : value;
  const target = $("scopeTabs");
  if (!target) return;
  target.innerHTML = tabs.map(([type, value]) => {
    const active = state.scope.type === type && state.scope.value === value ? "active" : "";
    return `<button class="scope-tab ${active}" type="button" data-scope-type="${escapeHtml(type)}" data-scope-value="${escapeHtml(value)}">${escapeHtml(label([type, value]))}</button>`;
  }).join("");
}

function filteredRows() {
  const q = state.search.toLowerCase().trim();
  return state.rows.filter((row) => {
    if (state.scope.type === "bu" && row.businessUnit !== state.scope.value) return false;
    if (state.scope.type === "lead" && row.blt !== state.scope.value) return false;
    for (const [key, set] of Object.entries(state.filters)) {
      if (set.size && !set.has(row[key])) return false;
    }
    if (!q) return true;
    return [row.reqId, row.blt, row.span, row.role, row.location, row.zone, row.band, row.status, row.recruiter]
      .join(" ").toLowerCase().includes(q);
  });
}

function metrics(rows) {
  const total = rows.length;
  const cancelled = rows.filter((r) => r.status === "Cancelled").length;
  const filled = rows.filter((r) => r.status === "Filled").length;
  const offered = rows.filter((r) => r.status === "Offered").length;
  const tbo = rows.filter((r) => r.status === "TBO").length;
  const open = rows.filter((r) => r.status === "Open").length;
  const active = rows.filter((r) => ["Open", "TBO", "Offered"].includes(r.status)).length;
  const closedRows = rows.filter((r) => ["Filled", "Offered"].includes(r.status));
  const budgetRows = closedRows.filter((r) => r.maxBudget || r.overBudget);
  const openRows = rows.filter((r) => r.status === "Open");
  const activeRows = rows.filter((r) => r.status !== "Cancelled");
  const freshOpen = openRows.filter((r) => (r.tat ?? 999) < 30).length;
  const closure = (filled + offered > 0 && active + filled > 0) ? (filled + offered) / (active + filled) : null;
  const freshPct = openRows.length ? freshOpen / openRows.length : null;
  const budgetPct = budgetRows.length ? budgetRows.filter((r) => r.overBudget !== "Yes").length / budgetRows.length : null;
  const tatMed = median(activeRows.map((r) => r.tat));
  const tatAvg = mean(activeRows.map((r) => r.tat));
  const avgHike = mean(closedRows.map((r) => r.hike));
  const cancelRate = total ? cancelled / total : null;
  const health = healthScore({ closure, tatMed, freshPct, budgetPct });
  return { total, active, filled, offered, tbo, open, cancelled, closure, freshOpen, freshPct, budgetPct, tatMed, tatAvg, avgHike, cancelRate, health };
}

function median(values) {
  const clean = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!clean.length) return null;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
}

function mean(values) {
  const clean = values.filter((v) => Number.isFinite(v));
  return clean.length ? clean.reduce((a, b) => a + b, 0) / clean.length : null;
}

function healthScore(m) {
  const closure = (m.closure ?? 0) * 40;
  const tat = (1 - clamp((m.tatMed ?? 45) / 45, 0, 1)) * 25;
  const fresh = (m.freshPct ?? 0) * 20;
  const budget = (m.budgetPct ?? 0) * 15;
  return Math.round(closure + tat + fresh + budget);
}

function statusClass(value, inverse = false) {
  if (!Number.isFinite(value)) return "warn";
  if (inverse) {
    if (value <= 10) return "good";
    if (value <= 30) return "warn";
    return "risk";
  }
  if (value >= 0.75) return "good";
  if (value >= 0.45) return "warn";
  return "risk";
}

function indicatorText(cls) {
  return cls === "risk" ? "Risk" : cls === "warn" ? "Watch" : "Healthy";
}

function unitAction(m) {
  if ((m.tatAvg ?? 0) > 30) return { cls: "risk", label: "Gap", text: `Avg TAT is ${Math.round(m.tatAvg)}d. Prioritize aging open roles.` };
  if ((m.freshPct ?? 1) < 0.7 && m.open > 0) return { cls: "risk", label: "Risk", text: `${pct(m.freshPct)} open pipeline is fresh. Review old reqs first.` };
  if ((m.budgetPct ?? 1) < 0.75) return { cls: "warn", label: "Watch", text: `${pct(m.budgetPct)} within budget. Check compensation exceptions.` };
  if ((m.closure ?? 0) >= 0.75) return { cls: "good", label: "Opportunity", text: "Strong closure. Reuse this BU's sourcing pattern." };
  return { cls: "warn", label: "Focus", text: "Improve offer conversion and keep open roles moving." };
}

function topAction(rows) {
  const m = metrics(rows);
  const oldOpen = rows.filter((r) => r.status === "Open" && (r.tat ?? 0) > 60).length;
  if (oldOpen) return `${oldOpen} open roles are above 60 days`;
  if ((m.closure ?? 0) < 0.45) return "closure rate is below target";
  if ((m.budgetPct ?? 1) < 0.75) return "budget discipline needs review";
  if (m.tbo > 0) return `${m.tbo} TBOs can be converted into offers`;
  return "pipeline is stable; look for repeatable wins";
}

function executiveActions(rows) {
  const byBu = [...groupBy(rows, "businessUnit").entries()]
    .filter(([businessUnit]) => businessUnit && businessUnit !== "Unknown")
    .map(([businessUnit, group]) => ({ businessUnit, group, m: metrics(group) }));
  const oldOpen = rows.filter((r) => r.status === "Open" && (r.tat ?? 0) > 60).sort((a, b) => (b.tat ?? 0) - (a.tat ?? 0));
  const tboRows = rows.filter((r) => r.status === "TBO");
  const weakBu = byBu.filter((x) => x.m.active > 0).sort((a, b) => (a.m.closure ?? 1) - (b.m.closure ?? 1))[0];
  const slowBu = byBu.filter((x) => x.m.open > 0).sort((a, b) => (b.m.tatAvg ?? 0) - (a.m.tatAvg ?? 0))[0];
  const strongBu = byBu.filter((x) => x.m.active > 0).sort((a, b) => (b.m.closure ?? 0) - (a.m.closure ?? 0))[0];
  const recruiterRisk = [...groupBy(rows, "recruiter").entries()]
    .filter(([name]) => name !== "Unknown")
    .map(([name, group]) => ({ name, group, m: metrics(group), oldOpen: group.filter((r) => r.status === "Open" && (r.tat ?? 0) > 60).length }))
    .sort((a, b) => (b.oldOpen - a.oldOpen) || (b.m.active - a.m.active))[0];
  const actions = [];
  if (oldOpen.length) actions.push({
    type: "risk", typeLabel: "Risk", cls: "risk",
    title: `${oldOpen.length} open roles above 60 days`,
    body: `Oldest is ${oldOpen[0].reqId} in ${oldOpen[0].businessUnit} at ${oldOpen[0].tat} days.`,
    ask: "Ask business to unblock feedback, budget, or role priority.",
    tooltip: "Aging open roles are the highest risk to closure and business confidence."
  });
  if (weakBu) actions.push({
    type: "risk", typeLabel: "Gap", cls: "risk",
    title: `${weakBu.businessUnit} has weakest closure`,
    body: `${pct(weakBu.m.closure)} closure across ${weakBu.m.active} active reqs.`,
    ask: "Align on interview capacity and offer decision SLA.",
    tooltip: "Lowest closure BU among active hiring groups."
  });
  if (tboRows.length) actions.push({
    type: "risk", typeLabel: "Conversion", cls: "warn",
    title: `${tboRows.length} TBOs awaiting offer movement`,
    body: `TBO conversion can improve closure without adding sourcing load.`,
    ask: "Push approvals, comp sign-off, and candidate communication.",
    tooltip: "TBOs are near-closure opportunities that can be converted quickly."
  });
  if (recruiterRisk && recruiterRisk.oldOpen) actions.push({
    type: "risk", typeLabel: "Capacity", cls: "warn",
    title: `${recruiterRisk.name} carries ${recruiterRisk.oldOpen} aged open reqs`,
    body: `${recruiterRisk.m.active} active reqs with ${pct(recruiterRisk.m.closure)} closure.`,
    ask: "Review load balance and aged-role support.",
    tooltip: "Recruiter load signal combines active reqs, aged reqs, and closure."
  });
  if (strongBu) actions.push({
    type: "opportunity", typeLabel: "Opportunity", cls: "good",
    title: `Replicate ${strongBu.businessUnit} closure pattern`,
    body: `${pct(strongBu.m.closure)} closure with ${Math.round(strongBu.m.tatAvg ?? 0)}d avg TAT.`,
    ask: "Identify source/channel and interviewer practices to reuse.",
    tooltip: "High-performing BU pattern can guide lower-performing groups."
  });
  if (slowBu && (slowBu.m.tatAvg ?? 0) > 30) actions.push({
    type: "opportunity", typeLabel: "Process", cls: "warn",
    title: `${slowBu.businessUnit} has TAT improvement headroom`,
    body: `${Math.round(slowBu.m.tatAvg)}d avg TAT on open load.`,
    ask: "Cut pending interview and feedback loops.",
    tooltip: "High TAT indicates process latency or low business responsiveness."
  });
  return actions.length ? actions : [{
    type: "opportunity", typeLabel: "Stable", cls: "good",
    title: "Pipeline is stable",
    body: "No major risk threshold is currently triggered.",
    ask: "Use the BU scorecards to identify repeatable wins.",
    tooltip: "No high-severity action found in the current filter."
  }];
}

function render() {
  const rows = filteredRows();
  $("filterCount").textContent = `${rows.length} of ${state.rows.length} reqs`;
  document.body.dataset.view = state.view;
  if (!state.rows.length) {
    renderEmpty();
    return;
  }
  renderNarrative(rows);
  renderExecutiveSummary(rows);
  renderKpis(rows);
  renderBusinessUnitCards(rows);
  renderAging(rows);
  renderMonthStack("offersChart", rows.filter((r) => r.offerMonth), "offerMonth");
  renderMonthStack("joinersChart", rows.filter((r) => r.dojMonth && monthIndex(r.dojMonth) >= monthIndex("Apr-26")), "dojMonth");
  renderBudget(rows);
  renderSource(rows);
  renderRecruiters(rows);
  renderTatBuckets(rows);
  renderInsights(rows);
  renderDataQuality(rows);
  renderDetail(rows);
}

function renderEmpty() {
  const empty = $("emptyState").innerHTML;
  ["executiveSummary", "kpiGrid", "businessUnitCards", "agingChart", "offersChart", "joinersChart", "budgetChart", "sourceChart", "recruiterList", "tatBuckets", "insights", "dataQuality", "detailBody"].forEach((id) => {
    $(id).innerHTML = empty;
  });
  $("filterCount").textContent = "0 of 0 reqs";
  $("tableFoot").textContent = "";
}

function renderNarrative(rows) {
  const m = metrics(rows);
  const banner = $("narrativeBanner");
  banner.className = `narrative-banner ${statusClass(m.closure) === "risk" || statusClass(m.freshPct) === "risk" ? "risk" : statusClass(m.closure) === "warn" ? "warn" : ""}`;
  const focus = topAction(rows);
  $("narrativeText").textContent = `Of ${m.active} active reqs, ${pct(m.closure)} are Filled or Offered. Median TAT is ${m.tatMed ?? "NA"}d. ${pct(m.freshPct)} of open pipeline is under 30 days old. Priority: ${focus}.`;
}

function renderExecutiveSummary(rows) {
  const actions = executiveActions(rows);
  const visible = state.lens === "all" ? actions : actions.filter((a) => a.type === state.lens);
  const fallback = visible.length ? visible : actions.slice(0, 3);
  $("executiveSummary").innerHTML = `
    <div class="summary-head">
      <div>
        <h2>Executive Action Summary</h2>
        <p>Use these points to guide the next BU or business-counterpart review.</p>
      </div>
      <div class="lens-tabs" aria-label="Action lens">
        ${["all", "risk", "opportunity"].map((lens) => `<button class="lens-tab ${state.lens === lens ? "active" : ""}" type="button" data-lens="${lens}">${lens === "all" ? "All" : lens[0].toUpperCase() + lens.slice(1)}</button>`).join("")}
      </div>
    </div>
    <div class="summary-scroll">
      <div class="summary-grid">
        ${fallback.map((item) => `
          <article class="summary-card ${item.cls}" data-tooltip="${escapeHtml(item.tooltip)}">
            <div class="summary-type-badge ${item.type === "opportunity" ? "good" : "risk"}">${item.type === "opportunity" ? "Opportunity" : "Risk"}</div>
            <div class="summary-label"><span class="signal-dot ${item.cls}"></span>${escapeHtml(item.typeLabel)}</div>
            <strong>${escapeHtml(item.title)}</strong>
            <p>${escapeHtml(item.body)}</p>
            <em>${escapeHtml(item.ask)}</em>
          </article>
        `).join("")}
      </div>
    </div>`;
}

function renderKpis(rows) {
  const m = metrics(rows);
  const distribution = [
    ["Filled", m.filled, "var(--chart-good)", "Joined / closed successfully"],
    ["Offered", m.offered, "var(--chart-seg-1)", "Offer released / awaiting joining"],
    ["Open", m.open, "var(--chart-warn)", `${pct(m.freshPct)} under 30 days`],
    ["TBOs", m.tbo, "var(--chart-seg-2)", "Selected, offer paperwork pending"],
    ["Cancelled", m.cancelled, "var(--red)", "Cancelled / closed-out reqs"]
  ];

  const closureTarget = 0.75;
  const closureDiff = m.closure - closureTarget;
  const closureAnalysis = closureDiff >= 0 ? `+${pct(closureDiff)} - target 75%` : `${pct(closureDiff)} - target 75%`;
  const closureAnalysisCls = closureDiff >= 0 ? "good-text" : "risk-text";

  const tatTarget = 45;
  const tatDiff = m.tatAvg - tatTarget;
  const tatAnalysis = tatDiff <= 0 ? `${Math.round(tatDiff)}d - target â‰¤45` : `+${Math.round(tatDiff)}d - target â‰¤45`;
  const tatAnalysisCls = tatDiff <= 0 ? "good-text" : "risk-text";

  const hikeTarget = 0.35;
  const hikeDiff = m.avgHike - hikeTarget;
  const hikeAnalysis = hikeDiff <= 0 ? `-${pct(Math.abs(hikeDiff))} - target â‰¤35%` : `+${pct(hikeDiff)} - target â‰¤35%`;
  const hikeAnalysisCls = hikeDiff <= 0 ? "good-text" : "risk-text";

  const cards = [
    ["Closure Rate", pct(m.closure), `${m.filled} filled + ${m.offered} offered`, closureAnalysis, closureAnalysisCls, statusClass(m.closure), indicatorText(statusClass(m.closure))],
    ["Avg TAT", m.tatAvg == null ? "NA" : `${Math.round(m.tatAvg)}d`, "Average calendar days", tatAnalysis, tatAnalysisCls, statusClass(m.tatAvg, true), indicatorText(statusClass(m.tatAvg, true))],
    ["Avg Hike", pct(m.avgHike), "Filled + offered roles", hikeAnalysis, hikeAnalysisCls, m.avgHike > 0.35 ? "warn" : "good", m.avgHike > 0.35 ? "Cost watch" : "In range"]
  ];

  const distributionCard = `
    <article class="kpi-card distribution-card good" data-tooltip="Total Positions: ${m.total}. Active: ${m.active}. Closed: ${m.cancelled}.">
      <div class="signal-pill good">Volume</div>
      <div class="value">${m.total}</div>
      <div class="label">Total Positions</div>
      <div class="sub">${m.active} active, ${m.cancelled} closed</div>
      <div class="distribution-bar">
        ${distribution.map(([label, count, color, note]) => {
          const share = m.total ? count / m.total : 0;
          return `<div class="distribution-seg" data-tooltip="${escapeHtml(label)}: ${count} (${pct(share)}). ${escapeHtml(note)}" style="width:${share * 100}%;background:${color}"></div>`;
        }).join("")}
      </div>
      <div class="distribution-list">
        ${distribution.map(([label, count, color, note]) => {
          const share = m.total ? count / m.total : 0;
          return `<div class="distribution-item" data-tooltip="${escapeHtml(note)}"><i style="background:${color}"></i><span>${escapeHtml(label)}</span><strong>${count} (${pct(share)})</strong></div>`;
        }).join("")}
      </div>
    </article>`;
  $("kpiGrid").innerHTML = distributionCard + cards.map(([label, value, sub, analysis, analysisCls, cls, indicator]) => `
    <article class="kpi-card ${cls}" data-tooltip="${escapeHtml(label)}: ${escapeHtml(value)}. ${escapeHtml(sub)}">
      <div class="signal-pill ${cls}">${escapeHtml(indicator)}</div>
      <div class="value">${value}</div>
      <div class="label">${label}</div>
      <div class="sub">${sub}</div>
      <div class="analysis-bar">
        <span class="${analysisCls}">${escapeHtml(analysis)}</span>
        <div class="bar-track"><div class="bar-fill ${cls}" style="height:3px"></div></div>
      </div>
    </article>
  `).join("");
}

function groupBy(rows, key) {
  return rows.reduce((map, row) => {
    const value = row[key] || "Unknown";
    if (!map.has(value)) map.set(value, []);
    map.get(value).push(row);
    return map;
  }, new Map());
}

function renderBusinessUnitCards(rows) {
  const isLeadView = state.scope.type === "lead";
  const groupKey = isLeadView ? "span" : "businessUnit";
  const title = isLeadView ? "Span Wise Scorecard" : "Business Unit Scorecard";
  const subtitle = isLeadView
    ? `Lead: ${state.scope.value}. Closure, active load, budget discipline, source mix, and open vintage by Span.`
    : "Closure, active load, budget discipline and source mix by BU.";
  $("scorecardTitle").textContent = title;
  $("scorecardSubtitle").textContent = subtitle;
  const grouped = [...groupBy(rows, groupKey).entries()]
    .map(([scopeName, group]) => ({ scopeName, rows: group, m: metrics(group) }))
    .sort((a, b) => (b.m.total - a.m.total) || a.scopeName.localeCompare(b.scopeName));
  $("businessUnitCards").innerHTML = grouped.map(({ scopeName, rows: group, m }) => {
    const context = isLeadView ? unique(group, "businessUnit").slice(0, 4).join(", ") : unique(group, "blt").slice(0, 4).join(", ");
    const scoreCls = statusClass(m.closure);
    const action = unitAction(m);
    return `<article class="leader-card business-card">
      <div class="leader-card-head">
        <div><h3>${escapeHtml(scopeName)}</h3><p>${escapeHtml(context || (isLeadView ? "All business units" : "All leads"))}</p></div>
        <div class="score-wrap"><div class="score ${scoreCls}">${pct(m.closure)}</div><span class="signal-pill ${scoreCls}">${escapeHtml(indicatorText(scoreCls))}</span></div>
      </div>
      <div class="action-strip ${action.cls}"><strong>${escapeHtml(action.label)}</strong><span>${escapeHtml(action.text)}</span></div>
      <div class="talking-points">
        ${talkingPoints(scopeName, group, m).map(([label, text, cls]) => `<div class="talking-point ${cls}"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(text)}</span></div>`).join("")}
      </div>
      <div class="metric-list">
        ${metricRow("Total positions", m.total, "neutral")}
        ${metricRow("Active", `${m.active} (${pct(m.total ? m.active / m.total : 0)})`, "neutral")}
        ${metricRow("Filled", `${m.filled} (${pct(m.total ? m.filled / m.total : 0)})`, "good")}
        ${metricRow("Offered", `${m.offered} (${pct(m.total ? m.offered / m.total : 0)})`, "good")}
        ${metricRow("Open", `${m.open} (${pct(m.total ? m.open / m.total : 0)})`, m.freshPct >= 0.7 ? "good" : "risk")}
        ${metricRow("TBO", `${m.tbo} (${pct(m.total ? m.tbo / m.total : 0)})`, m.tbo > 5 ? "warn" : "neutral")}
        ${metricRow("Avg TAT", m.tatAvg == null ? "NA" : `${Math.round(m.tatAvg)}d`, statusClass(m.tatAvg, true))}
        ${metricRow("Avg hike", pct(m.avgHike), m.avgHike > 0.35 ? "warn" : "good")}
        ${metricRow("Within budget", pct(m.budgetPct), statusClass(m.budgetPct))}
      </div>
    </article>`;
  }).join("");
}

function talkingPoints(businessUnit, rows, m) {
  const oldOpen = rows.filter((r) => r.status === "Open" && (r.tat ?? 0) > 60).length;
  const topRecruiter = [...groupBy(rows, "recruiter").entries()].filter(([name]) => name !== "Unknown").sort((a, b) => b[1].length - a[1].length)[0]?.[0] || "TA";
  const sourceSocial = rows.filter((r) => r.status === "Filled" && r.sourceMix === "Social").length;
  const filled = rows.filter((r) => r.status === "Filled").length;
  return [
    ["Going well", (m.closure ?? 0) >= 0.75 ? `${businessUnit} has strong closure at ${pct(m.closure)}.` : `${filled} filled positions landed so far.`, "good"],
    ["Need support", oldOpen ? `${oldOpen} open roles are above 60 days and need business intervention.` : `Keep feedback loops under 30 days to protect TAT.`, oldOpen ? "risk" : "warn"],
    ["Decision this week", m.tbo ? `Move ${m.tbo} TBOs to offer with ${topRecruiter}.` : `Review source quality; ${sourceSocial} filled roles came through social sources.`, m.tbo ? "warn" : "neutral"]
  ];
}

function metricRow(label, value, cls = "neutral") {
  return `<div class="metric-row ${cls}" data-tooltip="${escapeHtml(label)}: ${escapeHtml(value)}"><span>${label}</span><strong>${value}</strong></div>`;
}

function progress(value) {
  const cls = statusClass(value);
  const width = clamp((value || 0) * 100, 0, 100);
  return `<div class="progress-cell" data-tooltip="Closure rate: ${pct(value)}"><strong class="${cls}-text">${pct(value)}</strong><div class="bar-track"><div class="bar-fill ${cls}" style="width:${width}%"></div></div></div>`;
}

function tatTone(value) {
  const cls = statusClass(value, true);
  return cls === "risk" ? "risk-text" : cls === "warn" ? "warn-text" : "good-text";
}

function sortItems(items, key, dir) {
  const factor = dir === "asc" ? 1 : -1;
  items.sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (typeof av === "number" || typeof bv === "number") return ((av ?? -1) - (bv ?? -1)) * factor;
    return String(av ?? "").localeCompare(String(bv ?? "")) * factor;
  });
}

function renderAging(rows) {
  const units = [...groupBy(rows.filter((r) => r.status === "Open"), "businessUnit").entries()]
    .map(([businessUnit, group]) => ({
      label: businessUnit,
      a: group.filter((r) => (r.tat ?? 0) <= 30).length,
      b: group.filter((r) => (r.tat ?? 0) > 30 && (r.tat ?? 0) <= 60).length,
      c: group.filter((r) => (r.tat ?? 0) > 60 && (r.tat ?? 0) <= 90).length,
      d: group.filter((r) => (r.tat ?? 0) > 90).length
    }))
    .sort((x, y) => (y.a + y.b + y.c + y.d) - (x.a + x.b + x.c + x.d));
  $("agingChart").innerHTML = units.length ? units.map((r) => {
    const total = r.a + r.b + r.c + r.d;
    return stackRow(r.label, [
      [r.a, "var(--chart-good)", `0-30d: ${r.a} (${pct(total ? r.a / total : 0)})`],
      [r.b, "var(--chart-warn)", `30-60d: ${r.b} (${pct(total ? r.b / total : 0)})`],
      [r.c, "var(--chart-warn)", `60-90d: ${r.c} (${pct(total ? r.c / total : 0)})`],
      [r.d, "var(--red)", `90+d: ${r.d} (${pct(total ? r.d / total : 0)})`]
    ]);
  }).join("") + legend([["0-30d", "var(--chart-good)"], ["30-60d", "var(--chart-warn)"], ["60-90d", "var(--chart-warn)"], ["90+d", "var(--red)"]]) : emptyInline();
}

function stackRow(label, parts, grandTotal = null) {
  const total = parts.reduce((sum, [n]) => sum + n, 0);
  const segs = parts.map(([n, color, title]) => {
    const share = total ? n / total : 0;
    const tip = `${label} | ${title}: ${n} (${pct(share)})`;
    return `<div class="stack-seg" data-tooltip="${escapeHtml(tip)}" style="width:${share * 100}%;background:${color}">${n > 0 && share > 0.12 ? n : ""}</div>`;
  }).join("");
  const displayValue = grandTotal ? `${total} (${pct(total / grandTotal)})` : total;
  return `<div class="stack-row" data-tooltip="${escapeHtml(label)} total: ${total}"><div class="stack-label">${escapeHtml(label)}</div><div class="stack-bar">${segs}</div><div class="stack-value">${displayValue}</div></div>`;
}

function renderVintage(rows) {
  const months = sortMonths(unique(rows, "reqOpenMonth"));
  renderVerticalStack("vintageChart", months, rows, "reqOpenMonth", STATUS.filter((s) => s !== "Cancelled"));
}

function renderMonthStack(target, rows, key) {
  const allMonths = sortMonths(unique(rows, key));
  const aprilIndex = monthIndex("Apr-26");
  const months = allMonths.filter(m => monthIndex(m) >= aprilIndex);
  const units = unique(rows, "businessUnit");
  renderVerticalStack(target, months, rows, key, units, true);
}

function renderVerticalStack(target, buckets, rows, key, segments, leaderMode = false) {
  if (!buckets.length) {
    $(target).innerHTML = emptyInline();
    return;
  }
  const max = Math.max(...buckets.map((bucket) => rows.filter((r) => r[key] === bucket).length), 1);

  const yAxisSteps = 4;
  const yAxisLabels = Array.from({length: yAxisSteps + 1}, (_, i) => {
    const val = Math.round((max / yAxisSteps) * i);
    return `<div class="y-axis-label" style="bottom:${(i / yAxisSteps) * 176}px">${val}</div>`;
  }).join("");

  const yAxisGridlines = Array.from({length: yAxisSteps + 1}, (_, i) => {
    return `<div class="y-axis-gridline" style="bottom:${(i / yAxisSteps) * 176}px"></div>`;
  }).join("");

  const bars = buckets.map((bucket) => {
    const bucketRows = rows.filter((r) => r[key] === bucket);
    const bucketTotal = bucketRows.length;
    const segs = segments.map((seg, i) => {
      const count = bucketRows.filter((r) => leaderMode ? r.businessUnit === seg : r.status === seg).length;
      const h = count / max * 176;
      const share = bucketTotal ? count / bucketTotal : 0;
      const tip = `${bucket} | ${seg}: ${count} (${pct(share)})`;
      return `<div class="vbar-seg" data-tooltip="${escapeHtml(tip)}" style="height:${h}px;background:${segmentColor(seg, i)}"></div>`;
    }).join("");
    return `<div class="vbar-item"><div class="vbar">${segs}</div><div class="vbar-label">${escapeHtml(bucket)}</div></div>`;
  }).join("");

  $(target).innerHTML = `<div class="vbar-container"><div class="y-axis">${yAxisLabels}</div><div class="y-axis-grid">${yAxisGridlines}</div><div class="vbar-wrap">${bars}</div></div>${legend(segments.map((s, i) => [s, segmentColor(s, i)]))}`;
}

function segmentColor(seg, i) {
  const map = { Filled: "var(--chart-good)", Offered: "var(--chart-good)", TBO: "var(--chart-good)", Open: "var(--chart-warn)", Cancelled: "var(--muted)" };
  return map[seg] || BLT_COLORS[i % BLT_COLORS.length];
}

function renderBudget(rows) {
  const leaders = [...groupBy(rows.filter((r) => ["Filled", "Offered"].includes(r.status)), "blt").entries()]
    .map(([leader, group]) => ({ label: leader, within: group.filter((r) => r.overBudget !== "Yes").length, over: group.filter((r) => r.overBudget === "Yes").length }))
    .sort((a, b) => (b.within + b.over) - (a.within + a.over));
  $("budgetChart").innerHTML = leaders.length ? leaders.map((r) => {
    const total = r.within + r.over;
    return stackRow(r.label, [
      [r.within, "var(--chart-good)", `Within budget: ${r.within} (${pct(total ? r.within / total : 0)})`],
      [r.over, "var(--red)", `Over budget: ${r.over} (${pct(total ? r.over / total : 0)})`]
    ]);
  }).join("") : emptyInline();
}

function renderSource(rows) {
  const sourceValues = unique(rows, "sourceMix").filter(v => v && v !== "Unknown").sort();

  if (!sourceValues.length) {
    $("sourceChart").innerHTML = emptyInline();
    return;
  }

  const sourceDistribution = sourceValues.map((source) => ({
    label: source,
    count: rows.filter((r) => r.sourceMix === source).length
  })).sort((a, b) => b.count - a.count);

  const total = sourceDistribution.reduce((sum, s) => sum + s.count, 0);
  const chartColors = ["var(--chart-seg-1)", "var(--chart-seg-0)", "var(--chart-seg-2)", "var(--chart-seg-3)", "var(--chart-accent1)", "var(--chart-accent2)"];

  $("sourceChart").innerHTML = sourceDistribution.length ? sourceDistribution.map((s, idx) => {
    const share = total ? s.count / total : 0;
    return stackRow(s.label, [[s.count, chartColors[idx % chartColors.length], `${s.label}: ${s.count} (${pct(share)})`]], total);
  }).join("") : emptyInline();
}

function renderRecruiters(rows) {
  const recruiters = [...groupBy(rows, "recruiter").entries()]
    .filter(([name]) => name !== "Unknown")
    .map(([name, group], i) => {
      const m = metrics(group);
      const aged = group.filter((r) => r.status === "Open" && (r.tat ?? 0) > 60).length;
      const loadCls = aged ? "risk" : m.active > 20 ? "warn" : "good";
      return { name, total: group.length, active: m.active, closure: m.closure, tat: m.tatAvg, aged, loadCls };
    })
    .sort((a, b) => (b.aged - a.aged) || (b.active - a.active) || (b.total - a.total))
    .slice(0, 9);
  $("recruiterList").innerHTML = recruiters.length ? recruiters.map((r) => {
    const activePct = pct(r.total ? r.active / r.total : 0);
    const agedPct = pct(r.total ? r.aged / r.total : 0);
    return `
    <div class="recruiter-row ${r.loadCls}">
      <div class="row-head"><strong>${escapeHtml(r.name)}</strong><span>${r.total} reqs | ${r.active} active (${activePct}) | ${r.aged} aged (${agedPct}) | ${r.tat == null ? "NA" : Math.round(r.tat) + "d"} TAT</span></div>
      <div class="capacity-line"><span class="signal-pill ${r.loadCls}">${r.loadCls === "risk" ? "Rebalance" : r.loadCls === "warn" ? "Watch load" : "Stable"}</span><span>${r.aged ? "Aged roles need support" : "Capacity within current view"}</span></div>
      ${progress(r.closure)}
    </div>
  `;
  }).join("") : emptyInline();
}

function renderTatBuckets(rows) {
  const buckets = [
    ["0-15 days", (r) => (r.tat ?? 0) <= 15],
    ["15-30 days", (r) => (r.tat ?? 0) > 15 && (r.tat ?? 0) <= 30],
    ["30-60 days", (r) => (r.tat ?? 0) > 30 && (r.tat ?? 0) <= 60],
    ["60-90 days", (r) => (r.tat ?? 0) > 60 && (r.tat ?? 0) <= 90],
    ["90+ days", (r) => (r.tat ?? 0) > 90]
  ];
  const total = rows.length;
  const data = buckets.map(([label, test], i) => ({
    label,
    count: rows.filter(test).length,
    color: segmentColor(label, i)
  })).filter(d => d.count > 0);

  $("tatBuckets").innerHTML = donutChart(data, total) + legend(data.map(d => [d.label, d.color]));
}

function donutChart(data, total) {
  const width = 260, height = 240, radius = 70, innerRadius = 44;
  const cx = width / 2, cy = height / 2;

  let currentAngle = -Math.PI / 2;
  const paths = data.map(({ label, count, color }) => {
    const share = total ? count / total : 0;
    const angle = share * 2 * Math.PI;
    const startAngle = currentAngle;
    const endAngle = currentAngle + angle;

    const x1 = cx + radius * Math.cos(startAngle);
    const y1 = cy + radius * Math.sin(startAngle);
    const x2 = cx + radius * Math.cos(endAngle);
    const y2 = cy + radius * Math.sin(endAngle);
    const xi1 = cx + innerRadius * Math.cos(startAngle);
    const yi1 = cy + innerRadius * Math.sin(startAngle);
    const xi2 = cx + innerRadius * Math.cos(endAngle);
    const yi2 = cy + innerRadius * Math.sin(endAngle);

    const largeArc = angle > Math.PI ? 1 : 0;
    const path = `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} L ${xi2} ${yi2} A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${xi1} ${yi1} Z`;

    const midAngle = startAngle + angle / 2;
    const labelRadius = (radius + innerRadius) / 2;
    const labelX = cx + labelRadius * Math.cos(midAngle);
    const labelY = cy + labelRadius * Math.sin(midAngle);

    currentAngle = endAngle;
    return `<path d="${path}" fill="${color}" data-tooltip="${escapeHtml(label)}: ${count} (${pct(share)})"></path><text x="${labelX}" y="${labelY}" text-anchor="middle" dy="0.3em" font-size="11px" font-weight="700" fill="#fff">${pct(share)}</text>`;
  }).join("");

  return `<svg viewBox="0 0 ${width} ${height}" width="260" height="240" style="display:block;margin:0 auto;max-width:100%">${paths}</svg>`;
}

function renderInsights(rows) {
  const m = metrics(rows);
  const aging = rows.filter((r) => r.status === "Open" && (r.tat ?? 0) > 30).sort((a, b) => (b.tat ?? 0) - (a.tat ?? 0));
  const overBudget = rows.filter((r) => ["Filled", "Offered"].includes(r.status) && r.overBudget === "Yes");
  const tbo = rows.filter((r) => r.status === "TBO");
  const insights = [
    aging.length ? ["risk", `Aging req escalation`, `${aging.length} open reqs are older than 30 days. Oldest: ${aging[0].reqId} (${aging[0].tat}d, ${aging[0].span}).`, "Draft escalation email"] : ["good", `Pipeline freshness holding`, `${pct(m.freshPct)} of open reqs are under 30 days. Keep the same review cadence.`, "Send weekly update"],
    overBudget.length ? ["warn", `Budget guardrail watch`, `${overBudget.length} closed or offered reqs are above approved budget. Review outliers before leadership reporting.`, "Prepare budget note"] : ["good", `Budget discipline clean`, `${pct(m.budgetPct)} of closed offers are within budget.`, "Add to weekly wins"],
    tbo.length ? ["warn", `TBO conversion queue`, `${tbo.length} selected candidates are waiting for offer paperwork. Prioritize conversion to protect closure rate.`, "Create offer tracker"] : ["good", `No TBO backlog`, `No selected-candidate paperwork backlog in the current filter.`, "Log status"]
  ];
  $("insights").innerHTML = insights.map(([cls, title, body, cta]) => `<div class="insight-card ${cls}" data-tooltip="${escapeHtml(title)}"><div class="insight-head"><span class="signal-dot ${cls}"></span><strong>${escapeHtml(title)}</strong><em>${escapeHtml(indicatorText(cls))}</em></div><span>${escapeHtml(body)}</span><div class="legend"><button class="ghost-button" type="button">${escapeHtml(cta)}</button></div></div>`).join("");
}

function renderDataQuality(rows) {
  const checks = qualityChecks(rows);
  $("dataQuality").innerHTML = checks.map(({ key, label, rows: issueRows, note }) => {
    const count = issueRows.length;
    const cls = count > 10 ? "risk" : count > 0 ? "warn" : "good";
    return `<div class="quality-row ${cls}" data-tooltip="${escapeHtml(note)}"><span>${escapeHtml(label)}</span><button class="quality-count ${cls}" type="button" data-quality-key="${escapeHtml(key)}" ${count ? "" : "disabled"}>${count}</button><em>${escapeHtml(note)}</em></div>`;
  }).join("");
}

function qualityChecks(rows) {
  return [
    { key: "missingBu", label: "Missing BU", rows: rows.filter((r) => !r.businessUnit || r.businessUnit === "Unknown"), note: "BU mapping gaps can distort scorecards.", fix: "Update Business Unit in tracker." },
    { key: "missingRecruiter", label: "Missing recruiter", rows: rows.filter((r) => !r.recruiter || r.recruiter === "Unknown"), note: "Recruiter load will be understated.", fix: "Add Recruiter Name or Lead Recruiter." },
    { key: "missingTat", label: "Missing TAT", rows: rows.filter((r) => !Number.isFinite(r.tat)), note: "TAT risk and aging buckets may be incomplete.", fix: "Add TAT calendar days or vacancy assigned date." },
    { key: "missingBudget", label: "Missing budget", rows: rows.filter((r) => ["Filled", "Offered"].includes(r.status) && !r.maxBudget), note: "Budget discipline may be understated.", fix: "Add Max Budget for closed/offered roles." },
    { key: "offeredNoDoj", label: "Offered without DOJ", rows: rows.filter((r) => r.status === "Offered" && !r.dojMonth), note: "Joining forecast needs follow-up.", fix: "Add DOJ or Joining Month." }
  ];
}

function openQualityOverlay(key) {
  const rows = filteredRows();
  const check = qualityChecks(rows).find((item) => item.key === key);
  if (!check) return;
  $("qualityModalTitle").textContent = check.label;
  $("qualityModalSubtitle").textContent = `${check.rows.length} records in current filters. ${check.note}`;
  const page = check.rows.slice(0, 300);
  $("qualityModalBody").innerHTML = page.map((r) => `<tr>
    <td>${escapeHtml(r.serialNo)}</td>
    <td>${escapeHtml(r.reqId)}</td>
    <td>${escapeHtml(r.businessUnit)}</td>
    <td>${escapeHtml(r.role)}</td>
    <td>${escapeHtml(r.recruiter)}</td>
    <td>${statusBadge(r.status)}</td>
    <td class="num ${tatTone(r.tat)}">${r.tat ?? "NA"}</td>
    <td>${escapeHtml(check.label)}</td>
    <td>${escapeHtml(check.fix)}</td>
  </tr>`).join("") || `<tr><td colspan="9"><div class="empty-state"><strong>No issue records</strong><span>This check is clean in the current filters.</span></div></td></tr>`;
  $("qualityModalFoot").textContent = `Showing ${page.length} of ${check.rows.length} issue records.`;
  $("qualityOverlay").hidden = false;
  $("qualityModalClose").focus();
}

function closeQualityOverlay() {
  $("qualityOverlay").hidden = true;
}

function renderDetail(rows) {
  const sorted = [...rows];
  if (state.sort.table === "detail") sortItems(sorted, state.sort.key, state.sort.dir);
  const page = sorted.slice(0, 500);
  $("detailBody").innerHTML = page.map((r) => `<tr>
    <td>${escapeHtml(r.reqId)}</td>
    <td>${escapeHtml(r.blt)}</td>
    <td>${escapeHtml(r.businessUnit)}</td>
    <td>${escapeHtml(r.span)}</td>
    <td>${escapeHtml(r.role)}</td>
    <td>${escapeHtml(r.location)}</td>
    <td>${escapeHtml(r.zone)}</td>
    <td>${escapeHtml(r.band)}</td>
    <td>${escapeHtml(r.reqOpenMonth || "NA")}</td>
    <td class="num ${tatTone(r.tat)}">${r.tat ?? "NA"}</td>
    <td>${statusBadge(r.status)}</td>
    <td>${escapeHtml(r.recruiter)}</td>
    <td>${escapeHtml(r.dojMonth || "NA")}</td>
    <td>${escapeHtml(agingBucket(r))}</td>
    <td>${riskBadge(rowRisk(r).label, rowRisk(r).cls)}</td>
    <td>${escapeHtml(suggestedAction(r))}</td>
    <td>${escapeHtml(ownerNeeded(r))}</td>
  </tr>`).join("");
  $("tableFoot").textContent = `Showing ${page.length} of ${sorted.length} filtered rows.`;
}

function statusBadge(status) {
  return `<span class="status-badge status-${status.toLowerCase()}">${status}</span>`;
}

function agingBucket(row) {
  if (!Number.isFinite(row.tat)) return "Unknown";
  if (row.tat <= 30) return "0-30";
  if (row.tat <= 60) return "30-60";
  if (row.tat <= 90) return "60-90";
  return "90+";
}

function rowRisk(row) {
  if (row.status === "Open" && (row.tat ?? 0) > 90) return { label: "Critical", cls: "risk" };
  if (row.status === "Open" && (row.tat ?? 0) > 60) return { label: "Risk", cls: "risk" };
  if (row.status === "Open" && (row.tat ?? 0) > 30) return { label: "Watch", cls: "warn" };
  if (row.status === "TBO") return { label: "Convert", cls: "warn" };
  if (["Filled", "Offered"].includes(row.status)) return { label: "Progress", cls: "good" };
  return { label: "Track", cls: "neutral" };
}

function riskBadge(label, cls) {
  return `<span class="risk-badge ${cls}">${escapeHtml(label)}</span>`;
}

function suggestedAction(row) {
  if (row.status === "Open" && (row.tat ?? 0) > 90) return "Escalate role priority and decision SLA";
  if (row.status === "Open" && (row.tat ?? 0) > 60) return "Unblock HM feedback or sourcing plan";
  if (row.status === "Open" && (row.tat ?? 0) > 30) return "Review interview pipeline";
  if (row.status === "TBO") return "Release offer / close approvals";
  if (row.status === "Offered" && !row.dojMonth) return "Confirm DOJ and joining risk";
  if (row.overBudget === "Yes") return "Review compensation exception";
  return "Monitor";
}

function ownerNeeded(row) {
  if (row.status === "TBO" || row.overBudget === "Yes") return "TA + HRBP";
  if (row.status === "Open" && (row.tat ?? 0) > 60) return "Business";
  if (row.status === "Offered" && !row.dojMonth) return "TA";
  return "TA";
}

function legend(items) {
  return `<div class="legend">${items.map(([label, color]) => `<span><i class="swatch" style="background:${color}"></i>${escapeHtml(label)}</span>`).join("")}</div>`;
}

function emptyInline() {
  return `<div class="empty-state"><strong>No matching data</strong><span>Adjust filters or sync the latest tracker.</span></div>`;
}

function sortMonths(months) {
  return months.filter(Boolean).sort((a, b) => monthIndex(a) - monthIndex(b));
}

function monthIndex(value) {
  const match = String(value).match(/([A-Za-z]{3})-(\d{2})/);
  if (!match) return 99999;
  return Number(match[2]) * 12 + MONTHS.indexOf(match[1]);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[ch]));
}

function exportCsv() {
  const rows = filteredRows();
  const headers = ["reqId", "blt", "businessUnit", "span", "role", "location", "zone", "band", "reqType", "reqOpenMonth", "tat", "status", "recruiter", "offerMonth", "dojMonth", "overBudget", "hike", "agingBucket", "risk", "suggestedAction", "ownerNeeded"];
  const csv = [headers.join(",")].concat(rows.map((r) => headers.map((h) => {
    const extras = { agingBucket: agingBucket(r), risk: rowRisk(r).label, suggestedAction: suggestedAction(r), ownerNeeded: ownerNeeded(r) };
    return `"${String(extras[h] ?? r[h] ?? "").replace(/"/g, '""')}"`;
  }).join(","))).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ta-dashboard-export-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function setupEvents() {
  $("syncButton").addEventListener("click", syncData);
  $("exportButton").addEventListener("click", exportCsv);
  $("resetFilters").addEventListener("click", () => {
    Object.values(state.filters).forEach((set) => set.clear());
    document.querySelectorAll("#filters input[type='checkbox']").forEach((input) => {
      input.checked = false;
    });
    updateFilterSummaries();
    render();
  });
  $("shareableToggle").addEventListener("change", (e) => {
    state.shareable = e.target.checked;
    render();
  });
  $("themeToggle").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("ta-dashboard-theme", next);
  });
  $("searchInput").addEventListener("input", (e) => {
    state.search = e.target.value;
    render();
  });
  $("filters").addEventListener("change", (e) => {
    const input = e.target.closest("input[type='checkbox'][data-filter]");
    if (!input) return;
    const key = input.dataset.filter;
    const set = state.filters[key];
    set.clear();
    document.querySelectorAll(`#filters input[data-filter="${key}"]:checked`).forEach((checked) => set.add(checked.value));
    updateFilterSummaries();
    render();
  });
  $("executiveSummary").addEventListener("click", (e) => {
    const button = e.target.closest(".lens-tab");
    if (!button) return;
    state.lens = button.dataset.lens;
    render();
  });
  $("dataQuality").addEventListener("click", (e) => {
    const button = e.target.closest(".quality-count");
    if (!button || button.disabled) return;
    openQualityOverlay(button.dataset.qualityKey);
  });
  $("qualityModalClose").addEventListener("click", closeQualityOverlay);
  $("qualityOverlay").addEventListener("click", (e) => {
    if (e.target.id === "qualityOverlay") closeQualityOverlay();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("qualityOverlay").hidden) closeQualityOverlay();
  });
  $("scopeTabs").addEventListener("click", (e) => {
    const tab = e.target.closest(".scope-tab");
    if (!tab) return;
    state.scope = { type: tab.dataset.scopeType, value: tab.dataset.scopeValue };
    renderScopeTabs();
    render();
  });
  document.querySelectorAll(".view-tab").forEach((button) => button.addEventListener("click", () => {
    state.view = button.dataset.view;
    document.querySelectorAll(".view-tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === state.view));
    render();
  }));
  document.querySelectorAll("#businessTable th").forEach((th) => th.addEventListener("click", () => {
    setSort("business", th.dataset.sort);
    render();
  }));
  document.querySelectorAll("#detailTable th").forEach((th) => th.addEventListener("click", () => {
    setSort("detail", th.dataset.sort);
    render();
  }));
  $("pollSelect").addEventListener("change", configurePolling);
  setupFloatingTooltip();
}

function setupFloatingTooltip() {
  let tooltip = document.getElementById("floatingTooltip");
  if (!tooltip) {
    tooltip = document.createElement("div");
    tooltip.id = "floatingTooltip";
    tooltip.className = "floating-tooltip";
    document.body.appendChild(tooltip);
  }
  document.addEventListener("pointerover", (e) => {
    const target = e.target.closest("[data-tooltip]");
    if (!target) return;
    tooltip.textContent = target.dataset.tooltip;
    tooltip.hidden = false;
    positionFloatingTooltip(e, tooltip);
  });
  document.addEventListener("pointermove", (e) => {
    if (tooltip.hidden) return;
    positionFloatingTooltip(e, tooltip);
  });
  document.addEventListener("pointerout", (e) => {
    if (!e.target.closest("[data-tooltip]")) return;
    tooltip.hidden = true;
  });
}

function positionFloatingTooltip(event, tooltip) {
  const pad = 12;
  const offset = 16;
  const rect = tooltip.getBoundingClientRect();
  let left = event.clientX + offset;
  let top = event.clientY - rect.height - offset;
  if (left + rect.width + pad > window.innerWidth) left = event.clientX - rect.width - offset;
  if (top < pad) top = event.clientY + offset;
  tooltip.style.left = `${Math.max(pad, left)}px`;
  tooltip.style.top = `${Math.max(pad, top)}px`;
}

function setSort(table, key) {
  if (!key) return;
  if (state.sort.table === table && state.sort.key === key) {
    state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
  } else {
    state.sort = { table, key, dir: key === "span" || key === "owner" ? "asc" : "desc" };
  }
}

function configurePolling() {
  clearInterval(state.pollTimer);
  const seconds = Number($("pollSelect").value);
  if (seconds > 0) state.pollTimer = setInterval(syncData, seconds * 1000);
}

function init() {
  document.documentElement.dataset.theme = localStorage.getItem("ta-dashboard-theme") || "";
  $("sourceUrl").textContent = `https://docs.google.com/spreadsheets/d/${SHEET_ID}`;
  setupEvents();
  buildFilters();
  loadCachedRows();
  if (state.rows.length) {
    setSyncMeta(`Loaded cached data from ${state.lastGoodSync?.toLocaleString() || "last session"}`);
    buildFilters();
    render();
  } else {
    renderEmpty();
  }
  configurePolling();
  syncData();
}

init();

