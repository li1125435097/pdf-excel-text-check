const $ = (sel, root = document) => root.querySelector(sel);

/** @type {{ email: string | null, is_super_admin: boolean, is_guest: boolean }} */
let authMe = { email: null, is_super_admin: false, is_guest: false };

async function ensureAuth() {
  const r = await fetch("/api/auth/me", { credentials: "include" });
  const me = await r.json();
  authMe = me;
  if (!me.email) {
    window.location.href = "/login";
    return false;
  }
  return true;
}

function formatSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

/** 后端 ISO 时间 → 北京时间 YYYY-MM-DD HH:mm:ss */
function pad2(v) {
  const s = String(v);
  return s.length >= 2 ? s : `0${s}`;
}

function formatBeijingTime(isoStr) {
  if (isoStr == null || isoStr === "") return "";
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return String(isoStr);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
  }).formatToParts(d);
  const map = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  return `${map.year}-${pad2(map.month)}-${pad2(map.day)} ${pad2(map.hour)}:${pad2(map.minute)}:${pad2(map.second)}`;
}

function extKind(ext) {
  const e = (ext || "").toLowerCase();
  if ([".xlsx", ".xls"].includes(e)) return "excel";
  if (e === ".pdf") return "pdf";
  if ([".txt", ".csv", ".log", ".md"].includes(e)) return "text";
  return "unknown";
}

function skipFieldHtml(prefix, idSuffix = "skip") {
  return `<div class="field"><label>跳过前几条（筛选后再切片）</label>
    <input type="number" id="${prefix}-${idSuffix}" value="0" min="0" step="1" /></div>`;
}

/** 各文件类型通用：默认保留空格 */
function removeSpacesFieldHtml(prefix) {
  const name = `${prefix}-remove-spaces`;
  return `<div class="field field-radio"><label>空格处理</label>
    <div class="radio-row">
      <label><input type="radio" name="${name}" id="${prefix}-remove-spaces-keep" value="0" /> 保留空格</label>
      <label><input type="radio" name="${name}" id="${prefix}-remove-spaces-strip" value="1" checked /> 移除空格</label>
    </div></div>`;
}

function readRemoveSpaces(prefix) {
  const el = document.querySelector(`input[name="${prefix}-remove-spaces"]:checked`);
  if (!el) return false;
  return el.value === "1";
}

function readSkipFirst(prefix) {
  const id = readMatchMode(prefix) === "regex" ? `${prefix}-regex-skip` : `${prefix}-skip`;
  const el = document.getElementById(id);
  if (!el) return 0;
  const v = parseInt(String(el.value).trim(), 10);
  if (!Number.isFinite(v) || v < 0) return 0;
  return v;
}

function dedupeDuplicatesFieldHtml(prefix) {
  const name = `${prefix}-dedupe-duplicates`;
  return `<div class="field field-radio"><label>去除重复数据</label>
    <div class="radio-row">
      <label><input type="radio" name="${name}" id="${prefix}-dedupe-yes" value="1" checked /> 是</label>
      <label><input type="radio" name="${name}" id="${prefix}-dedupe-no" value="0" /> 否</label>
    </div></div>`;
}

function readDedupeDuplicates(prefix) {
  const el = document.querySelector(`input[name="${prefix}-dedupe-duplicates"]:checked`);
  if (!el) return true;
  return el.value === "1";
}

function sortMatchesFieldHtml(prefix) {
  const name = `${prefix}-sort-matches`;
  return `<div class="field field-radio"><label>数据排序（处理两个文件数据顺序不一致，两个文件都要开启排序）</label>
    <div class="radio-row">
      <label><input type="radio" name="${name}" id="${prefix}-sort-yes" value="1" /> 是</label>
      <label><input type="radio" name="${name}" id="${prefix}-sort-no" value="0" checked /> 否</label>
    </div></div>`;
}

function readSortMatches(prefix) {
  const el = document.querySelector(`input[name="${prefix}-sort-matches"]:checked`);
  if (!el) return false;
  return el.value === "1";
}

