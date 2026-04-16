const state = {
  notes: [],
  currentNote: null,
  selectedVersionId: null,
  isPreviewOpen: false,
  editor: null,
  isBusy: false,
  loadNoteSeq: 0,
};

const elements = {
  notesList: document.getElementById("notes-list"),
  historyList: document.getElementById("history-list"),
  newNoteBtn: document.getElementById("new-note-btn"),
  saveNoteBtn: document.getElementById("save-note-btn"),
  deleteNoteBtn: document.getElementById("delete-note-btn"),
  togglePreviewBtn: document.getElementById("toggle-preview-btn"),
  editorShell: document.getElementById("editor-shell"),
  editorMain: document.querySelector(".editor-main"),
  noteTitle: document.getElementById("note-title"),
  documentEditor: document.getElementById("document-editor"),
  previewPane: document.getElementById("preview-pane"),
  previewContent: document.getElementById("preview-content"),
  currentFileName: document.getElementById("current-file-name"),
  statusLeft: document.getElementById("status-left"),
  statusRight: document.getElementById("status-right"),
  statusMessage: document.getElementById("status-message"),
};

let statusTimeoutId = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sanitizeRenderedHtml(html) {
  const template = document.createElement("template");
  template.innerHTML = html;

  template.content
    .querySelectorAll("script, iframe, object, embed, link, meta, style")
    .forEach((element) => element.remove());

  template.content.querySelectorAll("*").forEach((element) => {
    [...element.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();

      if (name.startsWith("on") || name === "style" || name === "srcdoc") {
        element.removeAttribute(attribute.name);
        return;
      }

      if ((name === "href" || name === "src") && value.startsWith("javascript:")) {
        element.removeAttribute(attribute.name);
      }
    });
  });

  return template.innerHTML;
}

function renderMarkdown(source) {
  configureMarked();
  if (window.marked?.parse) {
    return sanitizeRenderedHtml(window.marked.parse(source || "", { breaks: true }));
  }

  return escapeHtml(source || "").replaceAll("\n", "<br />");
}

function configureMarked() {
  if (window.__notesWebMarkedConfigured) return;
  if (!window.marked?.use) return;
  window.__notesWebMarkedConfigured = true;
  // Prevent marked from rendering raw HTML in user input.
  window.marked.use({ renderer: { html: () => "" } });
}

function showStatus(message) {
  window.clearTimeout(statusTimeoutId);
  elements.statusMessage.textContent = message;
  elements.statusMessage.classList.add("visible");
  statusTimeoutId = window.setTimeout(() => {
    elements.statusMessage.classList.remove("visible");
  }, 2500);
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = { error: await response.text().catch(() => "") };
  }

  if (!response.ok) {
    const message = payload?.error || payload?.message || `请求失败(${response.status})`;
    throw new Error(message);
  }

  return payload || {};
}

function formatDateTime(value) {
  return value || "--";
}

function sortNotes() {
  state.notes.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
}

function getDocumentContent() {
  if (state.editor) {
    return state.editor.getValue();
  }
  return elements.documentEditor.value || "";
}

function setDocumentContent(value) {
  if (state.editor) {
    state.editor.setValue(value || "");
    return;
  }
  elements.documentEditor.value = value || "";
}

function syncCurrentNoteDocument() {
  if (!state.currentNote) {
    return;
  }
  state.currentNote.document = getDocumentContent();
}

function upsertNoteSummary(note) {
  const summary = {
    id: note.id,
    title: note.title,
    created_at: note.created_at,
    updated_at: note.updated_at,
    version_count: note.versions?.length || note.version_count || 0,
  };

  const index = state.notes.findIndex((item) => item.id === note.id);
  if (index >= 0) {
    state.notes[index] = summary;
  } else {
    state.notes.push(summary);
  }
  sortNotes();
}

function setCurrentNote(note) {
  state.currentNote = note ? structuredClone(note) : null;
  const latestVersion = state.currentNote?.versions?.[state.currentNote.versions.length - 1];
  state.selectedVersionId = latestVersion?.id || null;
}

