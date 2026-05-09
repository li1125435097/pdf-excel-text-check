const $ = (sel, root = document) => root.querySelector(sel);

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

function skipFieldHtml(prefix) {
  return `<div class="field"><label>跳过前几条（筛选后再切片）</label>
    <input type="number" id="${prefix}-skip" value="0" min="0" step="1" /></div>`;
}

function readSkipFirst(prefix) {
  const el = document.getElementById(`${prefix}-skip`);
  if (!el) return 0;
  const v = parseInt(String(el.value).trim(), 10);
  if (!Number.isFinite(v) || v < 0) return 0;
  return v;
}

function rulesHtml(kind, prefix) {
  if (kind === "excel") {
    return `
      <div class="field"><label>Sheet 序号（从 0 开始）</label>
        <input type="number" id="${prefix}-sheet" value="0" min="0" /></div>
      <div class="field"><label>列号（如 A、B 或 1 表示第 1 列）</label>
        <input type="text" id="${prefix}-col" value="A" /></div>
      <div class="field"><label>正则（可选，匹配到的子串参与对比）</label>
        <input type="text" id="${prefix}-regex" placeholder="留空则取整格文本" /></div>
      ${skipFieldHtml(prefix)}
      <p class="field-hint">Excel：按列自上而下提取非空单元格。</p>`;
  }
  if (kind === "pdf") {
    return `
      <div class="field"><label>每页行号（1 开始，逗号分隔，适用于每一页）</label>
        <input type="text" id="${prefix}-lines" value="1" placeholder="例：1,2" /></div>
      <div class="field"><label>正则（可选）</label>
        <input type="text" id="${prefix}-regex" placeholder="留空则取整行文本" /></div>
      ${skipFieldHtml(prefix)}
      <p class="field-hint">PDF：按页提取文本后按行切分，再取指定行。</p>`;
  }
  if (kind === "text") {
    return `
      <div class="field"><label>正则（可选，不匹配的行会跳过）</label>
        <input type="text" id="${prefix}-regex" placeholder="留空则取所有非空行" /></div>
      ${skipFieldHtml(prefix)}
      <p class="field-hint">纯文本：按行读取；有正则时只保留能匹配的行（取 group(0)）。</p>`;
  }
  return `${skipFieldHtml(prefix)}
    <p class="field-hint">该扩展名暂无专用规则，请上传 xlsx/xls、pdf 或 txt/csv。</p>`;
}

function renderRules(container, file, prefix) {
  if (!file) {
    container.innerHTML = "";
    return;
  }
  const k = extKind(file.ext);
  container.innerHTML = rulesHtml(k, prefix);
}

function collectRules(prefix, file) {
  const k = extKind(file.ext);
  const skip = readSkipFirst(prefix);
  if (k === "excel") {
    const sheet = parseInt($(`#${prefix}-sheet`).value, 10);
    const colRaw = $(`#${prefix}-col`).value.trim() || "A";
    const col = /^\d+$/.test(colRaw) ? parseInt(colRaw, 10) : colRaw;
    const regex = $(`#${prefix}-regex`).value.trim();
    return {
      sheet_index: Number.isFinite(sheet) ? sheet : 0,
      column: col,
      regex: regex || null,
      skip_first: skip,
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
      line_indices: line_indices.length ? line_indices : [1],
      regex: regex || null,
      skip_first: skip,
    };
  }
  if (k === "text") {
    const regex = $(`#${prefix}-regex`).value.trim();
    return { regex: regex || null, skip_first: skip };
  }
  return { skip_first: skip };
}

async function api(path, opts = {}) {
  const r = await fetch(path, {
    headers: { Accept: "application/json", ...(opts.body && !(opts.body instanceof FormData) ? { "Content-Type": "application/json" } : {}) },
    ...opts,
  });
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
      <td><input class="rename-input" data-id="${f.id}" value="${escapeAttr(f.display_name)}" /></td>
      <td>${escapeHtml(f.ext || "")}</td>
      <td>${formatSize(f.size)}</td>
      <td>${escapeHtml(formatBeijingTime(f.uploaded_at || ""))}</td>
      <td>${escapeHtml(formatBeijingTime(f.modified_at || ""))}</td>
      <td>
        <button type="button" class="btn small" data-rename="${f.id}">保存名称</button>
        <button type="button" class="btn small danger" data-del="${f.id}">删除</button>
      </td>`;
    tb.appendChild(tr);
  }
  tb.querySelectorAll("[data-rename]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-rename");
      const inp = tb.querySelector(`input.rename-input[data-id="${id}"]`);
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
    ${lines.join("")}
    <div class="summary">
      共对比 <strong>${data.total}</strong> 条；成功 <strong style="color:var(--ok)">${data.success}</strong>；
      失败 <strong style="color:var(--bad)">${data.failed}</strong>；成功率 <strong>${data.success_rate}%</strong>
    </div>
    ${banner}`;
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
      <td>${r.failed}</td>
      <td>${r.success_rate}%</td>
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

function bindNav() {
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const v = btn.getAttribute("data-view");
      document.querySelectorAll(".view").forEach((el) => el.classList.add("hidden"));
      $(`#view-${v}`).classList.remove("hidden");
      if (v === "records") loadRecords().catch((e) => alert(e.message));
      if (v === "compare") schedulePreviews();
      closeMobileNav();
    });
  });
}

let uploadInProgress = false;

function setDropzoneUploading(on) {
  const dz = $("#dropzone");
  const overlay = $("#dropzone-loading");
  if (!dz || !overlay) return;
  dz.classList.toggle("uploading", on);
  overlay.classList.toggle("hidden", !on);
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

bindMobileNav();
bindNav();
bindUpload();
bindCompareSelectors();
refreshFiles().catch((e) => alert(e.message));
