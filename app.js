/* global idb, jspdf */
const { openDB } = idb;
const { jsPDF } = jspdf;

const DB_NAME = "foodDiaryDb";
const DB_VERSION = 1;
const STORE = "entries";

const els = {
  openNewEntry: document.getElementById("openNewEntry"),
  exportPdf: document.getElementById("exportPdf"),
  status: document.getElementById("status"),
  entries: document.getElementById("entries"),
  emptyState: document.getElementById("emptyState"),

  entryDialog: document.getElementById("entryDialog"),
  entryForm: document.getElementById("entryForm"),
  closeDialog: document.getElementById("closeDialog"),
  cancel: document.getElementById("cancel"),

  capturedAt: document.getElementById("capturedAt"),
  capturedAtPretty: document.getElementById("capturedAtPretty"),

  photos: document.getElementById("photos"),
  photoPreview: document.getElementById("photoPreview"),

  mealName: document.getElementById("mealName"),
  dishComponents: document.getElementById("dishComponents"),
  fullnessBefore: document.getElementById("fullnessBefore"),
  fullnessAfter: document.getElementById("fullnessAfter"),
  place: document.getElementById("place"),
  edBehaviors: document.getElementById("edBehaviors"),
  feelings: document.getElementById("feelings"),
  comments: document.getElementById("comments"),

  exportDialog: document.getElementById("exportDialog"),
  exportForm: document.getElementById("exportForm"),
  closeExport: document.getElementById("closeExport"),
  exportCancel: document.getElementById("exportCancel"),
  range: document.getElementById("range")
};

let dbPromise;
let currentPhotoFiles = []; // File objects kept until Save
let currentEditingId = null; // Track if editing an existing entry
let expandedDayKey = null; // Track which day group is expanded

function setStatus(msg) {
  els.status.textContent = msg || "";
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function ordinalSuffix(day) {
  const mod100 = day % 100;
  if (mod100 >= 11 && mod100 <= 13) return "th";
  const mod10 = day % 10;
  if (mod10 === 1) return "st";
  if (mod10 === 2) return "nd";
  if (mod10 === 3) return "rd";
  return "th";
}

function formatPretty(dt) {
  const weekdays = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  const wd = weekdays[dt.getDay()];
  const mo = months[dt.getMonth()];
  const day = dt.getDate();
  const suff = ordinalSuffix(day);

  let hours = dt.getHours();
  const minutes = pad2(dt.getMinutes());
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  if (hours === 0) hours = 12;

  return `${wd} ${mo} ${day}${suff} ${hours}:${minutes} ${ampm}`;
}

function formatTime(dt) {
  let hours = dt.getHours();
  const minutes = pad2(dt.getMinutes());
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  if (hours === 0) hours = 12;
  return `${hours}:${minutes} ${ampm}`;
}

function toDatetimeLocalValue(dt) {
  const y = dt.getFullYear();
  const m = pad2(dt.getMonth() + 1);
  const d = pad2(dt.getDate());
  const hh = pad2(dt.getHours());
  const mm = pad2(dt.getMinutes());
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

function fromDatetimeLocalValue(v) {
  // v is local time without zone, treat it as local
  const [datePart, timePart] = v.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const [hh, mm] = timePart.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

async function initDb() {
  dbPromise = openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        store.createIndex("capturedAt", "capturedAt");
      }
    }
  });
  await pruneOldEntries();
}

async function pruneOldEntries() {
  const db = await dbPromise;
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  const all = await store.getAll();
  for (const e of all) {
    if (new Date(e.capturedAt).getTime() < cutoff) {
      await store.delete(e.id);
    }
  }
  await tx.done;
}

function groupByDay(entries) {
  const map = new Map();
  for (const e of entries) {
    const dt = new Date(e.capturedAt);
    const key = dt.getFullYear() + "-" + pad2(dt.getMonth() + 1) + "-" + pad2(dt.getDate());
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(e);
  }

  // Sort groups by day desc
  const keys = Array.from(map.keys()).sort((a, b) => (a < b ? 1 : -1));
  return keys.map(k => {
    const items = map.get(k).sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt));
    return { dayKey: k, items };
  });
}