function getSelectedVersion() {
  return state.currentNote?.versions?.find((item) => item.id === state.selectedVersionId) || null;
}

function initializeEditor() {
  if (state.editor || !window.CodeMirror?.fromTextArea) {
    return;
  }

  state.editor = window.CodeMirror.fromTextArea(elements.documentEditor, {
    mode: "markdown",
    theme: "default",
    lineNumbers: true,
    lineWrapping: true,
    indentUnit: 2,
    tabSize: 2,
    viewportMargin: Infinity,
  });

  state.editor.on("change", () => {
    syncCurrentNoteDocument();
    scheduleUpdatePreview();
    updateStatusBar();
  });
}

function updateStatusBar() {
  const lineCount = getDocumentContent().split("\n").length;
  elements.statusLeft.textContent = state.currentNote ? `本地模式 · ${state.currentNote.id}` : "本地模式";
  elements.statusRight.textContent = `Markdown · ${lineCount} 行`;
}

function updatePreview() {
  const document = getDocumentContent();
  elements.previewContent.innerHTML = document.trim()
    ? renderMarkdown(document)
    : '<div class="preview-placeholder">预览会显示在这里</div>';
}

let previewDebounceId = null;
function scheduleUpdatePreview() {
  if (!state.isPreviewOpen) return;
  window.clearTimeout(previewDebounceId);
  previewDebounceId = window.setTimeout(() => {
    if (!state.isPreviewOpen) return;
    updatePreview();
  }, 200);
}

function updatePreviewVisibility() {
  elements.previewPane.hidden = !state.isPreviewOpen;
  elements.editorMain.classList.toggle("preview-open", state.isPreviewOpen);
  elements.togglePreviewBtn.textContent = state.isPreviewOpen ? "关闭预览" : "预览";
  elements.togglePreviewBtn.classList.toggle("is-active", state.isPreviewOpen);
  elements.togglePreviewBtn.setAttribute("aria-pressed", String(state.isPreviewOpen));
  if (state.isPreviewOpen) {
    updatePreview();
    state.editor?.refresh();
  }
}

function setEditorEnabled(enabled) {
  const disabled = !enabled || state.isBusy;
  elements.saveNoteBtn.disabled = disabled;
  elements.deleteNoteBtn.disabled = disabled;
  elements.togglePreviewBtn.disabled = disabled;
  elements.noteTitle.disabled = disabled;
  if (!enabled) {
    setDocumentContent("");
  }
}

function setBusy(busy) {
  state.isBusy = Boolean(busy);
  elements.newNoteBtn.disabled = state.isBusy;

  elements.notesList?.querySelectorAll("button").forEach((btn) => {
    btn.disabled = state.isBusy;
  });
  elements.historyList?.querySelectorAll("button").forEach((btn) => {
    btn.disabled = state.isBusy;
  });

  // Recompute editor buttons enablement for the current state.
  setEditorEnabled(Boolean(state.currentNote));
}

async function runWithBusy(fn) {
  setBusy(true);
  try {
    return await fn();
  } finally {
    setBusy(false);
  }
}

function renderNotesList() {
  elements.notesList.innerHTML = "";

  if (state.notes.length === 0) {
    elements.notesList.innerHTML = '<div class="empty-list">还没有笔记，点击上方按钮创建。</div>';
    return;
  }

  state.notes.forEach((note) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `note-item ${state.currentNote?.id === note.id ? "active" : ""}`.trim();
    item.disabled = state.isBusy;
    item.innerHTML = `
      <div class="note-item-body">
        <div class="note-main">
          <div class="note-title">${escapeHtml(note.title)}</div>
          <div class="note-meta">更新于 ${escapeHtml(formatDateTime(note.updated_at))}</div>
          <div class="note-meta">${note.version_count || 0} 个历史版本</div>
        </div>
        <span class="icon-button" data-role="delete-note" title="删除笔记">🗑</span>
      </div>
    `;

    item.addEventListener("click", (event) => {
      if (state.isBusy) return;
      if (event.target.closest('[data-role="delete-note"]')) {
        deleteNote(note.id).catch(handleError);
        return;
      }
      loadNote(note.id).catch(handleError);
    });

    elements.notesList.append(item);
  });
}