function regexRulesHtml(prefix) {
  return `
    <div class="field"><label>全文匹配正则表达式</label>
      <input type="text" id="${prefix}-fulltext-regex" placeholder="在文件全文中查找，可匹配多处" /></div>
    ${dedupeDuplicatesFieldHtml(prefix)}
    ${sortMatchesFieldHtml(prefix)}
    ${skipFieldHtml(prefix, "regex-skip")}
    <p class="field-hint">全文正则匹配 → 过滤重复（可选）→ 排序（可选，正序）→ 跳过前几条切片。PDF 使用上传时生成的缓存 JSON 文本。</p>`;
}

function rulesTabsShell(prefix, normalInner) {
  return `
    <div class="rules-tabs" data-prefix="${prefix}">
      <div class="rules-tab-bar" role="tablist">
        <button type="button" class="rules-tab active" role="tab" data-tab="normal" aria-selected="true">普通匹配</button>
        <button type="button" class="rules-tab" role="tab" data-tab="regex" aria-selected="false">正则匹配</button>
      </div>
      <div class="rules-tab-panel" data-panel="normal" role="tabpanel">${normalInner}</div>
      <div class="rules-tab-panel hidden" data-panel="regex" role="tabpanel">${regexRulesHtml(prefix)}</div>
    </div>`;
}

function readMatchMode(prefix) {
  const root = document.querySelector(`.rules-tabs[data-prefix="${prefix}"]`);
  if (!root) return "normal";
  const active = root.querySelector(".rules-tab.active");
  return active?.getAttribute("data-tab") === "regex" ? "regex" : "normal";
}

function bindRulesTabs(container) {
  container.querySelectorAll(".rules-tabs").forEach((root) => {
    const prefix = root.getAttribute("data-prefix");
    root.querySelectorAll(".rules-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = btn.getAttribute("data-tab");
        root.querySelectorAll(".rules-tab").forEach((b) => {
          const on = b.getAttribute("data-tab") === tab;
          b.classList.toggle("active", on);
          b.setAttribute("aria-selected", on ? "true" : "false");
        });
        root.querySelectorAll(".rules-tab-panel").forEach((panel) => {
          panel.classList.toggle("hidden", panel.getAttribute("data-panel") !== tab);
        });
        schedulePreviews();
      });
    });
  });
}

function rulesHtml(kind, prefix) {
  let normal = "";
  if (kind === "excel") {
    normal = `
      <div class="field"><label>Sheet 序号（从 0 开始）</label>
        <input type="number" id="${prefix}-sheet" value="0" min="0" /></div>
      <div class="field"><label>列号（如 A、B 或 1 表示第 1 列）</label>
        <input type="text" id="${prefix}-col" value="A" /></div>
      <div class="field"><label>正则（可选，匹配到的子串参与对比）</label>
        <input type="text" id="${prefix}-regex" placeholder="留空则取整格文本" /></div>
      ${skipFieldHtml(prefix)}
      ${removeSpacesFieldHtml(prefix)}
      <p class="field-hint">Excel：按列自上而下提取非空单元格。</p>`;
  } else if (kind === "pdf") {
    normal = `
      <div class="field"><label>每页行号（1 开始，逗号分隔，适用于每一页）</label>
        <input type="text" id="${prefix}-lines" value="1" placeholder="例：1,2" /></div>
      <div class="field"><label>格式化正则（可选）</label>
        <input type="text" id="${prefix}-regex" placeholder="留空则取整行文本" /></div>
      ${skipFieldHtml(prefix)}
      ${removeSpacesFieldHtml(prefix)}
      <p class="field-hint">PDF：按页提取文本后按行切分，再取指定行。</p>`;
  } else if (kind === "text") {
    normal = `
      <div class="field"><label>正则（可选，不匹配的行会跳过）</label>
        <input type="text" id="${prefix}-regex" placeholder="留空则取所有非空行" /></div>
      ${skipFieldHtml(prefix)}
      ${removeSpacesFieldHtml(prefix)}
      <p class="field-hint">纯文本：按行读取；有正则时只保留能匹配的行（取 group(0)）。</p>`;
  } else {
    normal = `${skipFieldHtml(prefix)}
    ${removeSpacesFieldHtml(prefix)}
    <p class="field-hint">该扩展名暂无专用规则，请上传 xlsx/xls、pdf 或 txt/csv。</p>`;
  }
  return rulesTabsShell(prefix, normal);
}

