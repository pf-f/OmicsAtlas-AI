import { translator } from "./i18n.js";
import {
  PAGE_SIZE,
  defaultState,
  readState,
  writeState,
  filteredTools,
  safeUrl,
  signed,
  csvExport,
  validSaved,
} from "./logic.js";
const $ = (id) => document.getElementById(id);
const STORE = "omicsatlas.saved.v1";
let lang =
  new URLSearchParams(location.search).get("lang") === "zh" ? "zh" : "en";
try {
  if (!new URLSearchParams(location.search).has("lang"))
    lang = localStorage.getItem("omicsatlas.language") === "zh" ? "zh" : "en";
} catch {}
let t = translator(lang),
  state = readState(location.search),
  data = null,
  filtered = [],
  saved = new Map(),
  compare = new Set(),
  toastTimer,
  searchTimer,
  detailRepo = null;
try {
  const raw = localStorage.getItem(STORE);
  if (raw) saved = validSaved(JSON.parse(raw));
} catch {}
const icons = {
  save: '<path d="M5 3h10v15l-5-3-5 3z"/>',
  plus: '<path d="M4 10h12M10 4v12"/>',
  check: '<path d="m4 10 4 4 8-8"/>',
};
function icon(name) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 20 20");
  s.setAttribute("class", "icon");
  s.setAttribute("aria-hidden", "true");
  s.innerHTML = icons[name];
  return s;
}
function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
}
function button(text, handler, className = "subtle-button") {
  const b = el("button", className, text);
  b.type = "button";
  b.addEventListener("click", handler);
  return b;
}
function link(label, url, className = "") {
  const a = el("a", className, label);
  const valid = safeUrl(url);
  if (valid) {
    a.href = valid;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
  }
  return a;
}
function tr(key, values) {
  return t(key, values);
}
function nameFor(items, id) {
  const found = items.find((x) => x.id === id);
  return found?.[lang] || found?.en || id;
}
function labels(items, ids) {
  return ids.map((id) => nameFor(items, id)).join(", ");
}
function nf(n) {
  return new Intl.NumberFormat(lang === "zh" ? "zh-CN" : "en-US").format(n);
}
function date(raw) {
  if (!raw) return t("missing");
  const d = new Date(raw);
  return Number.isNaN(+d)
    ? t("missing")
    : d.toLocaleDateString(lang === "zh" ? "zh-CN" : "en-GB", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}
function age(raw) {
  if (!raw) return "—";
  const days = Math.max(0, Math.floor((Date.now() - new Date(raw)) / 864e5));
  return lang === "zh"
    ? days < 1
      ? "今天"
      : `${days} 天前`
    : days < 1
      ? "Today"
      : `${days}d ago`;
}
function notify(text) {
  clearTimeout(toastTimer);
  // Native dialogs occupy the top layer. Put feedback inside the active
  // dialog so its backdrop cannot obscure copy/import/selection feedback.
  (document.querySelector("dialog[open]") || document.body).append($("toast"));
  $("toast").textContent = text;
  $("toast").hidden = false;
  toastTimer = setTimeout(() => ($("toast").hidden = true), 4500);
}
function translatePage() {
  t = translator(lang);
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  document
    .querySelectorAll("[data-i18n]")
    .forEach((n) => (n.textContent = t(n.dataset.i18n)));
  document
    .querySelectorAll("[data-placeholder]")
    .forEach((n) => (n.placeholder = t(n.dataset.placeholder)));
  document
    .querySelectorAll(".close-dialog")
    .forEach((n) => n.setAttribute("aria-label", t("close")));
  $("language").textContent = lang === "zh" ? "EN" : "中文";
  $("language").setAttribute(
    "aria-label",
    lang === "zh" ? "Switch to English" : "切换为中文",
  );
}
function urlUpdate(replace = false) {
  const p = new URLSearchParams(writeState(state));
  if (lang === "zh") p.set("lang", "zh");
  if (compare.size) p.set("compare", [...compare].join(","));
  const search = p.toString();
  history[replace ? "replaceState" : "pushState"](
    {},
    "",
    location.pathname + (search ? "?" + search : "") + location.hash,
  );
}
function change(values, replace = false) {
  state = { ...state, ...values, page: values.page || 1 };
  urlUpdate(replace);
  render();
}
function option(select, value, label) {
  const o = el("option", "", label);
  o.value = value;
  select.append(o);
}
function fillSelect(id, items, all, key) {
  const s = $(id);
  s.replaceChildren();
  option(s, "", t(all));
  for (const item of items)
    option(s, item.id, item[lang] || item.en || item.id);
  s.value = state[key] || "";
}
function renderControls() {
  fillSelect("type", data.tool_types, "allTypes", "type");
  fillSelect("task", data.tasks, "allTasks", "task");
  fillSelect(
    "code-language",
    [...new Set(data.repositories.map((r) => r.language).filter(Boolean))]
      .sort()
      .map((id) => ({ id, en: id })),
    "anyLanguage",
    "language",
  );
  fillSelect(
    "license",
    [...new Set(data.repositories.map((r) => r.license || "unspecified"))]
      .sort()
      .map((id) => ({
        id,
        en: id === "unspecified" ? t("unknownLicense") : id,
      })),
    "anyLicense",
    "license",
  );
  fillSelect(
    "environment",
    [
      { id: "docker", en: "Docker" },
      { id: "conda", en: "Conda" },
    ],
    "anyEnvironment",
    "environment",
  );
  $("sort").replaceChildren();
  for (const [id, key] of [
    ["relevance", "relevance"],
    ["stars", "mostStars"],
    ["growth", "mostGrowth"],
    ["new", "recentlyFound"],
    ["updated", "recentlyUpdated"],
  ])
    option($("sort"), id, t(key));
  $("sort").value = state.sort;
  $("include-archived").checked = state.archived;
  if ($("search").value !== state.q) $("search").value = state.q;
  const moreCount = [
    state.language,
    state.license,
    state.environment,
    state.archived,
  ].filter(Boolean).length;
  $("more-filters").querySelector("summary").textContent =
    t("more") + (moreCount ? ` (${moreCount})` : "");
  $("saved-count").textContent = nf(saved.size);
  $("saved").classList.toggle("active", state.view === "saved");
  $("saved").setAttribute("aria-pressed", String(state.view === "saved"));
  $("explore").classList.toggle("active", state.view !== "saved");
  $("saved-actions").hidden = state.view !== "saved";
  document.querySelectorAll("[data-view]").forEach((b) => {
    const selected = b.dataset.view === state.view;
    b.classList.toggle("active", selected);
    b.setAttribute("aria-pressed", String(selected));
  });
  const activeDomain = document.activeElement?.dataset?.domain;
  $("domain-list").replaceChildren();
  for (const [index, d] of [
    { id: "", en: t("allDomains"), zh: t("allDomains") },
    ...data.domains,
  ].entries()) {
    const b = button(
      "",
      () => change({ domain: d.id }),
      "domain-button" + (state.domain === d.id ? " active" : ""),
    );
    b.dataset.domain = d.id;
    b.setAttribute("aria-pressed", String(state.domain === d.id));
    b.append(
      el("span", "domain-index", index ? String(index).padStart(2, "0") : "∷"),
      el("span", "", d[lang] || d.en),
      el(
        "span",
        "domain-count",
        nf(d.id ? data.counts.domains[d.id] : data.counts.accepted),
      ),
    );
    $("domain-list").append(b);
  }
  if (activeDomain !== undefined)
    $("domain-list")
      .querySelector(`[data-domain="${CSS.escape(activeDomain)}"]`)
      ?.focus();
  $("export-csv").title = t("allExport");
  $("export-json").title = t("allExport");
}
function renderStatus() {
  const stale = Date.now() - new Date(data.generated_at) > 14 * 864e5;
  const status = stale
    ? "stale"
    : data.run.status === "partial"
      ? "partial"
      : data.run.status === "incremental"
        ? "incremental"
        : "fresh";
  const n = $("snapshot-status");
  n.replaceChildren(
    el("span", "status-dot " + status),
    el("span", "", t(status)),
  );
  $("snapshot-meta").textContent = t("snapshotDate", {
    date: date(data.generated_at),
  });
}
function favoriteButton(r) {
  const on = saved.has(r.id);
  const b = button(
    "",
    () => {
      const rowIndex = [...document.querySelectorAll("tbody tr")].indexOf(
        b.closest("tr"),
      );
      if (saved.has(r.id)) saved.delete(r.id);
      else saved.set(r.id, { id: r.id, full_name: r.full_name, url: r.url });
      persistSaved();
      render();
      const nextButtons = [
        ...$("results").querySelectorAll("tbody [data-save]"),
      ];
      const focusTarget = b.closest("dialog")?.open
        ? b
        : $("results").querySelector(`[data-save="${r.id}"]`) ||
          nextButtons[
            Math.min(Math.max(0, rowIndex), nextButtons.length - 1)
          ] ||
          $("results").querySelector("button") ||
          $("results");
      focusTarget?.focus();
    },
    "icon-button save",
  );
  b.dataset.save = String(r.id);
  b.setAttribute("aria-label", t(on ? "unsave" : "save", { name: r.name }));
  b.title = b.getAttribute("aria-label");
  b.setAttribute("aria-pressed", String(on));
  b.append(icon("save"));
  return b;
}
function compareButton(r) {
  const on = compare.has(r.id);
  const b = button(
    "",
    () => {
      toggleCompare(r.id);
      (b.closest("dialog")?.open
        ? b
        : document.querySelector(`[data-compare="${r.id}"]`)
      )?.focus();
    },
    "icon-button",
  );
  b.dataset.compare = String(r.id);
  b.setAttribute(
    "aria-label",
    t(on ? "removeCompare" : "addCompare", { name: r.name }),
  );
  b.title = b.getAttribute("aria-label");
  b.setAttribute("aria-pressed", String(on));
  b.append(icon(on ? "check" : "plus"));
  return b;
}
function toggleCompare(id) {
  if (compare.has(id)) compare.delete(id);
  else if (compare.size >= 4) return notify(t("maxCompare"));
  else compare.add(id);
  urlUpdate(true);
  render();
}
function persistSaved() {
  try {
    localStorage.setItem(STORE, JSON.stringify(savedBody()));
  } catch {
    notify(t("storageFailed"));
  }
}
function savedBody() {
  return {
    product: "OmicsAtlas-AI",
    schema_version: 1,
    exported_at: new Date().toISOString(),
    saved: [...saved.values()],
  };
}
function empty(title, body, action, handler) {
  const n = el("div", "empty");
  n.append(
    el("div", "empty-symbol", "⌕"),
    el("h3", "", title),
    el("p", "", body),
  );
  if (action) n.append(button(action, handler, "primary-button"));
  return n;
}
function render() {
  if (!data) return;
  renderControls();
  renderStatus();
  filtered = filteredTools(data, state, new Set(saved.keys()));
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if (state.page > pageCount) {
    state.page = pageCount;
    urlUpdate(true);
  }
  $("result-heading").textContent =
    state.view === "saved"
      ? t("savedOnly")
      : state.q
        ? t("searchUpdated")
        : state.domain
          ? nameFor(data.domains, state.domain)
          : t(
              { new: "new", trending: "trending", popular: "popular" }[
                state.view
              ] || "allTools",
            );
  $("result-count").textContent =
    t("results", { count: nf(filtered.length) }) +
    (state.archived ? "" : " · " + t("filterArchived"));
  const note =
    state.view === "saved"
      ? t("savedNotice")
      : state.view === "new"
        ? t("newNote")
        : state.view === "trending"
          ? t("trendingNote")
          : "";
  const missing = [...saved.keys()].filter(
    (id) => !data.repositories.some((r) => r.id === id),
  ).length;
  $("context-note").textContent =
    note +
    (state.view === "saved" && missing
      ? " " + t("unresolved", { count: missing })
      : "");
  $("context-note").hidden = !$("context-note").textContent;
  const target = $("results");
  target.replaceChildren();
  target.setAttribute("aria-busy", "false");
  if (!filtered.length) {
    const key =
      state.view === "saved" && !saved.size
        ? "savedEmpty"
        : state.view === "trending" && !state.q
          ? "trendingEmpty"
          : "noResults";
    target.append(
      empty(t(key), t(key + "Body"), t("clear"), () => {
        state = { ...defaultState };
        urlUpdate();
        render();
      }),
    );
  } else {
    const table = el("table", "tool-table");
    const head = el("thead");
    const hr = el("tr");
    for (const [key, cls] of [
      ["tool", "tool-column"],
      ["domain", "domain-column"],
      ["stars", "star-column"],
      ["growth", "growth-column"],
      ["updated", "updated-column"],
      ["actions", "action-column"],
    ]) {
      const th = el("th", cls, t(key));
      th.scope = "col";
      hr.append(th);
    }
    head.append(hr);
    table.append(head);
    const body = el("tbody");
    for (const r of filtered.slice(
      (state.page - 1) * PAGE_SIZE,
      state.page * PAGE_SIZE,
    )) {
      const row = el("tr");
      row.dataset.repo = String(r.id);
      const td = el("td", "tool-column");
      const title = el("div", "tool-title");
      const open = button(r.name, () => openDetail(r), "tool-name");
      open.dataset.detail = String(r.id);
      title.append(open, link("↗", r.url, "repo-arrow"));
      title.lastChild.setAttribute("aria-label", r.full_name + " GitHub");
      td.append(
        title,
        el("span", "tool-owner", r.full_name.split("/")[0]),
        el("p", "tool-description", r.description),
      );
      const types = el("div", "type-line");
      for (const type of r.tool_types.slice(0, 2))
        types.append(el("span", "tag", nameFor(data.tool_types, type)));
      if (r.archived || r.unavailable)
        types.append(
          el("span", "tag", t(r.archived ? "archived" : "unavailable")),
        );
      td.append(types);
      row.append(td);
      const domain = el("td", "domain-column");
      const tags = el("div", "domain-tags");
      r.domains
        .slice(0, 2)
        .forEach((id) =>
          tags.append(el("span", "domain-tag", nameFor(data.domains, id))),
        );
      if (r.domains.length > 2)
        tags.append(el("span", "small-label", `+${r.domains.length - 2}`));
      domain.append(tags);
      row.append(domain);
      row.append(el("td", "metric star-column", nf(r.stars)));
      const change = r.growth?.weekly_delta;
      const cell = el(
        "td",
        "metric growth-column " +
          (change == null
            ? "unknown"
            : change > 0
              ? "positive"
              : change < 0
                ? "negative"
                : ""),
        change == null ? "—" : signed(change),
      );
      if (change == null) {
        cell.title = t("baseline");
        cell.append(el("small", "", t("baseline")));
      } else cell.title = date(r.growth.from) + " → " + date(r.growth.to);
      row.append(cell);
      const updated = el("td", "metric updated-column", age(r.pushed_at));
      updated.title = date(r.pushed_at);
      row.append(updated);
      const actions = el("td", "action-column");
      const wrap = el("div", "row-actions");
      wrap.append(favoriteButton(r), compareButton(r));
      actions.append(wrap);
      row.append(actions);
      body.append(row);
    }
    table.append(body);
    target.append(table);
  }
  $("pagination").replaceChildren();
  if (filtered.length) {
    const start = (state.page - 1) * PAGE_SIZE + 1;
    const count = el(
      "span",
      "",
      t("range", {
        start: nf(start),
        end: nf(Math.min(state.page * PAGE_SIZE, filtered.length)),
        total: nf(filtered.length),
      }),
    );
    const controls = el("div", "page-controls");
    const prev = button(t("prev"), () => {
      change({ page: state.page - 1 });
      $("results").focus();
    });
    prev.disabled = state.page <= 1;
    const next = button(t("next"), () => {
      change({ page: state.page + 1 });
      $("results").focus();
    });
    next.disabled = state.page >= pageCount;
    controls.append(
      prev,
      el("span", "", t("page", { page: state.page, pages: pageCount })),
      next,
    );
    $("pagination").append(count, controls);
  }
  renderCompareBar();
  syncSelectionButtons();
}
function syncSelectionButtons() {
  for (const b of document.querySelectorAll("[data-save],[data-compare]")) {
    const isSave = b.hasAttribute("data-save"),
      id = Number(isSave ? b.dataset.save : b.dataset.compare),
      r = data.repositories.find((r) => r.id === id);
    if (!r) continue;
    const on = isSave ? saved.has(id) : compare.has(id);
    b.setAttribute("aria-pressed", String(on));
    b.setAttribute(
      "aria-label",
      t(
        isSave ? (on ? "unsave" : "save") : on ? "removeCompare" : "addCompare",
        { name: r.name },
      ),
    );
    b.title = b.getAttribute("aria-label");
    if (!isSave) b.replaceChildren(icon(on ? "check" : "plus"));
  }
}
function renderCompareBar() {
  $("compare-bar").hidden = !compare.size;
  $("compare-count").textContent = t("compareSelected", {
    count: compare.size,
  });
  $("compare-names").replaceChildren();
  for (const id of compare) {
    const r = data.repositories.find((r) => r.id === id);
    if (!r) continue;
    const chip = el("span", "compare-chip", r.name);
    const remove = button("×", () => toggleCompare(id), "");
    remove.setAttribute("aria-label", t("removeCompare", { name: r.name }));
    chip.append(remove);
    $("compare-names").append(chip);
  }
  $("compare-open").disabled = compare.size < 2;
}
function showDialog(id) {
  const dialog = $(id);
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
}
function section(container, title) {
  const s = el("section", "detail-section");
  s.append(el("h3", "", title));
  container.append(s);
  return s;
}
function pills(parent, items) {
  const n = el("div", "pill-group");
  for (const text of items) n.append(el("span", "pill", text));
  parent.append(n);
}
function openDetail(r) {
  detailRepo = r;
  const root = $("detail-content");
  root.replaceChildren();
  const heading = el("h2", "", r.name);
  heading.id = "detail-title";
  root.append(
    heading,
    el("p", "detail-owner", r.full_name),
    el("p", "detail-description", r.description),
  );
  const links = el("div", "detail-links");
  links.append(
    link(t("github"), r.url, "primary-button"),
    link(t("documentation"), r.documentation_url, "subtle-button"),
    favoriteButton(r),
    compareButton(r),
  );
  root.append(links);
  const metrics = el("dl", "detail-metrics");
  for (const [key, value] of [
    ["stars", nf(r.stars)],
    [
      "growth",
      r.growth?.weekly_delta == null ? "—" : signed(r.growth.weekly_delta),
    ],
    ["forks", nf(r.forks)],
  ]) {
    const d = el("div");
    d.append(el("dt", "", t(key)), el("dd", "", value));
    metrics.append(d);
  }
  root.append(metrics);
  const purpose = section(root, t("purpose"));
  pills(purpose, [
    ...r.domains.map((id) => nameFor(data.domains, id)),
    ...r.tool_types.map((id) => nameFor(data.tool_types, id)),
  ]);
  if (r.tasks.length) purpose.append(el("p", "", labels(data.tasks, r.tasks)));
  const ev = section(root, t("evidence"));
  ev.append(el("p", "", t("evidenceIntro")));
  const evidence = [
    ...r.classification.evidence,
    ...r.classification.software_evidence,
  ];
  const distinct = new Set();
  for (const e of evidence) {
    const key = e.source + e.excerpt;
    if (distinct.has(key)) continue;
    distinct.add(key);
    const card = el("div", "evidence-card");
    card.append(
      el(
        "span",
        "evidence-source",
        (e.domain ? nameFor(data.domains, e.domain) : t("software")) +
          " · " +
          e.source,
      ),
      el("p", "", e.excerpt),
      link(t("source"), e.url),
    );
    ev.append(card);
  }
  const facts = section(root, t("maintenance"));
  for (const [key, value] of [
    ["languageLabel", r.language || t("missing")],
    ["license", r.license || t("unknownLicense")],
    [
      "maintenance",
      t(r.archived ? "archived" : r.unavailable ? "unavailable" : "active"),
    ],
    ["created", date(r.created_at)],
    ["firstSeen", date(r.first_seen_at)],
    ["observed", date(r.observed_at)],
    ["evidenceChecked", date(r.evidence_checked_at)],
  ]) {
    const p = el("p");
    p.append(el("strong", "", t(key) + ": "), document.createTextNode(value));
    facts.append(p);
  }
  if (r.growth.delta != null)
    facts.append(
      el(
        "p",
        "",
        t("growthInterval", {
          delta: signed(r.growth.delta),
          days: r.growth.days,
        }) +
          " · " +
          date(r.growth.from) +
          " → " +
          date(r.growth.to),
      ),
    );
  else facts.append(el("p", "", t("baseline")));
  const installs = section(root, t("install"));
  installs.append(el("p", "", t("installNote")));
  if (!r.install?.length) installs.append(el("p", "", t("noInstall")));
  for (const inst of r.install || []) {
    const block = el("div", "install-block");
    const copy = button(t("copy"), async () => {
      try {
        await navigator.clipboard.writeText(inst.command);
        notify(t("copied"));
      } catch {
        notify(t("copyFailed"));
      }
    });
    block.append(
      copy,
      el("pre", "", inst.command),
      link(t("source"), inst.source_url),
    );
    installs.append(block);
  }
  const papers = section(root, t("paper"));
  papers.append(el("p", "", t("paperNote")));
  if (!r.papers?.length) papers.append(el("p", "", t("noPaper")));
  for (const paper of r.papers || []) {
    const p = el("p");
    p.append(link(paper.url.replace(/^https?:\/\//, ""), paper.url));
    papers.append(p);
  }
  const sources = section(root, t("source"));
  for (const s of r.sources || []) {
    const p = el("p");
    p.append(link(s.kind, s.url));
    sources.append(p);
  }
  root.append(el("p", "data-caption", t("notQuality")));
  showDialog("detail-dialog");
}
function openComparison() {
  const repos = [...compare]
    .map((id) => data.repositories.find((r) => r.id === id))
    .filter(Boolean);
  if (repos.length < 2) return;
  const root = $("compare-content");
  root.replaceChildren();
  const scroll = el("div", "compare-scroll"),
    table = el("table", "comparison"),
    head = el("thead"),
    hr = el("tr");
  hr.append(el("th", "", t("tool")));
  repos.forEach((r) => {
    const h = el("th");
    h.scope = "col";
    h.append(link(r.name, r.url));
    hr.append(h);
  });
  head.append(hr);
  table.append(head);
  const body = el("tbody");
  const rows = [
    ["description", (r) => r.description],
    ["domains", (r) => labels(data.domains, r.domains)],
    ["type", (r) => labels(data.tool_types, r.tool_types)],
    ["task", (r) => labels(data.tasks, r.tasks) || t("none")],
    ["stars", (r) => nf(r.stars)],
    [
      "growth",
      (r) =>
        r.growth?.weekly_delta == null
          ? t("baseline")
          : signed(r.growth.weekly_delta),
    ],
    [
      "interval",
      (r) =>
        r.growth?.from
          ? date(r.growth.from) + " → " + date(r.growth.to)
          : t("baseline"),
    ],
    ["updated", (r) => date(r.pushed_at)],
    [
      "maintenance",
      (r) =>
        t(r.archived ? "archived" : r.unavailable ? "unavailable" : "active"),
    ],
    ["license", (r) => r.license || t("unknownLicense")],
    ["codeLanguage", (r) => r.language || t("missing")],
    [
      "environment",
      (r) => (r.environments || []).map((e) => e.id).join(", ") || t("none"),
    ],
    [
      "paper",
      (r) => ((r.papers || []).length ? String(r.papers.length) : t("none")),
    ],
    ["observed", (r) => date(r.observed_at)],
  ];
  for (const [key, get] of rows) {
    const row = el("tr"),
      label = el("th", "", t(key));
    label.scope = "row";
    row.append(label);
    for (const r of repos) row.append(el("td", "", get(r)));
    body.append(row);
  }
  const last = el("tr");
  last.append(el("th", "", t("source")));
  for (const r of repos) {
    const td = el("td");
    td.append(link(t("documentation"), r.documentation_url));
    last.append(td);
  }
  body.append(last);
  table.append(body);
  scroll.append(table);
  root.append(scroll, el("p", "data-caption", t("notQuality")));
  showDialog("compare-dialog");
}
function openMethod() {
  const root = $("method-content");
  root.replaceChildren();
  for (let i = 1; i <= 4; i++) {
    const step = el("section", "method-step"),
      content = el("div");
    content.append(
      el("h3", "", t("method" + i)),
      el("p", "", t("method" + i + "Text")),
    );
    step.append(el("span", "step-number", String(i).padStart(2, "0")), content);
    root.append(step);
  }
  const info = el("div", "method-meta");
  if (data) {
    info.append(
      el("p", "", t("methodStats", data.counts)),
      el("p", "", t("verifyVersion", { version: data.method_version })),
      el("p", "", t("methodCoverage")),
      el("p", "", t("freshness")),
    );
    const links = el("p");
    links.append(
      link(t("run"), data.run.url),
      document.createTextNode(" · "),
      link(t("data"), new URL("data/catalog.json", location.href).href),
    );
    info.append(links);
  }
  const attr = el("p");
  attr.append(
    document.createTextNode("Sources: GitHub · "),
    link(
      "bio.tools — CC BY 4.0",
      "https://biotools.readthedocs.io/en/latest/license.html",
    ),
  );
  info.append(attr);
  root.append(info);
  showDialog("method-dialog");
}
function download(name, body, type) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = el("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportRows(kind) {
  if (!data) return;
  const rows = filteredTools(data, state, new Set(saved.keys()));
  if (kind === "csv")
    download("omicsatlas-tools.csv", csvExport(rows), "text/csv;charset=utf-8");
  else
    download(
      "omicsatlas-tools.json",
      JSON.stringify(
        {
          product: "OmicsAtlas-AI",
          schema_version: 1,
          snapshot_at: data.generated_at,
          filters: state,
          repositories: rows,
        },
        null,
        2,
      ),
      "application/json",
    );
  notify(t("exported", { count: rows.length }));
  document.querySelector(".export-menu").open = false;
}
async function load() {
  const target = $("results");
  target.setAttribute("aria-busy", "true");
  try {
    const res = await fetch(new URL("data/catalog.json", document.baseURI), {
      cache: "no-cache",
    });
    if (!res.ok) throw Error("HTTP " + res.status);
    const incoming = await res.json();
    if (
      incoming.schema_version !== 1 ||
      !Array.isArray(incoming.repositories) ||
      incoming.repositories.length !== incoming.counts?.accepted ||
      new Set(incoming.repositories.map((r) => r.id)).size !==
        incoming.repositories.length ||
      !incoming.repositories.every(
        (r) =>
          Number.isSafeInteger(r.id) &&
          Array.isArray(r.domains) &&
          Array.isArray(r.tasks) &&
          Array.isArray(r.tool_types) &&
          r.classification?.evidence?.length,
      )
    )
      throw Error("Invalid catalog");
    data = incoming;
    for (const key of ["domain", "task", "type"]) {
      const allowed =
        key === "domain"
          ? data.domains
          : key === "task"
            ? data.tasks
            : data.tool_types;
      if (state[key] && !allowed.some((x) => x.id === state[key]))
        state[key] = "";
    }
    const ids = (new URLSearchParams(location.search).get("compare") || "")
      .split(",")
      .map(Number);
    compare = new Set(
      ids
        .filter((id) => data.repositories.some((r) => r.id === id))
        .slice(0, 4),
    );
    $("more-filters").open = Boolean(
      state.language || state.license || state.environment || state.archived,
    );
    render();
  } catch (error) {
    console.error("Directory load failed:", error.message);
    target.setAttribute("aria-busy", "false");
    target.replaceChildren(
      empty(t("loadFailed"), t("loadFailedBody"), t("retry"), load),
    );
    $("snapshot-status").replaceChildren(
      el("span", "status-dot error"),
      el("span", "", t("loadFailed")),
    );
    $("result-count").textContent = "—";
  }
}
$("search-form").addEventListener("submit", (e) => {
  e.preventDefault();
  clearTimeout(searchTimer);
  change({
    q: $("search").value.trim(),
    sort: $("search").value.trim() ? "relevance" : "stars",
  });
});
$("search").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(
    () =>
      change(
        {
          q: $("search").value.trim(),
          sort: $("search").value.trim() ? "relevance" : "stars",
        },
        true,
      ),
    220,
  );
});
for (const [id, key] of [
  ["type", "type"],
  ["task", "task"],
  ["code-language", "language"],
  ["license", "license"],
  ["environment", "environment"],
  ["sort", "sort"],
])
  $(id).addEventListener("change", () => change({ [key]: $(id).value }));
$("include-archived").addEventListener("change", () =>
  change({ archived: $("include-archived").checked }),
);
$("views").addEventListener("click", (e) => {
  const b = e.target.closest("[data-view]");
  if (b)
    change({
      view: b.dataset.view,
      sort: {
        new: "new",
        trending: "growth",
        popular: "stars",
        all: state.q ? "relevance" : "stars",
      }[b.dataset.view],
    });
});
$("clear").addEventListener("click", () => {
  state = {
    ...defaultState,
    view: state.view,
    sort: { new: "new", trending: "growth" }[state.view] || "stars",
  };
  urlUpdate();
  render();
});
$("explore").addEventListener("click", () =>
  change({ view: "all", sort: state.q ? "relevance" : "stars" }),
);
$("saved").addEventListener("click", () => change({ view: "saved" }));
$("method").addEventListener("click", openMethod);
$("method-secondary").addEventListener("click", openMethod);
$("language").addEventListener("click", () => {
  lang = lang === "en" ? "zh" : "en";
  try {
    localStorage.setItem("omicsatlas.language", lang);
  } catch {}
  translatePage();
  urlUpdate(true);
  render();
  if ($("detail-dialog").open && detailRepo) openDetail(detailRepo);
  if ($("method-dialog").open) openMethod();
  if ($("compare-dialog").open) openComparison();
});
$("compare-open").addEventListener("click", openComparison);
$("compare-clear").addEventListener("click", () => {
  compare.clear();
  urlUpdate(true);
  render();
});
document
  .querySelectorAll("[data-close]")
  .forEach((b) =>
    b.addEventListener("click", () => $(b.dataset.close).close()),
  );
$("detail-dialog").addEventListener("close", () => {
  if (detailRepo)
    document.querySelector(`[data-detail="${detailRepo.id}"]`)?.focus();
});
document.querySelectorAll("dialog").forEach((d) =>
  d.addEventListener("click", (e) => {
    if (e.target === d) {
      const box = d.getBoundingClientRect();
      if (
        e.clientX < box.left ||
        e.clientX > box.right ||
        e.clientY < box.top ||
        e.clientY > box.bottom
      )
        d.close();
    }
  }),
);
$("export-csv").addEventListener("click", () => exportRows("csv"));
$("export-json").addEventListener("click", () => exportRows("json"));
$("export-saved").addEventListener("click", () =>
  download(
    "omicsatlas-saved.json",
    JSON.stringify(savedBody(), null, 2),
    "application/json",
  ),
);
$("import-saved").addEventListener("click", () => $("import-file").click());
$("import-file").addEventListener("change", async () => {
  try {
    const file = $("import-file").files[0];
    if (!file || file.size > 3000000) throw Error("invalid");
    const incoming = validSaved(JSON.parse(await file.text()));
    for (const [id, r] of incoming) saved.set(id, r);
    persistSaved();
    render();
    notify(t("imported", { count: incoming.size }));
  } catch {
    notify(t("invalidImport"));
  } finally {
    $("import-file").value = "";
  }
});
window.addEventListener("popstate", () => {
  state = readState(location.search);
  const p = new URLSearchParams(location.search);
  if (p.has("lang")) {
    lang = p.get("lang") === "zh" ? "zh" : "en";
    translatePage();
  }
  compare = new Set(
    (p.get("compare") || "")
      .split(",")
      .map(Number)
      .filter((id) => data?.repositories.some((r) => r.id === id))
      .slice(0, 4),
  );
  render();
});
window.addEventListener("storage", (e) => {
  if (e.key === STORE) {
    try {
      saved = e.newValue ? validSaved(JSON.parse(e.newValue)) : new Map();
      render();
    } catch {}
  }
});
document.addEventListener("keydown", (e) => {
  if (
    e.key === "/" &&
    !["INPUT", "TEXTAREA", "SELECT"].includes(
      document.activeElement?.tagName,
    ) &&
    !document.querySelector("dialog[open]")
  ) {
    e.preventDefault();
    $("search").focus();
  }
});
translatePage();
load();