function renderHistoryList() {
  elements.historyList.innerHTML = "";

  if (!state.currentNote) {
    elements.historyList.innerHTML = '<div class="empty-list">选择笔记后，这里会展示它的历史版本。</div>';
    return;
  }

  const versions = [...(state.currentNote.versions || [])].reverse();
  if (versions.length === 0) {
    elements.historyList.innerHTML = '<div class="empty-list">当前笔记还没有历史版本。</div>';
    return;
  }

  versions.forEach((version, index) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `history-item ${version.id === state.selectedVersionId ? "active" : ""}`.trim();
    item.disabled = state.isBusy;
    item.innerHTML = `
      <div class="history-item-body">
        <div class="history-main">
          <div class="history-title">版本 ${versions.length - index}</div>
          <div class="history-meta">${escapeHtml(formatDateTime(version.time))}</div>
          <div class="history-meta">${version.restored_from ? `恢复自 ${escapeHtml(version.restored_from)}` : "普通保存"}</div>
        </div>
        <span class="icon-button" data-role="delete-version" title="删除历史版本">🗑</span>
      </div>
    `;

    item.addEventListener("click", (event) => {
      if (state.isBusy) return;
      if (event.target.closest('[data-role="delete-version"]')) {
        deleteVersion(version.id).catch(handleError);
        return;
      }
      restoreVersion(version.id).catch(handleError);
    });

    elements.historyList.append(item);
  });
}

function renderEmptyEditor() {
  elements.editorShell.hidden = false;
  setEditorEnabled(false);
  elements.noteTitle.value = "";
  elements.currentFileName.textContent = "untitled.md";
  renderHistoryList();
  updateStatusBar();
}

function renderEditor() {
  if (!state.currentNote) {
    renderEmptyEditor();
    return;
  }

  elements.editorShell.hidden = false;
  setEditorEnabled(true);
  elements.noteTitle.value = state.currentNote.title;
  elements.currentFileName.textContent = `${state.currentNote.title || "untitled"}.md`;
  setDocumentContent(state.currentNote.document || "");
  updatePreview();
  updateStatusBar();
  renderHistoryList();
  state.editor?.refresh();
}

async function loadNotes() {
  setBusy(true);
  try {
    const payload = await requestJson("/api/notes");
    state.notes = payload.notes || [];
    sortNotes();
    renderNotesList();

    if (state.notes.length === 0) {
      setCurrentNote(null);
      renderEditor();
      return;
    }

    const selectedId =
      state.currentNote?.id && state.notes.some((item) => item.id === state.currentNote.id)
        ? state.currentNote.id
        : state.notes[0].id;
    await loadNote(selectedId);
  } finally {
    setBusy(false);
  }
}

async function loadNote(noteId) {
  const seq = ++state.loadNoteSeq;
  setBusy(true);
  try {
    const payload = await requestJson(`/api/notes/${noteId}`);
    if (seq !== state.loadNoteSeq) return;

    setCurrentNote(payload.note);
    upsertNoteSummary(payload.note);
    renderNotesList();
    renderEditor();
  } finally {
    if (seq === state.loadNoteSeq) {
      setBusy(false);
    }
  }
}

async function createNote() {
  if (state.isBusy) return;
  await runWithBusy(async () => {
    const payload = await requestJson("/api/notes", { method: "POST" });
    setCurrentNote(payload.note);
    upsertNoteSummary(payload.note);
    renderNotesList();
    renderEditor();
    showStatus("已创建新笔记");
  });
}