function renderRules(container, file, prefix) {
  if (!file) {
    container.innerHTML = "";
    return;
  }
  const k = extKind(file.ext);
  container.innerHTML = rulesHtml(k, prefix);
  bindRulesTabs(container);
}

function collectRules(prefix, file) {
  const k = extKind(file.ext);
  if (readMatchMode(prefix) === "regex") {
    const fulltext_regex = ($(`#${prefix}-fulltext-regex`) || { value: "" }).value.trim();
    return {
      match_mode: "regex",
      fulltext_regex: fulltext_regex || null,
      dedupe_duplicates: readDedupeDuplicates(prefix),
      sort_matches: readSortMatches(prefix),
      skip_first: readSkipFirst(prefix),
    };
  }
  const skip = readSkipFirst(prefix);
  const remove_spaces = readRemoveSpaces(prefix);
  const base = { match_mode: "normal", skip_first: skip, remove_spaces };
  if (k === "excel") {
    const sheet = parseInt($(`#${prefix}-sheet`).value, 10);
    const colRaw = $(`#${prefix}-col`).value.trim() || "A";
    const col = /^\d+$/.test(colRaw) ? parseInt(colRaw, 10) : colRaw;
    const regex = $(`#${prefix}-regex`).value.trim();
    return {
      ...base,
      sheet_index: Number.isFinite(sheet) ? sheet : 0,
      column: col,
      regex: regex || null,
    };
  }
  if (k === "pdf") {
    const raw = $(`#${prefix}-lines`).value || "1";
    const line_indices = raw
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0);
    const regex = $(`#${prefix}-regex`).value.trim();
    return {
      ...base,
      line_indices: line_indices.length ? line_indices : [1],
      regex: regex || null,
    };
  }
  if (k === "text") {
    const regex = $(`#${prefix}-regex`).value.trim();
    return { ...base, regex: regex || null };
  }
  return base;
}

async function api(path, opts = {}) {
  const r = await fetch(path, {
    credentials: "include",
    headers: { Accept: "application/json", ...(opts.body && !(opts.body instanceof FormData) ? { "Content-Type": "application/json" } : {}) },
    ...opts,
  });
  if (r.status === 401) {
    window.location.href = "/login";
    throw new Error("未登录");
  }
  if (!r.ok) {
    let msg = r.statusText;
    try {
      const j = await r.json();
      if (j.detail) msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
    } catch (_) {}
    throw new Error(msg);
  }
  if (r.status === 204) return null;
  return r.json();
}

let filesCache = [];
let previewTimer = null;

function schedulePreviews() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    refreshSidePreview("left").catch(() => {});
    refreshSidePreview("right").catch(() => {});
  }, 320);
}

async function refreshSidePreview(side) {
  const listEl = $(`#${side}-preview-list`);
  const metaEl = $(`#${side}-preview-meta`);
  const sel = $(`#${side}-file`);
  const emptyPick =
    side === "left" ? "请先选择文件 A。" : "请先选择文件 B。";
  const f = filesCache.find((x) => x.id === sel.value);
  if (!f) {
    listEl.innerHTML = "";
    listEl.classList.add("preview-empty");
    const li = document.createElement("li");
    li.textContent = emptyPick;
    listEl.appendChild(li);
    metaEl.textContent = "";
    return;
  }
  if (extKind(f.ext) === "unknown") {
    listEl.innerHTML = "";
    listEl.classList.add("preview-empty");
    const li = document.createElement("li");
    li.textContent = "该类型不支持预览。";
    listEl.appendChild(li);
    metaEl.textContent = "";
    return;
  }
  try {
    const rules = collectRules(side, f);
    const data = await api("/api/preview", { method: "POST", body: JSON.stringify({ file_id: f.id, rules }) });
    const items = data.preview || [];
    listEl.innerHTML = "";
    if (!items.length) {
      listEl.classList.add("preview-empty");
      const li = document.createElement("li");
      li.textContent =
        data.total === 0 ? "无数据（请检查规则或跳过条数）。" : "暂无可展示条目。";
      listEl.appendChild(li);
    } else {
      listEl.classList.remove("preview-empty");
      items.forEach((t) => {
        const li = document.createElement("li");
        li.textContent = String(t);
        listEl.appendChild(li);
      });
    }
    metaEl.textContent = `切片后共 ${data.total} 条；下方最多展示 3 条。`;
  } catch (e) {
    listEl.innerHTML = "";
    listEl.classList.add("preview-empty");
    const li = document.createElement("li");
    li.textContent = `预览失败：${e.message}`;
    listEl.appendChild(li);
    metaEl.textContent = "";
  }
}