function prettyDayHeader(dayKey) {
  const [y, m, d] = dayKey.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const weekdays = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  return `${weekdays[dt.getDay()]}, ${months[dt.getMonth()]} ${dt.getDate()}${ordinalSuffix(dt.getDate())}, ${dt.getFullYear()}`;
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v);
  }
  for (const c of children) node.appendChild(c);
  return node;
}

function renderEntryCard(entry) {
  const dt = new Date(entry.capturedAt);
  const titleText = `${entry.mealName || "Meal"} @ ${formatTime(dt)}`;

  const card = el("div", { class: "card" });
  const top = el("div", { class: "cardTop" }, [
    el("div", { class: "cardTitle", text: titleText })
  ]);

  // Add action buttons (duplicate, edit, delete)
  const actions = el("div", { class: "cardActions" });

  const dupBtn = el("button", {
    class: "cardActionBtn duplicateBtn",
    type: "button",
    "aria-label": "Duplicate",
    onClick: () => duplicateEntry(entry)
  });
  dupBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <rect x="5" y="7" width="12" height="12" rx="2"></rect>
      <rect x="9" y="3" width="12" height="12" rx="2"></rect>
    </svg>`;
  actions.appendChild(dupBtn);

  const editBtn = el("button", {
    class: "cardActionBtn editBtn",
    type: "button",
    "aria-label": "Edit",
    onClick: () => openEntryDialogForEdit(entry)
  });
  editBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 20h4l11-11c.6-.6.6-1.6 0-2.2l-1.8-1.8c-.6-.6-1.6-.6-2.2 0L4 16v4z"></path>
      <path d="M13.5 6.5l4 4"></path>
    </svg>`;
  actions.appendChild(editBtn);

  const delBtn = el("button", {
    class: "cardActionBtn deleteBtn",
    type: "button",
    "aria-label": "Delete",
    onClick: () => deleteEntry(entry.id)
  });
  delBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M6 7h12"></path>
      <path d="M9 7V5c0-.6.4-1 1-1h4c.6 0 1 .4 1 1v2"></path>
      <path d="M10 11v6"></path>
      <path d="M14 11v6"></path>
      <path d="M7 7l1 12c.1.6.6 1 1.2 1h5.6c.6 0 1.1-.4 1.2-1l1-12"></path>
    </svg>`;
  actions.appendChild(delBtn);
  top.appendChild(actions);

  const meta = el("div", { class: "meta" });

  function addRow(key, val) {
    if (val === undefined || val === null) return;
    const s = String(val).trim();
    if (!s) return;
    meta.appendChild(
      el("div", { class: "metaRow" }, [
        el("div", { class: "metaKey", text: key }),
        el("div", { class: "metaVal", text: s })
      ])
    );
  }

  addRow("Dish & Components", entry.dishComponents);
  addRow("Fullness Before", entry.fullnessBefore ? `${entry.fullnessBefore}` : "");
  addRow("Fullness After", entry.fullnessAfter ? `${entry.fullnessAfter}` : "");
  addRow("Place", entry.place);
  addRow("ED Behaviors", entry.edBehaviors);
  addRow("Feelings or Emotions", entry.feelings);
  addRow("Comments", entry.comments);

  card.appendChild(top);

  if (meta.childNodes.length) card.appendChild(meta);

  if (entry.photos && entry.photos.length) {
    const row = el("div", { class: "thumbRow" });
    for (const p of entry.photos) {
      const img = el("img", { class: "thumb" });
      img.src = p.data;
      row.appendChild(img);
    }
    card.appendChild(row);
  }

  return card;
}

async function refreshList() {
  const db = await dbPromise;
  const entries = await db.getAll(STORE);
  entries.sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt));

  els.entries.innerHTML = "";

  let groups;
  if (!entries.length) {
    // Create a virtual group for today even with no entries
    const today = new Date();
    const todayKey = today.getFullYear() + "-" + pad2(today.getMonth() + 1) + "-" + pad2(today.getDate());
    groups = [{ dayKey: todayKey, items: [] }];
    els.emptyState.style.display = "none";
  } else {
    els.emptyState.style.display = "none";
    groups = groupByDay(entries);
  }
  
  for (const g of groups) {
    const groupEl = el("div", { class: "dayGroup" });
    const isExpanded = expandedDayKey === g.dayKey;
    
    const header = el("div", { 
      class: "dayHeader" + (isExpanded ? " expanded" : ""),
      text: prettyDayHeader(g.dayKey),
      onClick: () => {
        if (expandedDayKey === g.dayKey) {
          expandedDayKey = null;
        } else {
          expandedDayKey = g.dayKey;
        }
        refreshList();
      }
    });
    groupEl.appendChild(header);
    
    const entriesContainer = el("div", { class: "dayEntries" + (isExpanded ? "" : " collapsed") });
    for (const entry of g.items) entriesContainer.appendChild(renderEntryCard(entry));
    
    // Add "No entries" text with + button when expanded and no entries
    if (isExpanded && g.items.length === 0) {
      const emptyRow = el("div", { class: "emptyEntryRow" }, [
        el("span", { text: "No entries" }),
        el("button", {
          class: "addEntryBtn",
          text: "+",
          type: "button",
          onClick: () => openEntryDialog()
        })
      ]);
      entriesContainer.appendChild(emptyRow);
    }
    
    groupEl.appendChild(entriesContainer);
    els.entries.appendChild(groupEl);
  }
}

function resetForm() {
  currentPhotoFiles = [];
  els.photos.value = "";
  els.photoPreview.innerHTML = "";

  els.mealName.value = "";
  els.dishComponents.value = "";
  els.fullnessBefore.value = "";
  els.fullnessAfter.value = "";
  els.place.value = "";
  els.edBehaviors.value = "";
  els.feelings.value = "";
  els.comments.value = "";
}

function showPhotoPreview() {
  els.photoPreview.innerHTML = "";
  currentPhotoFiles.forEach((file, idx) => {
    // Handle both File objects and stored photo objects with { data, type }
    let url;
    if (file.data) {
      // Already converted to base64
      url = file.data;
    } else {
      // File object, create temporary URL
      url = URL.createObjectURL(file);
    }
    
    const chip = document.createElement("div");
    chip.className = "photoChip";

    const img = document.createElement("img");
    img.src = url;
    if (!file.data) {
      img.onload = () => URL.revokeObjectURL(url);
    }

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      currentPhotoFiles.splice(idx, 1);
      showPhotoPreview();
    });

    chip.appendChild(img);
    chip.appendChild(remove);
    els.photoPreview.appendChild(chip);
  });
}

async function fileToBlobRecord(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve({
        data: reader.result,
        type: file.type || "image/jpeg"
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function openEntryDialog() {
  currentEditingId = null;
  resetForm();
  const now = new Date();
  els.capturedAt.value = toDatetimeLocalValue(now);
  els.capturedAtPretty.textContent = formatPretty(now);
  document.querySelector(".formTitle").textContent = "New Entry";
  els.entryDialog.classList.add("open");
  document.body.style.overflow = "hidden";
  document.body.style.overflowX = "hidden";
}

async function openEntryDialogForEdit(entry) {
  currentEditingId = entry.id;
  resetForm();
  currentPhotoFiles = entry.photos || [];
  
  // Populate form with existing data
  els.capturedAt.value = toDatetimeLocalValue(new Date(entry.capturedAt));
  els.capturedAtPretty.textContent = formatPretty(new Date(entry.capturedAt));
  els.mealName.value = entry.mealName || "";
  els.dishComponents.value = entry.dishComponents || "";
  els.fullnessBefore.value = entry.fullnessBefore || "";
  els.fullnessAfter.value = entry.fullnessAfter || "";
  els.place.value = entry.place || "";
  els.edBehaviors.value = entry.edBehaviors || "";
  els.feelings.value = entry.feelings || "";
  els.comments.value = entry.comments || "";
  
  showPhotoPreview();
  document.querySelector(".formTitle").textContent = "Edit Entry";
  els.entryDialog.classList.add("open");
  document.body.style.overflow = "hidden";
  document.body.style.overflowX = "hidden";
}

function closeEntryDialog() {
  els.entryDialog.classList.remove("open");
  document.body.style.overflow = "auto";
  document.body.style.overflowX = "auto";
}

function openExportDialog() {
  els.exportDialog.showModal();
}

function closeExportDialog() {
  els.exportDialog.close();
}

async function saveEntry() {
  const mealName = (els.mealName.value || "").trim();
  if (!mealName) {
    els.mealName.focus();
    throw new Error("Meal Name is required");
  }

  const capturedAt = fromDatetimeLocalValue(els.capturedAt.value).toISOString();

  const photos = [];
  console.log("Processing photos, count:", currentPhotoFiles.length);
  for (const f of currentPhotoFiles) {
    if (f.data) {
      // Existing photo from database (already base64)
      console.log("Adding existing photo");
      photos.push(f);
    } else {
      // New file upload
      console.log("Converting new file:", f.name, f.size, f.type);
      photos.push(await fileToBlobRecord(f));
    }
  }
  console.log("Photos processed:", photos.length);

  const entry = {
    capturedAt,
    mealName,
    dishComponents: (els.dishComponents.value || "").trim(),
    fullnessBefore: els.fullnessBefore.value ? Number(els.fullnessBefore.value) : null,
    fullnessAfter: els.fullnessAfter.value ? Number(els.fullnessAfter.value) : null,
    place: (els.place.value || "").trim(),
    edBehaviors: (els.edBehaviors.value || "").trim(),
    feelings: (els.feelings.value || "").trim(),
    comments: (els.comments.value || "").trim(),
    photos
  };

  const db = await dbPromise;
  if (currentEditingId) {
    // Update existing entry
    entry.id = currentEditingId;
    await db.put(STORE, entry);
  } else {
    // Create new entry
    await db.add(STORE, entry);
  }

  await pruneOldEntries();
}

async function deleteEntry(id) {
  if (!confirm("Are you sure you want to delete this entry? This cannot be undone.")) {
    return;
  }
  
  const db = await dbPromise;
  await db.delete(STORE, id);
  await refreshList();
  setStatus("Entry deleted");
}

async function duplicateEntry(entry) {
  const db = await dbPromise;
  const copy = { ...entry };
  delete copy.id;
  // Stamp with current time to surface new duplicate at top
  copy.capturedAt = new Date().toISOString();
  await db.add(STORE, copy);
  await refreshList();
  setStatus("Entry duplicated");
}

function wrapText(doc, text, maxWidth) {
  const safe = text ? String(text) : "";
  return doc.splitTextToSize(safe, maxWidth);
}

async function blobToJpegDataUrl(blob, maxW = 1200) {
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = URL.createObjectURL(blob);
  });

  const scale = Math.min(1, maxW / img.width);
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);

  URL.revokeObjectURL(img.src);

  return canvas.toDataURL("image/jpeg", 0.72);
}

async function exportPdf(days) {
  setStatus("Building PDF");
  const db = await dbPromise;
  const all = await db.getAll(STORE);

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const entries = all
    .filter(e => new Date(e.capturedAt).getTime() >= cutoff)
    // Newest to oldest so recent days are first
    .sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt));

  if (!entries.length) {
    setStatus("No entries in that range");
    return;
  }

  const doc = new jsPDF({ unit: "mm", format: "letter" });

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 8;
  const contentW = pageW - margin * 2;

  let y = margin;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Food Diary Export", margin, y);
  y += 7;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const today = new Date();
  doc.text(`Generated: ${formatPretty(today)}`, margin, y);
  y += 6;

  doc.setDrawColor(80);
  doc.line(margin, y, pageW - margin, y);
  y += 6;

  // Group by day (newest day first)
  const dayMap = new Map();
  for (const e of entries) {
    const dt = new Date(e.capturedAt);
    const key = dt.getFullYear() + "-" + pad2(dt.getMonth() + 1) + "-" + pad2(dt.getDate());
    if (!dayMap.has(key)) dayMap.set(key, []);
    dayMap.get(key).push(e);
  }
  const dayKeys = Array.from(dayMap.keys()).sort((a, b) => (a < b ? 1 : -1));

  const formatDayShort = (dayKey) => {
    const [y, m, d] = dayKey.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    const weekdays = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${weekdays[dt.getDay()]} ${months[dt.getMonth()]} ${d}`;
  };

  for (const dayKey of dayKeys) {
    const dayEntries = dayMap.get(dayKey);

    // Day header
    if (y > pageH - margin - 10) {
      doc.addPage();
      y = margin;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(formatDayShort(dayKey), margin, y);
    y += 4;

    for (const e of dayEntries) {
      const dt = new Date(e.capturedAt);
      const entryHeader = `${e.mealName || "Meal"} @ ${formatTime(dt)}`;

      const entryIndent = 6;
      const entryX = margin + entryIndent;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);

      if (y > pageH - margin - 10) {
        doc.addPage();
        y = margin;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.text(formatDayShort(dayKey), margin, y);
        y += 5;
      }
      doc.text(entryHeader, entryX, y);
      y += 4;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);

      const rows = [
        ["Dish & Components", e.dishComponents],
        ["Place", e.place],
        ["Eating Disorder Behaviors", e.edBehaviors],
        ["Feelings or Emotions", e.feelings],
        ["Comments", e.comments]
      ].filter(r => String(r[1] || "").trim().length);

      // Layout: left column for details, right columns for photos horizontally
      const leftColW = 70;
      const leftColX = entryX;
      const rightColX = entryX + leftColW + 3;
      const rightColW = pageW - rightColX - margin;
      
      let detailsY = y;
      let maxY = y;

      // Render details on the left - field name on one line, value on next
      for (const [k, v] of rows) {
        const lines = wrapText(doc, v, leftColW);
        const rowH = 4 + Math.max(3, lines.length * 3);

        if (detailsY + rowH > pageH - margin - 6) {
          doc.addPage();
          detailsY = margin;
          maxY = margin;
          // Re-print day + entry header after page break
          doc.setFont("helvetica", "bold");
          doc.setFontSize(12);
          doc.text(formatDayShort(dayKey), margin, detailsY);
          detailsY += 5;
          doc.setFontSize(11);
          doc.text(entryHeader, entryX, detailsY);
          detailsY += 5;
          doc.setFont("helvetica", "normal");
          doc.setFontSize(10);
        }

        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.text(k + ":", leftColX, detailsY);
        detailsY += 3;
        
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.text(lines, leftColX, detailsY);
        detailsY += Math.max(3, lines.length * 3);
        maxY = Math.max(maxY, detailsY);
      }

      // Add fullness scales side by side
      const fullnessRows = [];
      if (e.fullnessBefore) fullnessRows.push(["Fullness Before", String(e.fullnessBefore)]);
      if (e.fullnessAfter) fullnessRows.push(["Fullness After", String(e.fullnessAfter)]);
      
      if (fullnessRows.length > 0) {
        const colW = leftColW / 2;
        let fullX = leftColX;
        const fullY = detailsY;
        
        for (const [k, v] of fullnessRows) {
          doc.setFont("helvetica", "bold");
          doc.setFontSize(8);
          doc.text(k + ":", fullX, fullY);
          
          doc.setFont("helvetica", "normal");
          doc.setFontSize(8);
          doc.text(v, fullX, fullY + 3);
          
          fullX += colW;
        }
        
        detailsY += 9;
        maxY = Math.max(maxY, detailsY);
      }

      // Render photos on the right, arranged horizontally
      if (e.photos && e.photos.length) {
        const photosStartY = y;
        const maxPhotoH = 35;
        const photoGap = 2;
        const totalGapWidth = (e.photos.length - 1) * photoGap;
        const availableWidth = rightColW - totalGapWidth;
        let photoX = rightColX;
        
        for (const p of e.photos) {
          const dataUrl = p.data;
          const imgProps = doc.getImageProperties(dataUrl);

          // Calculate width per photo to fit all in one line
          const widthPerPhoto = availableWidth / e.photos.length;
          const ratio = Math.min(widthPerPhoto / imgProps.width, maxPhotoH / imgProps.height);

          const iw = imgProps.width * ratio;
          const ih = imgProps.height * ratio;

          doc.addImage(dataUrl, "JPEG", photoX, photosStartY, iw, ih);
          photoX += iw + photoGap;
          maxY = Math.max(maxY, photosStartY + ih);
        }
      }

      y = maxY + 3;
      if (y > pageH - margin - 10) {
        doc.addPage();
        y = margin;
      }
    }

    // Separator between days (not between entries)
    const isLastDay = dayKey === dayKeys[dayKeys.length - 1];
    if (!isLastDay) {
      if (y > pageH - margin - 6) {
        doc.addPage();
        y = margin;
      }
      doc.setDrawColor(60);
      doc.line(margin, y, pageW - margin, y);
      y += 4;
    }
  }
  doc.save(`food-diary-${days}-days.pdf`);
  setStatus("PDF saved");
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

