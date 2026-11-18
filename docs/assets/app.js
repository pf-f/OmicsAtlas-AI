import { translator } from "./i18n.js?v=2";
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
const OPEN_POPOVER = ":is(.more-filters, .export-menu, .growth-help)[open]";
const search = $("search");
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
  searchTimer = null,
  searchComposing = false,
  detailRepo = null;
try {
  const raw = localStorage.getItem(STORE);
  if (raw) saved = validSaved(JSON.parse(raw));
} catch {}
const icons = {
  save: '<path d="M5 3h10v15l-5-3-5 3z"/>',
  plus: '<path d="M4 10h12M10 4v12"/>',
  check: '<path d="m4 10 4 4 8-8"/>',
  star: '<path d="m10 2.5 2.3 4.7 5.2.8-3.8 3.7.9 5.2-4.6-2.4-4.6 2.4.9-5.2L2.5 8l5.2-.8z"/>',
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
function domainTags(ids, limit = ids.length) {
  const group = el("div", "domain-tags");
  for (const id of ids.slice(0, limit)) {
    const tag = el("span", "domain-tag", nameFor(data.domains, id));
    tag.dataset.domainColor = id;
    group.append(tag);
  }
  if (ids.length > limit) {
    const remaining = ids.slice(limit);
    const names = labels(data.domains, remaining);
    const count = el("span", "domain-overflow", "+" + nf(remaining.length));
    count.setAttribute("aria-hidden", "true");
    count.title = names;
    group.append(count, el("span", "sr-only", names));
  }
  return group;
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
function queryFromSearch() {
  const q = search.value.trim();
  return { q, sort: q ? "relevance" : "stars" };
}
function cancelSearch() {
  clearTimeout(searchTimer);
  searchTimer = null;
}
function scheduleSearch() {
  cancelSearch();
  searchTimer = setTimeout(() => {
    searchTimer = null;
    const query = queryFromSearch();
    if (query.q !== state.q) change(query, true);
  }, 220);
}
function change(values, replace = false) {
  // Apply a pending query together with a filter selection.
  if (searchTimer !== null && !Object.hasOwn(values, "q")) {
    const query = queryFromSearch();
    if (query.q !== state.q) values = { ...query, ...values };
  }
  cancelSearch();
  state = { ...state, ...values, page: values.page || 1 };
  urlUpdate(replace);
  render();
}
function option(select, value, label) {
  const o = el("option", "", label);
  o.value = value;
  select.append(o);
}
function setSelection(select, value) {
  select.value = value;
  const control = select.closest(".filter-control");
  if (!control) return;
  control.querySelector(".filter-value").textContent =
    select.selectedOptions[0]?.textContent || "";
  control.classList.toggle(
    "is-applied",
    select.id !== "sort" && Boolean(select.value),
  );
}
function fillSelect(id, items, all, key) {
  const s = $(id);
  s.replaceChildren();
  option(s, "", t(all));
  for (const item of items)
    option(s, item.id, item[lang] || item.en || item.id);
  setSelection(s, state[key] || "");
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
  setSelection($("sort"), state.sort);
  $("include-archived").checked = state.archived;
  if (searchTimer === null && !searchComposing && search.value.trim() !== state.q)
    search.value = state.q;
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
  for (const d of [
    { id: "", en: t("allDomains"), zh: t("allDomains") },
    ...data.domains,
  ]) {
    const b = button(
      "",
      () => change({ domain: d.id }),
      "domain-button" + (state.domain === d.id ? " active" : ""),
    );
    b.dataset.domain = d.id;
    if (d.id) b.dataset.domainColor = d.id;
    b.setAttribute("aria-pressed", String(state.domain === d.id));
    b.append(
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
function growthHelp() {
  const help = el("details", "growth-help");
  const summary = el("summary", "", "?");
  summary.setAttribute("aria-label", t("growthHelp"));
  help.append(summary, el("p", "", t("growthHelpText")));
  return help;
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
    target.append(empty(t(key), t(key + "Body"), t("clear"), () => {
      search.value = "";
      change(defaultState);
    }));
  } else {
    const table = el("table", "tool-table");
    table.setAttribute("aria-labelledby", "result-heading");
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
      const th = el("th", cls);
      th.scope = "col";
      if (key === "growth") {
        const heading = el("div", "growth-heading");
        heading.append(el("span", "", t(key)), growthHelp());
        th.append(heading);
      } else {
        th.textContent = t(key);
      }
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
      const identity = el("div", "tool-identity");
      const owner = r.full_name.split("/")[0];
      const [first, second] = owner.split("-");
      const initials = second ? first[0] + second[0] : owner.slice(0, 2);
      const mark = el("span", "tool-mark", initials.toUpperCase());
      mark.setAttribute("aria-hidden", "true");
      const copy = el("div");
      const title = el("div", "tool-title");
      const open = button(r.name, () => openDetail(r), "tool-name");
      open.dataset.detail = String(r.id);
      const external = link("↗", r.url, "repo-arrow");
      external.setAttribute("aria-label", r.full_name + " GitHub");
      title.append(open, external);
      const meta = el("div", "tool-meta");
      meta.append(el("span", "tool-owner", owner));
      for (const type of r.tool_types.slice(0, 2))
        meta.append(el("span", "tag", nameFor(data.tool_types, type)));
      if (r.archived || r.unavailable)
        meta.append(
          el("span", "tag", t(r.archived ? "archived" : "unavailable")),
        );
      copy.append(title, meta, el("p", "tool-description", r.description));
      const tags = domainTags(r.domains, 2);
      const compactTags = tags.cloneNode(true);
      compactTags.classList.add("compact-domains");
      copy.append(compactTags);
      identity.append(mark, copy);
      td.append(identity);
      row.append(td);
      const domain = el("td", "domain-column");
      domain.append(tags);
      row.append(domain);
      const stars = el("td", "metric star-column");
      const starValue = el("span", "star-value");
      starValue.append(icon("star"), document.createTextNode(nf(r.stars)));
      stars.append(starValue);
      row.append(stars);
      const weeklyDelta = r.growth?.weekly_delta;
      const cell = el("td", "metric growth-column");
      if (weeklyDelta == null) {
        const dash = el("span", "growth-missing", "—");
        dash.title = t("baseline");
        dash.setAttribute("aria-hidden", "true");
        cell.append(dash, el("span", "sr-only", t("baseline")));
      } else {
        if (weeklyDelta !== 0)
          cell.classList.add(weeklyDelta > 0 ? "positive" : "negative");
        cell.textContent = signed(weeklyDelta);
        cell.title = date(r.growth.from) + " → " + date(r.growth.to);
      }
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
  const tags = domainTags(r.domains);
  for (const type of r.tool_types)
    tags.append(el("span", "tag", nameFor(data.tool_types, type)));
  purpose.append(tags);
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
    ["domains", (r) => domainTags(r.domains)],
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
    row.dataset.field = key;
    label.scope = "row";
    row.append(label);
    for (const r of repos) {
      const td = el("td");
      td.append(get(r));
      row.append(td);
    }
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
  if (searchComposing) return;
  cancelSearch();
  const query = queryFromSearch();
  if (query.q !== state.q || query.sort !== state.sort || state.page !== 1)
    change(query);
});
search.addEventListener("compositionstart", () => {
  searchComposing = true;
  cancelSearch();
});
search.addEventListener("compositionend", () => {
  searchComposing = false;
  scheduleSearch();
});
search.addEventListener("input", (e) => {
  if (!e.isComposing && !searchComposing) scheduleSearch();
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
        all: queryFromSearch().sort,
      }[b.dataset.view],
    });
});
$("clear").addEventListener("click", () => {
  search.value = "";
  change({
    ...defaultState,
    view: state.view,
    sort: { new: "new", trending: "growth" }[state.view] || "stars",
  });
});
$("explore").addEventListener("click", () =>
  change({ view: "all", sort: queryFromSearch().sort }),
);
$("saved").addEventListener("click", () => change({ view: "saved" }));
$("method").addEventListener("click", openMethod);
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
  const first = compare.values().next().value;
  compare.clear();
  urlUpdate(true);
  render();
  const trigger = $("results").querySelector(`[data-compare="${first}"]`);
  (trigger || $("results")).focus();
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
  cancelSearch();
  state = readState(location.search);
  search.value = state.q;
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
document.addEventListener("click", (event) => {
  for (const popover of document.querySelectorAll(OPEN_POPOVER)) {
    if (!popover.contains(event.target)) popover.open = false;
  }
});
document.addEventListener("keydown", (e) => {
  if (e.defaultPrevented || e.isComposing || document.querySelector("dialog[open]"))
    return;
  if (e.key === "Escape") {
    const popover = document.querySelector(OPEN_POPOVER);
    if (popover) {
      const restoreFocus = popover.contains(document.activeElement);
      popover.open = false;
      if (restoreFocus) popover.querySelector("summary").focus();
      e.preventDefault();
    }
    return;
  }
  if (
    e.key === "/" &&
    !e.altKey &&
    !e.ctrlKey &&
    !e.metaKey &&
    !document.activeElement?.matches("input, textarea, select, [contenteditable]")
  ) {
    e.preventDefault();
    search.focus();
  }
});
translatePage();
load();