function renderCompareRulesForSide(side) {
  const sel = $(`#${side}-file`);
  const f = filesCache.find((x) => x.id === sel.value);
  renderRules($(`#${side}-rules`), f, side);
}

/** 文件列表刷新后：两侧规则与当前选中文件对齐 */
function syncBothCompareRules() {
  renderCompareRulesForSide("left");
  renderCompareRulesForSide("right");
  schedulePreviews();
}

async function refreshFiles() {
  const data = await api("/api/files");
  filesCache = data.files || [];
  renderFileTable();
  populateFileSelects();
}

function renderFileTable() {
  const tb = $("#file-tbody");
  tb.innerHTML = "";
  for (const f of filesCache) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="file-name-cell">
        <span class="file-name-display" data-id="${f.id}">${escapeHtml(f.display_name)}</span>
      </td>
      <td>${escapeHtml(f.ext || "")}</td>
      <td>${formatSize(f.size)}</td>
      <td>${escapeHtml(formatBeijingTime(f.uploaded_at || ""))}</td>
      <td>${escapeHtml(formatBeijingTime(f.modified_at || ""))}</td>
      <td>${escapeHtml(f.owner_email || "—")}</td>
      <td>
        <button type="button" class="btn small" data-rename="${f.id}" data-rename-step="view">修改名称</button>
        <button type="button" class="btn small danger" data-del="${f.id}">删除</button>
      </td>`;
    tb.appendChild(tr);
  }
  tb.querySelectorAll("[data-rename]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-rename");
      const step = btn.getAttribute("data-rename-step");
      if (step === "view") {
        const span = tb.querySelector(`span.file-name-display[data-id="${id}"]`);
        if (!span) return;
        const td = span.closest(".file-name-cell");
        const inp = document.createElement("input");
        inp.type = "text";
        inp.className = "rename-input";
        inp.dataset.id = id;
        inp.value = span.textContent;
        td.innerHTML = "";
        td.appendChild(inp);
        inp.focus();
        inp.select();
        btn.textContent = "保存名称";
        btn.setAttribute("data-rename-step", "edit");
        return;
      }
      const inp = tb.querySelector(`input.rename-input[data-id="${id}"]`);
      if (!inp) return;
      try {
        await api(`/api/files/${id}`, { method: "PATCH", body: JSON.stringify({ display_name: inp.value }) });
        await refreshFiles();
      } catch (e) {
        alert(e.message);
      }
    });
  });
  tb.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("确定删除该文件？")) return;
      const id = btn.getAttribute("data-del");
      try {
        await api(`/api/files/${id}`, { method: "DELETE" });
        await refreshFiles();
      } catch (e) {
        alert(e.message);
      }
    });
  });
}

function populateFileSelects() {
  const left = $("#left-file");
  const right = $("#right-file");
  const mkOpts = (sel) => {
    const cur = sel.value;
    sel.innerHTML = '<option value="">— 请选择 —</option>';
    for (const f of filesCache) {
      const o = document.createElement("option");
      o.value = f.id;
      o.textContent = f.display_name;
      sel.appendChild(o);
    }
    if (filesCache.some((x) => x.id === cur)) sel.value = cur;
  };
  mkOpts(left);
  mkOpts(right);
  syncBothCompareRules();
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

function openModal(html) {
  $("#modal-body").innerHTML = html;
  $("#modal-overlay").classList.remove("hidden");
}

function closeModal() {
  $("#modal-overlay").classList.add("hidden");
}

function showCompareResult(data) {
  const lines = (data.items || []).map((it) => {
    const mark = it.ok ? '<span class="mark ok">✓</span>' : '<span class="mark bad">✗</span>';
    const la = it.left == null ? "（缺）" : escapeHtml(String(it.left));
    const ra = it.right == null ? "（缺）" : escapeHtml(String(it.right));
    return `<div class="compare-row"><span class="idx">${it.index}</span><div>${la} ↔ ${ra} ${mark}</div></div>`;
  });
  const banner =
    data.check_message && data.total > 0
      ? `<div class="summary success-banner">${escapeHtml(data.check_message)}</div>`
      : "";
  const html = `
    <h2 style="margin-top:0;font-size:1.1rem">对比结果</h2>
    <div class="summary">
      共对比 <strong>${data.total}</strong> 条；成功 <strong style="color:var(--ok)">${data.success}</strong>；
      失败 <strong style="color:var(--bad)">${data.failed}</strong>；成功率 <strong>${data.success_rate}%</strong>
    </div>
    ${banner}
    ${lines.join("")}`;
  openModal(html);
}

async function loadRecords() {
  const data = await api("/api/records");
  const tb = $("#records-tbody");
  tb.innerHTML = "";
  for (const r of data.records || []) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(r.left_name)}</td>
      <td>${escapeHtml(r.right_name)}</td>
      <td>${escapeHtml(formatBeijingTime(r.compared_at || ""))}</td>
      <td>${r.total}</td>
      <td>${r.success}</td>
      <td class="${r.failed > 0 ? "td-danger" : ""}">${r.failed}</td>
      <td class="${Number(r.success_rate) === 100 ? "td-success" : "td-danger"}">${r.success_rate}%</td>
      <td>${escapeHtml(r.owner_email || "—")}</td>
      <td><button type="button" class="btn small" data-record="${r.id}">详情</button></td>`;
    tb.appendChild(tr);
  }
  tb.querySelectorAll("[data-record]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-record");
      const detail = await api(`/api/records/${id}`);
      const lines = (detail.items || []).map((it) => {
        const mark = it.ok ? '<span class="mark ok">✓</span>' : '<span class="mark bad">✗</span>';
        const la = it.left == null ? "（缺）" : escapeHtml(String(it.left));
        const ra = it.right == null ? "（缺）" : escapeHtml(String(it.right));
        return `<div class="compare-row"><span class="idx">${it.index}</span><div>${la} ↔ ${ra} ${mark}</div></div>`;
      });
      openModal(`
        <h2 style="margin-top:0;font-size:1.05rem">记录详情</h2>
        <p style="color:var(--muted);font-size:0.85rem">${escapeHtml(detail.left_name)} ↔ ${escapeHtml(detail.right_name)} · ${escapeHtml(formatBeijingTime(detail.compared_at || ""))}</p>
        ${lines.join("")}
        <div class="summary">成功率 ${detail.success_rate}%</div>`);
    });
  });
}

