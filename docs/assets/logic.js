export const PAGE_SIZE = 25;
export const defaultState = {
  q: "",
  domain: "",
  type: "",
  task: "",
  language: "",
  license: "",
  environment: "",
  archived: false,
  view: "all",
  sort: "stars",
  page: 1,
};
export function readState(search) {
  const p = new URLSearchParams(search);
  const s = { ...defaultState };
  for (const k of [
    "q",
    "domain",
    "type",
    "task",
    "language",
    "license",
    "environment",
  ])
    s[k] = (p.get(k) || "").slice(0, 200);
  s.view = ["all", "popular", "new", "trending", "saved"].includes(
    p.get("view"),
  )
    ? p.get("view")
    : "all";
  s.sort = ["stars", "relevance", "growth", "new", "updated"].includes(
    p.get("sort"),
  )
    ? p.get("sort")
    : s.q
      ? "relevance"
      : "stars";
  s.archived = p.get("archived") === "1";
  s.page = Math.max(
    1,
    Math.min(100000, Number.parseInt(p.get("page"), 10) || 1),
  );
  return s;
}
export function writeState(s) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(s)) {
    if (v !== defaultState[k] && v !== "" && v !== false)
      p.set(k, k === "archived" ? "1" : String(v));
  }
  return p.toString();
}
export function safeUrl(raw) {
  try {
    const u = new URL(raw);
    return ["http:", "https:"].includes(u.protocol) && !u.username
      ? u.href
      : null;
  } catch {
    return null;
  }
}
export function signed(n) {
  return n > 0 ? `+${n.toLocaleString()}` : n.toLocaleString();
}
function normalized(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKC");
}
export function searchRank(r, query, data) {
  const tokens = normalized(query).trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return 0;
  const name = normalized(r.full_name);
  const description = normalized(r.description);
  const tags = normalized(
    [
      ...(r.topics || []),
      ...(r.domains || []),
      ...(r.tasks || []),
      ...(r.tool_types || []),
    ].join(" "),
  );
  let score = 0;
  for (const token of tokens) {
    const domainMatches = data.domains
      .filter((d) =>
        [d.id, d.en, d.zh, ...(d.aliases || [])].some((a) =>
          normalized(a).includes(token),
        ),
      )
      .map((d) => d.id);
    const taskMatches = data.tasks
      .filter((t) =>
        [t.id, t.en, t.zh].some((a) => normalized(a).includes(token)),
      )
      .map((t) => t.id);
    if (name === token || normalized(r.name) === token) score += 100;
    else if (name.includes(token)) score += 30;
    else if (description.includes(token)) score += 12;
    else if (
      tags.includes(token) ||
      r.domains.some((d) => domainMatches.includes(d)) ||
      r.tasks.some((t) => taskMatches.includes(t))
    )
      score += 6;
    else return -1;
  }
  return score;
}
export function filteredTools(data, state, saved) {
  const rank = new Map();
  const output = data.repositories.filter((r) => {
    if (!state.archived && (r.archived || r.unavailable)) return false;
    if (state.domain && !r.domains.includes(state.domain)) return false;
    if (state.type && !r.tool_types.includes(state.type)) return false;
    if (state.task && !r.tasks.includes(state.task)) return false;
    if (state.language && r.language !== state.language) return false;
    if (state.license && (r.license || "unspecified") !== state.license)
      return false;
    if (
      state.environment &&
      !(r.environments || []).some((e) => e.id === state.environment)
    )
      return false;
    if (state.view === "saved" && !saved.has(r.id)) return false;
    if (state.view === "trending" && !(r.growth?.weekly_delta > 0))
      return false;
    const score = searchRank(r, state.q, data);
    rank.set(r.id, score);
    return score >= 0;
  });
  output.sort((a, b) => {
    let diff = 0;
    if (state.sort === "relevance") diff = rank.get(b.id) - rank.get(a.id);
    if (state.sort === "growth") {
      const x = a.growth?.weekly_delta,
        y = b.growth?.weekly_delta;
      if (x == null && y != null) return 1;
      if (y == null && x != null) return -1;
      diff = (y ?? 0) - (x ?? 0);
    }
    if (state.sort === "new")
      diff = String(b.first_seen_at).localeCompare(String(a.first_seen_at));
    if (state.sort === "updated")
      diff = String(b.pushed_at || "").localeCompare(String(a.pushed_at || ""));
    return diff || b.stars - a.stars || a.full_name.localeCompare(b.full_name);
  });
  return output;
}
export function csvExport(rows) {
  const cols = [
    "full_name",
    "url",
    "description",
    "domains",
    "tasks",
    "tool_types",
    "stars",
    "weekly_change",
    "observed_at",
    "pushed_at",
    "language",
    "license",
  ];
  const escape = (v) => {
    let s = String(v ?? "");
    if (/^[\s]*[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  return (
    "\uFEFF" +
    [
      cols.map(escape).join(","),
      ...rows.map((r) =>
        cols
          .map((c) =>
            escape(
              c === "weekly_change"
                ? r.growth?.weekly_delta
                : Array.isArray(r[c])
                  ? r[c].join("; ")
                  : r[c],
            ),
          )
          .join(","),
      ),
    ].join("\r\n")
  );
}
export function validSaved(body) {
  if (
    body?.product !== "OmicsAtlas-AI" ||
    body?.schema_version !== 1 ||
    !Array.isArray(body.saved) ||
    body.saved.length > 10000
  )
    throw Error("invalid");
  const out = new Map();
  for (const r of body.saved) {
    if (
      !Number.isSafeInteger(r.id) ||
      r.id <= 0 ||
      typeof r.full_name !== "string" ||
      !/^https:\/\/github\.com\/[^/]+\/[^/]+\/?$/.test(r.url)
    )
      throw Error("invalid");
    out.set(r.id, {
      id: r.id,
      full_name: r.full_name.slice(0, 200),
      url: r.url,
    });
  }
  return out;
}