async function saveCurrentNote() {
  if (!state.currentNote) {
    return;
  }

  if (state.isBusy) return;
  await runWithBusy(async () => {
    syncCurrentNoteDocument();
    const payload = await requestJson(`/api/notes/${state.currentNote.id}`, {
      method: "PUT",
      body: JSON.stringify({
        title: state.currentNote.title,
        document: state.currentNote.document,
      }),
    });

    setCurrentNote(payload.note);
    upsertNoteSummary(payload.note);
    renderNotesList();
    renderEditor();
    showStatus("笔记已保存");
  });
}

async function restoreVersion(versionId) {
  if (!state.currentNote) {
    return;
  }
  if (state.isBusy) return;

  const target = state.currentNote.versions.find((item) => item.id === versionId);
  if (!target) {
    return;
  }

  const shouldContinue = window.confirm(`确认恢复 ${target.time} 的版本为当前内容吗？`);
  if (!shouldContinue) {
    return;
  }

  await runWithBusy(async () => {
    const payload = await requestJson(`/api/notes/${state.currentNote.id}/restore`, {
      method: "POST",
      body: JSON.stringify({ version_id: versionId }),
    });

    setCurrentNote(payload.note);
    upsertNoteSummary(payload.note);
    renderNotesList();
    renderEditor();
    showStatus("已恢复历史版本");
  });
}

async function deleteVersion(versionId) {
  if (!state.currentNote) {
    return;
  }
  if (state.isBusy) return;

  const target = state.currentNote.versions.find((item) => item.id === versionId);
  if (!target) {
    return;
  }

  const shouldContinue = window.confirm(`确认删除 ${target.time} 的历史版本吗？此操作不可撤销。`);
  if (!shouldContinue) {
    return;
  }

  await runWithBusy(async () => {
    const payload = await requestJson(`/api/notes/${state.currentNote.id}/versions/${versionId}`, {
      method: "DELETE",
    });

    setCurrentNote(payload.note);
    upsertNoteSummary(payload.note);
    renderNotesList();
    renderEditor();
    showStatus("历史版本已删除");
  });
}

async function deleteNote(noteId = state.currentNote?.id) {
  if (!noteId) {
    return;
  }
  if (state.isBusy) return;

  const note = state.notes.find((item) => item.id === noteId) || state.currentNote;
  const shouldContinue = window.confirm(`确认删除笔记“${note?.title || noteId}”吗？此操作不可撤销。`);
  if (!shouldContinue) {
    return;
  }

  await runWithBusy(async () => {
    await requestJson(`/api/notes/${noteId}`, { method: "DELETE" });
    state.notes = state.notes.filter((item) => item.id !== noteId);
    if (state.currentNote?.id === noteId) {
      setCurrentNote(null);
    }
    renderNotesList();

    if (state.notes.length > 0) {
      await loadNote(state.notes[0].id);
    } else {
      renderEditor();
    }

    showStatus("笔记已删除");
  });
}

function bindEvents() {
  elements.newNoteBtn.addEventListener("click", () => createNote().catch(handleError));
  elements.saveNoteBtn.addEventListener("click", () => saveCurrentNote().catch(handleError));
  elements.deleteNoteBtn.addEventListener("click", () => deleteNote().catch(handleError));
  elements.togglePreviewBtn.addEventListener("click", () => {
    if (state.isBusy) return;
    state.isPreviewOpen = !state.isPreviewOpen;
    updatePreviewVisibility();
  });

  elements.noteTitle.addEventListener("input", (event) => {
    if (!state.currentNote) {
      return;
    }
    if (state.isBusy) return;
    state.currentNote.title = event.target.value.trim() || "未命名笔记";
    elements.currentFileName.textContent = `${state.currentNote.title}.md`;
    upsertNoteSummary(state.currentNote);
    renderNotesList();
  });
}

function handleError(error) {
  console.error(error);
  showStatus(error.message || "出现错误，请稍后重试");
}

document.addEventListener("DOMContentLoaded", async () => {
  initializeEditor();
  bindEvents();
  updatePreviewVisibility();
  try {
    await loadNotes();
  } catch (error) {
    handleError(error);
  }
});