function closeMobileNav() {
  const sidebar = document.getElementById("sidebar");
  const backdrop = document.getElementById("sidebar-backdrop");
  const btnMenu = document.getElementById("btn-menu");
  if (!sidebar || !sidebar.classList.contains("open")) return;
  sidebar.classList.remove("open");
  if (backdrop) {
    backdrop.classList.add("hidden");
    backdrop.setAttribute("aria-hidden", "true");
  }
  if (btnMenu) btnMenu.setAttribute("aria-expanded", "false");
  document.body.style.overflow = "";
}

function bindMobileNav() {
  const sidebar = document.getElementById("sidebar");
  const backdrop = document.getElementById("sidebar-backdrop");
  const btnMenu = document.getElementById("btn-menu");
  if (!sidebar || !backdrop || !btnMenu) return;

  function openMenu() {
    sidebar.classList.add("open");
    backdrop.classList.remove("hidden");
    backdrop.setAttribute("aria-hidden", "false");
    btnMenu.setAttribute("aria-expanded", "true");
    document.body.style.overflow = "hidden";
  }

  btnMenu.addEventListener("click", () => {
    if (sidebar.classList.contains("open")) closeMobileNav();
    else openMenu();
  });
  backdrop.addEventListener("click", closeMobileNav);
  window.addEventListener("resize", () => {
    if (window.innerWidth > 768) closeMobileNav();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const modal = $("#modal-overlay");
    if (modal && !modal.classList.contains("hidden")) {
      closeModal();
      return;
    }
    closeMobileNav();
  });
}