function wireEvents() {
  els.openNewEntry.addEventListener("click", () => openEntryDialog());
  els.closeDialog.addEventListener("click", () => closeEntryDialog());
  els.cancel.addEventListener("click", () => closeEntryDialog());

  els.capturedAt.addEventListener("input", () => {
    try {
      const dt = fromDatetimeLocalValue(els.capturedAt.value);
      els.capturedAtPretty.textContent = formatPretty(dt);
    } catch {
      els.capturedAtPretty.textContent = "";
    }
  });

  els.photos.addEventListener("change", () => {
    const files = Array.from(els.photos.files || []);
    const MAX_PHOTOS = 3;
    const remainingSlots = MAX_PHOTOS - currentPhotoFiles.length;
    
    if (remainingSlots <= 0) {
      setStatus(`Maximum of ${MAX_PHOTOS} photos per entry`);
      els.photos.value = "";
      return;
    }
    
    const filesToAdd = files.slice(0, remainingSlots);
    if (files.length > remainingSlots) {
      setStatus(`Only ${remainingSlots} photo(s) can be added. Max is ${MAX_PHOTOS} per entry.`);
    }
    
    // Append to allow multiple selections in separate picks
    currentPhotoFiles = currentPhotoFiles.concat(filesToAdd);
    showPhotoPreview();
    els.photos.value = "";
  });

  els.entryForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    setStatus("");
    try {
      console.log("Starting save, photo count:", currentPhotoFiles.length);
      await saveEntry();
      closeEntryDialog();
      await refreshList();
      setStatus(currentEditingId ? "Entry updated" : "Saved");
    } catch (err) {
      console.error("Save error:", err);
      setStatus(err && err.message ? err.message : "Could not save");
    }
  });

  els.exportPdf.addEventListener("click", () => openExportDialog());
  els.closeExport.addEventListener("click", () => closeExportDialog());
  els.exportCancel.addEventListener("click", () => closeExportDialog());

  els.exportForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const days = Number(els.range.value);
    closeExportDialog();
    try {
      await exportPdf(days);
    } catch {
      setStatus("Could not export PDF");
    }
  });
}

async function main() {
  await initDb();
  wireEvents();
  registerServiceWorker();
  await refreshList();
  setStatus("");
}

main();