const VIEW_PATHS = { files: "/files", compare: "/compare", records: "/records" };

function pathnameToView() {
  const path = (location.pathname || "/").replace(/\/$/, "") || "/";
  if (path === "/" || path === "/files") return "files";
  if (path === "/compare") return "compare";
  if (path === "/records") return "records";
  return "files";
}

function stripBootViewStyle() {
  document.getElementById("boot-view-style")?.remove();
  if (document.documentElement.dataset.bootView) delete document.documentElement.dataset.bootView;
}

/**
 * @param {string} view
 * @param {{ replaceUrl?: boolean; syncOnly?: boolean }} [opts]
 */
function applyView(view, opts = {}) {
  const { replaceUrl = false, syncOnly = false } = opts;
  stripBootViewStyle();
  const v = view in VIEW_PATHS ? view : "files";
  const targetPath = VIEW_PATHS[v];
  document.querySelectorAll(".nav-item").forEach((b) => {
    b.classList.toggle("active", b.getAttribute("data-view") === v);
  });
  document.querySelectorAll(".view").forEach((el) => el.classList.add("hidden"));
  const panel = document.getElementById(`view-${v}`);
  if (panel) panel.classList.remove("hidden");
  if (v === "records") loadRecords().catch((e) => alert(e.message));
  if (v === "compare") schedulePreviews();
  closeMobileNav();
  if (!syncOnly && location.pathname !== targetPath) {
    const state = { view: v };
    if (replaceUrl) history.replaceState(state, "", targetPath);
    else history.pushState(state, "", targetPath);
  }
}

function bindNav() {
  document.querySelectorAll(".nav-item").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      const v = el.getAttribute("data-view");
      if (!v) return;
      applyView(v);
    });
  });
  window.addEventListener("popstate", () => {
    applyView(pathnameToView(), { syncOnly: true });
  });
}

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

let uploadInProgress = false;

function setDropzoneUploading(on) {
  const dz = $("#dropzone");
  const overlay = $("#dropzone-loading");
  if (!dz || !overlay) return;
  dz.classList.toggle("uploading", on);
  overlay.classList.toggle("hidden", !on);
}

function bindFileTableShortcuts() {
  const tb = $("#file-tbody");
  if (!tb) return;
  tb.addEventListener("keydown", (e) => {
    if (!e.target.matches?.("input.rename-input")) return;
    if (e.key !== "Enter") return;
    e.preventDefault();
    const id = e.target.dataset.id;
    const btn = tb.querySelector(`button[data-rename="${id}"][data-rename-step="edit"]`);
    btn?.click();
  });
}

function bindUpload() {
  const dz = $("#dropzone");
  const input = $("#file-input");
  $("#btn-pick").addEventListener("click", () => input.click());
  input.addEventListener("change", () => uploadFiles(input.files));
  ["dragenter", "dragover"].forEach((ev) => {
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      if (!uploadInProgress) dz.classList.add("dragover");
    });
  });
  ["dragleave", "drop"].forEach((ev) => {
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.remove("dragover");
    });
  });
  dz.addEventListener("drop", (e) => uploadFiles(e.dataTransfer.files));
}

async function uploadFiles(fileList) {
  if (!fileList || !fileList.length) return;
  if (uploadInProgress) return;
  uploadInProgress = true;
  setDropzoneUploading(true);
  try {
    for (const f of fileList) {
      if (f.size > MAX_UPLOAD_BYTES) {
        alert(`${f.name}: 单文件不能超过 10MB`);
        continue;
      }
      const fd = new FormData();
      fd.append("file", f);
      try {
        await api("/api/files", { method: "POST", body: fd });
      } catch (e) {
        alert(`${f.name}: ${e.message}`);
      }
    }
    await refreshFiles();
  } finally {
    uploadInProgress = false;
    setDropzoneUploading(false);
    if ($("#file-input")) $("#file-input").value = "";
  }
}

function bindCompareSelectors() {
  const left = $("#left-file");
  const right = $("#right-file");
  left.addEventListener("change", () => {
    renderCompareRulesForSide("left");
    schedulePreviews();
  });
  right.addEventListener("change", () => {
    renderCompareRulesForSide("right");
    schedulePreviews();
  });

  const compareView = $("#view-compare");
  compareView.addEventListener("input", (e) => {
    if (e.target?.closest?.("#left-rules, #right-rules")) schedulePreviews();
  });
  compareView.addEventListener("change", (e) => {
    if (e.target?.closest?.("#left-rules, #right-rules")) schedulePreviews();
  });
  compareView.addEventListener("click", (e) => {
    if (e.target?.closest?.(".rules-tab")) schedulePreviews();
  });

  const btnCompare = $("#btn-compare");
  function setCompareLoading(loading) {
    btnCompare.classList.toggle("loading", loading);
    btnCompare.disabled = loading;
    btnCompare.setAttribute("aria-busy", loading ? "true" : "false");
  }

  btnCompare.addEventListener("click", async () => {
    const lf = filesCache.find((x) => x.id === left.value);
    const rf = filesCache.find((x) => x.id === right.value);
    if (!lf || !rf) {
      alert("请选择两个文件");
      return;
    }
    if (extKind(lf.ext) === "unknown" || extKind(rf.ext) === "unknown") {
      alert("所选文件类型不支持对比规则");
      return;
    }
    setCompareLoading(true);
    try {
      const body = {
        left_file_id: lf.id,
        right_file_id: rf.id,
        left_rules: collectRules("left", lf),
        right_rules: collectRules("right", rf),
      };
      const data = await api("/api/compare", { method: "POST", body: JSON.stringify(body) });
      showCompareResult(data);
      await loadRecords();
    } catch (e) {
      alert(e.message);
    } finally {
      setCompareLoading(false);
    }
  });
}

$("#modal-close").addEventListener("click", closeModal);
$("#modal-overlay").addEventListener("click", (e) => {
  if (e.target.id === "modal-overlay") closeModal();
});

const THEME_STORAGE_KEY = "theme-preference";

function syncThemeToggleUi() {
  const btn = $("#theme-toggle");
  if (!btn) return;
  const isLight = document.documentElement.dataset.theme === "light";
  btn.setAttribute("aria-checked", isLight ? "true" : "false");
  btn.setAttribute(
    "aria-label",
    isLight ? "主题：白天，点击切换到黑夜" : "主题：黑夜，点击切换到白天",
  );
}

function applyThemeMeta() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  meta.content = document.documentElement.dataset.theme === "light" ? "#f4f6f9" : "#0f1419";
}

function bindThemeToggle() {
  const btn = $("#theme-toggle");
  if (!btn) return;
  syncThemeToggleUi();
  btn.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch (_) {}
    applyThemeMeta();
    syncThemeToggleUi();
  });
}

function renderUserBar() {
  const label = $("#user-menu-label");
  if (label) {
    const base = authMe.email || "";
    label.textContent = authMe.is_guest ? `${base}（访客）` : base;
  }
}

function bindUserMenu() {
  const btn = $("#user-menu-btn");
  const menu = $("#user-menu-dropdown");
  const logoutBtn = $("#user-logout");
  if (!btn || !menu) return;

  function closeMenu() {
    menu.classList.add("hidden");
    btn.setAttribute("aria-expanded", "false");
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (menu.classList.contains("hidden")) {
      menu.classList.remove("hidden");
      btn.setAttribute("aria-expanded", "true");
    } else {
      closeMenu();
    }
  });

  document.addEventListener("click", () => closeMenu());
  menu.addEventListener("click", (e) => e.stopPropagation());

  logoutBtn?.addEventListener("click", async () => {
    try {
      await api("/api/auth/logout", { method: "POST", body: JSON.stringify({}) });
    } catch (_) {}
    window.location.href = "/login";
  });
}

bindThemeToggle();

(async () => {
  if (!(await ensureAuth())) return;
  renderUserBar();
  bindUserMenu();
  bindMobileNav();
  bindNav();
  applyView(pathnameToView(), { replaceUrl: true });
  bindUpload();
  bindFileTableShortcuts();
  bindCompareSelectors();
  refreshFiles().catch((e) => alert(e.message));
})();
