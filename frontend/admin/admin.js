const API_BASE = "/api";

const SPACE_LABELS = {
  desk: "Рабочий стол",
  meeting_room: "Переговорная",
  call_room: "Call-room",
  open_space: "Open Space",
  lounge: "Лаунж",
};

const SPACE_COLORS = {
  desk:         "#2563eb",
  meeting_room: "#7c3aed",
  call_room:    "#0891b2",
  open_space:   "#16a34a",
  lounge:       "#d97706",
};

// ── DOM refs ──────────────────────────────────────────────────────────────────
const loginOverlay     = document.getElementById("login-overlay");
const loginError       = document.getElementById("login-error");
const adminApp         = document.getElementById("admin-app");
const sidebarUsername  = document.getElementById("sidebar-username");
const logoutBtn        = document.getElementById("logout-btn");

// Tables
const officesBody      = document.getElementById("offices-body");
const floorsBody       = document.getElementById("floors-body");
const desksBody        = document.getElementById("desks-body");
const policiesBody     = document.getElementById("policies-body");
const reservationsBody = document.getElementById("reservations-body");

// Office form
const officeName    = document.getElementById("office-name");
const officeAddress = document.getElementById("office-address");

// Floor form
const floorOfficeSelect = document.getElementById("floor-office-select");
const floorName         = document.getElementById("floor-name");
const planFloorSelect   = document.getElementById("plan-floor-select");
const planFile          = document.getElementById("plan-file");

// Policy form
const policyOfficeSelect = document.getElementById("policy-office-select");
const policyName         = document.getElementById("policy-name");
const policyMinDays      = document.getElementById("policy-min-days");
const policyMaxDays      = document.getElementById("policy-max-days");
const policyMinDur       = document.getElementById("policy-min-dur");
const policyMaxDur       = document.getElementById("policy-max-dur");
const policyNoshow       = document.getElementById("policy-noshow");

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  offices: [],
  floors: [],
  desks: [],
  policies: [],
  reservations: [],
};

// ── Auth ──────────────────────────────────────────────────────────────────────
function getToken() {
  return localStorage.getItem("admin_token");
}

function setToken(token, username) {
  localStorage.setItem("admin_token", token);
  localStorage.setItem("admin_username", username);
  showAdminUI(username);
}

function clearToken() {
  localStorage.removeItem("admin_token");
  localStorage.removeItem("admin_username");
  showLoginOverlay();
}

function showAdminUI(username) {
  loginOverlay.classList.add("hidden");
  adminApp.classList.remove("hidden");
  sidebarUsername.textContent = username;
  if (window.lucide) lucide.createIcons();
}

function showLoginOverlay() {
  loginOverlay.classList.remove("hidden");
  adminApp.classList.add("hidden");
}

// ── Toast notifications ───────────────────────────────────────────────────────
function showToast(text, type) {
  type = type || "info";
  var container = document.getElementById("admin-toast");
  if (!container) return;
  var item = document.createElement("div");
  item.className = "admin-toast-item " + type;
  item.textContent = text;
  container.prepend(item);
  requestAnimationFrame(function () { item.classList.add("visible"); });
  var duration = type === "error" ? 7000 : 3500;
  setTimeout(function () {
    item.classList.remove("visible");
    setTimeout(function () { item.remove(); }, 300);
  }, duration);
}

// Backwards compat alias
function addMessage(text, type) { showToast(text, type); }

function authHeader() {
  var token = getToken();
  return token ? { Authorization: "Bearer " + token } : {};
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function apiRequest(path, options) {
  options = options || {};
  const token = getToken();
  const headers = Object.assign(
    { "Content-Type": "application/json" },
    token ? { Authorization: "Bearer " + token } : {},
    options.headers || {}
  );
  const response = await fetch(API_BASE + path, Object.assign({}, options, { headers: headers }));
  if (!response.ok) {
    const body = await response.json().catch(function () { return {}; });
    throw new Error(body.detail || ("Ошибка " + response.status));
  }
  if (response.status === 204) return null;
  return response.json();
}

function makeDeleteBtn(label, onClick) {
  const btn = document.createElement("button");
  btn.className = "btn btn-danger btn-sm";
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  return btn;
}

function makeCancelBtn(reservationId) {
  return makeDeleteBtn("Отменить", async function () {
    if (!confirm("Отменить это бронирование?")) return;
    try {
      await apiRequest("/reservations/" + reservationId + "/cancel", { method: "POST" });
      showToast("Бронирование отменено.", "success");
      await loadReservations();
    } catch (e) {
      showToast("Ошибка: " + e.message, "error");
    }
  });
}

// ── API calls ─────────────────────────────────────────────────────────────────
async function checkApi() {
  try {
    await apiRequest("/health");
  } catch {
    showToast("API недоступно. Убедитесь, что backend запущен.", "error");
  }
}

async function loadOffices() {
  try {
    state.offices = await apiRequest("/offices");
    renderOfficesTable();
    populateOfficeSelects();
  } catch (e) {
    showToast("Не удалось загрузить офисы: " + e.message, "error");
  }
}

async function loadFloors() {
  try {
    state.floors = await apiRequest("/floors");
    renderFloorsTable();
    populateFloorSelects();
  } catch (e) {
    showToast("Не удалось загрузить этажи: " + e.message, "error");
  }
}

async function loadDesks() {
  try {
    state.desks = await apiRequest("/desks");
    renderDesksTable();
  } catch (e) {
    showToast("Не удалось загрузить рабочие места: " + e.message, "error");
  }
}

async function loadPolicies() {
  try {
    state.policies = await apiRequest("/policies");
    renderPoliciesTable();
  } catch (e) {
    showToast("Не удалось загрузить политики: " + e.message, "error");
  }
}

async function loadReservations() {
  try {
    const officeId = document.getElementById("filter-office").value;
    const dateFrom = document.getElementById("filter-date-from").value;
    const dateTo   = document.getElementById("filter-date-to").value;
    const userId   = document.getElementById("filter-user").value.trim();
    const status   = document.getElementById("filter-status").value;

    const qs = new URLSearchParams();
    if (officeId) qs.set("office_id", officeId);
    if (dateFrom) qs.set("date_from", dateFrom);
    if (dateTo)   qs.set("date_to", dateTo);
    if (userId)   qs.set("user_id", userId);
    if (status)   qs.set("status", status);

    const query = qs.toString();
    state.reservations = await apiRequest("/reservations" + (query ? "?" + query : ""));
    renderReservationsTable();
  } catch (e) {
    showToast("Не удалось загрузить бронирования: " + e.message, "error");
  }
}

async function loadAnalytics() {
  try {
    const data = await apiRequest("/analytics");

    document.getElementById("kpi-today").textContent     = data.total_today;
    document.getElementById("kpi-active").textContent    = data.total_active;
    document.getElementById("kpi-cancelled").textContent = data.total_cancelled;
    document.getElementById("kpi-noshow").textContent    = data.noshow_rate + "%";

    const occupancyEl = document.getElementById("occupancy-list");
    occupancyEl.innerHTML = "";
    if (!data.occupancy_by_office || !data.occupancy_by_office.length) {
      occupancyEl.innerHTML = '<p class="empty">Нет данных</p>';
    } else {
      data.occupancy_by_office.forEach(function (o) {
        const row = document.createElement("div");
        row.style.cssText = "margin-bottom:12px";
        row.innerHTML = (
          '<div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:13px">' +
            '<span style="font-weight:500">' + o.office_name + '</span>' +
            '<span style="color:var(--text-2)">' + o.booked_today + ' / ' + o.total_desks + ' мест (' + o.occupancy_pct + '%)</span>' +
          '</div>' +
          '<div style="background:var(--border);border-radius:4px;height:8px;overflow:hidden">' +
            '<div style="height:100%;background:var(--accent);border-radius:4px;width:' + o.occupancy_pct + '%;transition:width .4s"></div>' +
          '</div>'
        );
        occupancyEl.append(row);
      });
    }

    const topDesksBody = document.getElementById("top-desks-body");
    topDesksBody.innerHTML = (data.top_desks && data.top_desks.length)
      ? data.top_desks.map(function (d) {
          return "<tr><td>" + d.label + "</td><td>" + d.floor_name + "</td><td>" + d.office_name + "</td><td><strong>" + d.total + "</strong></td></tr>";
        }).join("")
      : '<tr><td colspan="4" class="empty">Нет данных</td></tr>';

    const topUsersBody = document.getElementById("top-users-body");
    topUsersBody.innerHTML = (data.top_users && data.top_users.length)
      ? data.top_users.map(function (u) {
          return "<tr><td>" + u.user_id + "</td><td><strong>" + u.total + "</strong></td></tr>";
        }).join("")
      : '<tr><td colspan="2" class="empty">Нет данных</td></tr>';

  } catch (e) {
    showToast("Аналитика: " + e.message, "error");
  }
}

async function loadAll() {
  await loadOffices();
  await Promise.all([loadFloors(), loadPolicies(), loadReservations(), loadDepartments()]);
  await loadDesks();
  await loadAnalytics();
}

// ── Render helpers ────────────────────────────────────────────────────────────
function getOfficeName(officeId) {
  var o = state.offices.find(function (o) { return o.id === officeId; });
  return o ? o.name : String(officeId);
}

function getFloorName(floorId) {
  var f = state.floors.find(function (f) { return f.id === floorId; });
  return f ? f.name + " (" + getOfficeName(f.office_id) + ")" : String(floorId);
}

// ── Render tables ─────────────────────────────────────────────────────────────
function renderOfficesTable() {
  officesBody.innerHTML = "";
  if (!state.offices.length) {
    officesBody.innerHTML = '<tr><td colspan="4" class="empty">Нет офисов.</td></tr>';
    return;
  }
  state.offices.forEach(function (o) {
    var tr = document.createElement("tr");
    tr.innerHTML = "<td>" + o.id + "</td><td>" + o.name + "</td><td>" + (o.address || "—") + "</td><td></td>";
    tr.querySelector("td:last-child").append(
      makeDeleteBtn("Удалить", async function () {
        if (!confirm("Удалить офис «" + o.name + "»?")) return;
        try {
          await apiRequest("/offices/" + o.id, { method: "DELETE" });
          showToast("Офис «" + o.name + "» удалён.", "success");
          await loadAll();
        } catch (e) {
          showToast("Ошибка: " + e.message, "error");
        }
      })
    );
    officesBody.append(tr);
  });
}

function renderFloorsTable() {
  floorsBody.innerHTML = "";
  if (!state.floors.length) {
    floorsBody.innerHTML = '<tr><td colspan="5" class="empty">Нет этажей.</td></tr>';
    return;
  }
  state.floors.forEach(function (f) {
    var tr = document.createElement("tr");
    var planCell = f.plan_url
      ? '<a href="' + f.plan_url + '" target="_blank" rel="noopener">Посмотреть</a>'
      : "Нет";
    tr.innerHTML = "<td>" + f.id + "</td><td>" + getOfficeName(f.office_id) + "</td><td>" + f.name + "</td><td>" + planCell + "</td><td></td>";
    tr.querySelector("td:last-child").append(
      makeDeleteBtn("Удалить", async function () {
        if (!confirm("Удалить этаж «" + f.name + "»?")) return;
        try {
          await apiRequest("/floors/" + f.id, { method: "DELETE" });
          showToast("Этаж «" + f.name + "» удалён.", "success");
          await loadAll();
        } catch (e) {
          showToast("Ошибка: " + e.message, "error");
        }
      })
    );
    floorsBody.append(tr);
  });
}

function renderDesksTable() {
  if (!desksBody) return;
  desksBody.innerHTML = "";
  if (!state.desks.length) {
    desksBody.innerHTML = '<tr><td colspan="7" class="empty">Нет рабочих мест.</td></tr>';
    return;
  }
  state.desks.forEach(function (d) {
    var tr = document.createElement("tr");
    tr.innerHTML = (
      "<td>" + d.id + "</td>" +
      "<td>" + getFloorName(d.floor_id) + "</td>" +
      "<td>" + d.label + "</td>" +
      "<td>" + (d.type === "fixed" ? "Закреплённое" : "Гибкое") + "</td>" +
      "<td>" + (SPACE_LABELS[d.space_type] || d.space_type || "—") + "</td>" +
      "<td>" + (d.assigned_to || "—") + "</td>" +
      "<td></td>"
    );
    var actionCell = tr.querySelector("td:last-child");
    var btnRow = document.createElement("div");
    btnRow.className = "btn-row";

    var qrBtn = document.createElement("button");
    qrBtn.className = "btn btn-secondary btn-sm";
    qrBtn.textContent = "QR";
    qrBtn.title = "Показать QR-код для места «" + d.label + "»";
    qrBtn.addEventListener("click", async function () {
      var token = getToken();
      try {
        var resp = await fetch(API_BASE + "/desks/" + d.id + "/qr", {
          headers: token ? { Authorization: "Bearer " + token } : {},
        });
        if (!resp.ok) {
          var body = await resp.json().catch(function () { return {}; });
          showToast("Не удалось получить QR: " + (body.detail || resp.status), "error");
          return;
        }
        var blob = await resp.blob();
        window.open(URL.createObjectURL(blob), "_blank", "noopener");
      } catch (e) {
        showToast("Ошибка при загрузке QR: " + e.message, "error");
      }
    });

    var deleteBtn = makeDeleteBtn("Удалить", async function () {
      if (!confirm("Удалить место «" + d.label + "»?")) return;
      try {
        await apiRequest("/desks/" + d.id, { method: "DELETE" });
        showToast("Место «" + d.label + "» удалено.", "success");
        await loadDesks();
      } catch (e) {
        showToast("Ошибка: " + e.message, "error");
      }
    });

    btnRow.append(qrBtn, deleteBtn);
    actionCell.append(btnRow);
    desksBody.append(tr);
  });
}

function renderPoliciesTable() {
  policiesBody.innerHTML = "";
  if (!state.policies.length) {
    policiesBody.innerHTML = '<tr><td colspan="7" class="empty">Нет политик.</td></tr>';
    return;
  }
  state.policies.forEach(function (p) {
    var tr = document.createElement("tr");
    tr.innerHTML = (
      "<td>" + p.id + "</td>" +
      "<td>" + getOfficeName(p.office_id) + "</td>" +
      "<td>" + p.name + "</td>" +
      "<td>" + p.min_days_ahead + "–" + p.max_days_ahead + "</td>" +
      "<td>" + p.min_duration_minutes + "–" + p.max_duration_minutes + "</td>" +
      "<td>" + p.no_show_timeout_minutes + "</td>" +
      "<td></td>"
    );
    tr.querySelector("td:last-child").append(
      makeDeleteBtn("Удалить", async function () {
        if (!confirm("Удалить политику «" + p.name + "»?")) return;
        try {
          await apiRequest("/policies/" + p.id, { method: "DELETE" });
          showToast("Политика «" + p.name + "» удалена.", "success");
          await loadPolicies();
        } catch (e) {
          showToast("Ошибка: " + e.message, "error");
        }
      })
    );
    policiesBody.append(tr);
  });
}

function renderReservationsTable() {
  reservationsBody.innerHTML = "";
  if (!state.reservations.length) {
    reservationsBody.innerHTML = '<tr><td colspan="9" class="empty">Нет бронирований.</td></tr>';
    return;
  }
  state.reservations.forEach(function (r) {
    var tr = document.createElement("tr");
    var checkinText = r.checked_in_at ? r.checked_in_at.slice(11, 16) : "—";
    var statusClass = r.status === "active" ? "active" : "cancelled";
    var statusText  = r.status === "active" ? "Активно" : "Отменено";
    tr.innerHTML = (
      "<td>" + r.id + "</td>" +
      "<td>" + r.desk_id + "</td>" +
      "<td>" + r.user_id + "</td>" +
      "<td>" + r.reservation_date + "</td>" +
      "<td>" + (r.start_time ? r.start_time.slice(0, 5) : "—") + "</td>" +
      "<td>" + (r.end_time ? r.end_time.slice(0, 5) : "—") + "</td>" +
      "<td>" + checkinText + "</td>" +
      "<td><span class=\"badge " + statusClass + "\">" + statusText + "</span></td>" +
      "<td></td>"
    );
    if (r.status === "active") {
      tr.querySelector("td:last-child").append(makeCancelBtn(r.id));
    }
    reservationsBody.append(tr);
  });
}

// ── Populate selects ──────────────────────────────────────────────────────────
function populateOfficeSelects() {
  [floorOfficeSelect, policyOfficeSelect, document.getElementById("filter-office")].forEach(function (sel) {
    if (!sel) return;
    var val = sel.value;
    var placeholder = sel === document.getElementById("filter-office") ? "Все офисы" : "Выберите офис";
    sel.innerHTML = '<option value="">' + placeholder + '</option>';
    state.offices.forEach(function (o) {
      var opt = document.createElement("option");
      opt.value = o.id;
      opt.textContent = o.name;
      sel.append(opt);
    });
    if (val) sel.value = val;
  });
}

function populateFloorSelects() {
  [planFloorSelect, document.getElementById("placement-floor-select")].forEach(function (sel) {
    if (!sel) return;
    var val = sel.value;
    sel.innerHTML = '<option value="">Выберите этаж</option>';
    state.floors.forEach(function (f) {
      var opt = document.createElement("option");
      opt.value = f.id;
      opt.textContent = f.name + " (" + getOfficeName(f.office_id) + ")";
      sel.append(opt);
    });
    if (val) sel.value = val;
  });
}

// ── SVG Map Editor ────────────────────────────────────────────────────────────

function escHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

var mapState = {
  floorId:  null,
  status:   null,      // "draft" | "published" | null
  version:  0,
  planSvg:  null,
  desks:    [],        // [{id, label, type, space_type, assigned_to, x, y, w, h}]
  zones:    [],        // [{id, name, space_type, color, points:[{x,y}...]}]
  viewBox:  { x:0, y:0, w:1000, h:1000 }
};

var editorState = {
  selectedType:  null,   // "desk" | "zone"
  selectedIdx:   null,
  placementMode: "select", // "select" | "desk" | "draw-zone"
  drawingZone:   null,   // null | {points:[{x,y}...]}
  isPanning:     false,
  panStart:      null    // {svgX, svgY, vxStart, vyStart}
};

// SVG default desk dimensions (in viewBox units)
var DESK_DEFAULT_W = 30;
var DESK_DEFAULT_H = 20;

function parseViewBox(svgStr) {
  if (!svgStr) return { x:0, y:0, w:1000, h:1000 };
  try {
    var match = svgStr.match(/viewBox\s*=\s*["']([^"']+)["']/);
    if (!match) return { x:0, y:0, w:1000, h:1000 };
    var parts = match[1].trim().split(/[\s,]+/).map(Number);
    if (parts.length < 4) return { x:0, y:0, w:1000, h:1000 };
    return { x:parts[0], y:parts[1], w:parts[2], h:parts[3] };
  } catch { return { x:0, y:0, w:1000, h:1000 }; }
}

function setViewBox(x, y, w, h) {
  mapState.viewBox = { x:x, y:y, w:w, h:h };
  var svg = document.getElementById("placement-svg");
  if (svg) svg.setAttribute("viewBox", x + " " + y + " " + w + " " + h);
}

function svgCoordsFromClient(e) {
  var wrap = document.getElementById("placement-canvas-wrap");
  if (!wrap) return { x:0, y:0 };
  var rect = wrap.getBoundingClientRect();
  var px = (e.clientX - rect.left) / rect.width;
  var py = (e.clientY - rect.top) / rect.height;
  var vb = mapState.viewBox;
  return { x: vb.x + px * vb.w, y: vb.y + py * vb.h };
}

function updateStatusBadge() {
  var badge = document.getElementById("map-status-badge");
  var hint  = document.getElementById("placement-hint");
  if (!badge) return;
  var s = mapState.status;
  if (s === "draft") {
    badge.textContent = "ЧЕРНОВИК";
    badge.style.background = "#fef9c3";
    badge.style.color       = "#854d0e";
    if (hint) hint.textContent = "Черновик не виден клиентам. Нажмите «Опубликовать» чтобы применить.";
  } else if (s === "published") {
    badge.textContent = "ОПУБЛИКОВАНО";
    badge.style.background = "#dcfce7";
    badge.style.color       = "#166534";
    if (hint) hint.textContent = "Карта опубликована. Создайте черновик для редактирования.";
  } else {
    badge.textContent = "НЕТ КАРТЫ";
    badge.style.background = "var(--border)";
    badge.style.color       = "var(--text-2)";
    if (hint) hint.textContent = "Загрузите SVG план этажа чтобы начать.";
  }
}

async function loadFloorMap(floorId) {
  var area   = document.getElementById("placement-area");
  var noSvg  = document.getElementById("placement-no-svg");

  mapState = { floorId:floorId, status:null, version:0, planSvg:null, desks:[], zones:[], viewBox:{x:0,y:0,w:1000,h:1000} };
  editorState.selectedType = null;
  editorState.selectedIdx  = null;
  editorState.drawingZone  = null;

  updateStatusBadge();
  if (!floorId) { if (area) area.style.display = "none"; return; }

  try {
    var resp = await fetch(API_BASE + "/floors/" + floorId + "/map", { headers: authHeader() });
    if (resp.status === 404) {
      if (area) area.style.display = "";
      if (noSvg) noSvg.classList.remove("hidden");
      updateStatusBadge();
      renderZones(); renderMarkers(); renderLists();
      return;
    }
    var data = await resp.json();
    if (!resp.ok) { showToast("Ошибка загрузки карты: " + (data.detail || resp.status), "error"); return; }

    mapState.status  = data.status;
    mapState.version = data.version;
    mapState.planSvg = data.plan_svg;
    mapState.desks   = data.desks  || [];
    mapState.zones   = data.zones  || [];
    mapState.viewBox = parseViewBox(data.plan_svg);

    updateStatusBadge();
    if (area) area.style.display = "";

    if (data.plan_svg) {
      if (noSvg) noSvg.classList.add("hidden");
      renderFloorPlan(data.plan_svg);
    } else {
      if (noSvg) noSvg.classList.remove("hidden");
      setViewBox(0, 0, 1000, 1000);
    }
    renderZones(); renderMarkers(); renderLists();
    showPropsPanel(null, null);
  } catch (e) {
    showToast("Ошибка: " + e.message, "error");
  }
}

function renderFloorPlan(svgContent) {
  var parser = new DOMParser();
  var doc = parser.parseFromString(svgContent, "image/svg+xml");
  var importedRoot = doc.documentElement;
  var vb = importedRoot.getAttribute("viewBox") || "0 0 1000 1000";
  var parts = vb.trim().split(/[\s,]+/).map(Number);
  if (parts.length >= 4) setViewBox(parts[0], parts[1], parts[2], parts[3]);

  var layer = document.getElementById("floorplan-layer");
  if (!layer) return;
  layer.innerHTML = "";

  // Copy all child nodes of the parsed SVG into the floorplan layer
  Array.from(importedRoot.childNodes).forEach(function(node) {
    try {
      var imported = document.importNode(node, true);
      layer.appendChild(imported);
    } catch(e) {}
  });
  // Make floor plan non-interactive
  layer.setAttribute("pointer-events", "none");
}

function renderZones() {
  var ns    = "http://www.w3.org/2000/svg";
  var layer = document.getElementById("zones-layer");
  if (!layer) return;
  layer.innerHTML = "";

  mapState.zones.forEach(function(zone, i) {
    if (!zone.points || zone.points.length < 3) return;
    var isSel = editorState.selectedType === "zone" && editorState.selectedIdx === i;
    var color = zone.color || SPACE_COLORS[zone.space_type] || "#16a34a";

    var pts = zone.points.map(function(p) { return p.x + "," + p.y; }).join(" ");
    var poly = document.createElementNS(ns, "polygon");
    poly.setAttribute("points", pts);
    poly.setAttribute("fill", color);
    poly.setAttribute("fill-opacity", "0.25");
    poly.setAttribute("stroke", color);
    poly.setAttribute("stroke-width", isSel ? "3" : "1.5");
    if (isSel) poly.setAttribute("stroke-dasharray", "6 3");
    poly.setAttribute("cursor", "pointer");

    poly.addEventListener("pointerdown", function(e) {
      e.stopPropagation();
      selectItem("zone", i);
    });
    layer.appendChild(poly);

    // Label at centroid
    var cx = zone.points.reduce(function(s,p){return s+p.x;},0) / zone.points.length;
    var cy = zone.points.reduce(function(s,p){return s+p.y;},0) / zone.points.length;
    var txt = document.createElementNS(ns, "text");
    txt.setAttribute("x", String(cx));
    txt.setAttribute("y", String(cy));
    txt.setAttribute("text-anchor", "middle");
    txt.setAttribute("dominant-baseline", "middle");
    txt.setAttribute("fill", color);
    txt.setAttribute("font-size", String(Math.max(8, mapState.viewBox.w * 0.012)));
    txt.setAttribute("pointer-events", "none");
    txt.textContent = zone.name;
    layer.appendChild(txt);
  });
}

function renderMarkers() {
  var ns    = "http://www.w3.org/2000/svg";
  var layer = document.getElementById("markers-layer");
  if (!layer) return;
  layer.innerHTML = "";

  var r = Math.max(4, mapState.viewBox.w * 0.008);

  mapState.desks.forEach(function(desk, i) {
    if (desk.x == null) return;
    var isSel = editorState.selectedType === "desk" && editorState.selectedIdx === i;
    var cx = desk.x + (desk.w || DESK_DEFAULT_W) / 2;
    var cy = desk.y + (desk.h || DESK_DEFAULT_H) / 2;
    var color = SPACE_COLORS[desk.space_type] || "#2563eb";

    var g = document.createElementNS(ns, "g");
    g.setAttribute("cursor", "pointer");

    if (isSel) {
      var ring = document.createElementNS(ns, "circle");
      ring.setAttribute("cx", String(cx)); ring.setAttribute("cy", String(cy));
      ring.setAttribute("r", String(r + 6));
      ring.setAttribute("fill", "none");
      ring.setAttribute("stroke", "#3b82f6");
      ring.setAttribute("stroke-width", "2.5");
      ring.setAttribute("stroke-dasharray", "5 3");
      ring.setAttribute("pointer-events", "none");
      g.appendChild(ring);
    }

    var dot = document.createElementNS(ns, "circle");
    dot.setAttribute("cx", String(cx)); dot.setAttribute("cy", String(cy));
    dot.setAttribute("r", String(r));
    dot.setAttribute("fill", color);
    dot.setAttribute("stroke", "white");
    dot.setAttribute("stroke-width", "2.5");
    g.appendChild(dot);

    // Drag support
    var _moved = false, _startSvg = null;
    g.addEventListener("pointerdown", function(e) {
      e.stopPropagation();
      _moved = false;
      _startSvg = svgCoordsFromClient(e);
      g.setPointerCapture(e.pointerId);
    });
    g.addEventListener("pointermove", function(e) {
      if (!g.hasPointerCapture(e.pointerId)) return;
      _moved = true;
      var cur = svgCoordsFromClient(e);
      var dx = cur.x - _startSvg.x, dy = cur.y - _startSvg.y;
      _startSvg = cur;
      mapState.desks[i].x = (mapState.desks[i].x || 0) + dx;
      mapState.desks[i].y = (mapState.desks[i].y || 0) + dy;
      renderMarkers();
    });
    g.addEventListener("pointerup", function(e) {
      if (!g.hasPointerCapture(e.pointerId)) return;
      if (!_moved) selectItem("desk", i);
      else { editorState.selectedType = "desk"; editorState.selectedIdx = i; renderMarkers(); }
    });

    layer.appendChild(g);
  });
}

function renderLists() {
  var deskList = document.getElementById("desk-list-editor");
  var zoneList = document.getElementById("zone-list-editor");
  if (deskList) {
    deskList.innerHTML = "";
    mapState.desks.forEach(function(d, i) {
      var row = document.createElement("div");
      row.className = "desk-row" + (editorState.selectedType === "desk" && editorState.selectedIdx === i ? " selected" : "");
      row.style.cssText = "display:flex;gap:6px;align-items:center;padding:4px 6px;border-radius:4px;cursor:pointer;border:1px solid var(--border)";
      var dot = document.createElement("span");
      dot.style.cssText = "width:8px;height:8px;border-radius:50%;flex-shrink:0;background:" + (SPACE_COLORS[d.space_type] || "#2563eb");
      var lbl = document.createElement("span");
      lbl.style.cssText = "flex:1;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
      lbl.textContent = d.label || "—";
      row.appendChild(dot); row.appendChild(lbl);
      row.addEventListener("click", function() { selectItem("desk", i); });
      deskList.appendChild(row);
    });
  }
  if (zoneList) {
    zoneList.innerHTML = "";
    mapState.zones.forEach(function(z, i) {
      var row = document.createElement("div");
      row.className = "desk-row" + (editorState.selectedType === "zone" && editorState.selectedIdx === i ? " selected" : "");
      row.style.cssText = "display:flex;gap:6px;align-items:center;padding:4px 6px;border-radius:4px;cursor:pointer;border:1px solid var(--border)";
      var dot = document.createElement("span");
      dot.style.cssText = "width:8px;height:8px;border-radius:50%;flex-shrink:0;background:" + (z.color || SPACE_COLORS[z.space_type] || "#16a34a");
      var lbl = document.createElement("span");
      lbl.style.cssText = "flex:1;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
      lbl.textContent = "⬠ " + (z.name || "Зона");
      row.appendChild(dot); row.appendChild(lbl);
      row.addEventListener("click", function() { selectItem("zone", i); });
      zoneList.appendChild(row);
    });
  }
}

function selectItem(type, idx) {
  editorState.selectedType = type;
  editorState.selectedIdx  = idx;
  renderZones(); renderMarkers(); renderLists();
  showPropsPanel(type, idx);
}

function showPropsPanel(type, idx) {
  var emptyEl = document.getElementById("tile-props-empty");
  var deskSec = document.getElementById("props-desk-section");
  var zoneSec = document.getElementById("props-zone-section");
  if (!emptyEl || !deskSec || !zoneSec) return;

  emptyEl.style.display = (type === null) ? "" : "none";
  deskSec.style.display = (type === "desk") ? "" : "none";
  zoneSec.style.display = (type === "zone") ? "" : "none";

  if (type === "desk" && idx !== null && mapState.desks[idx]) {
    var d = mapState.desks[idx];
    document.getElementById("prop-label").value     = d.label || "";
    document.getElementById("prop-desk-type").value = d.type  || "flex";
    document.getElementById("prop-space").value     = d.space_type || "desk";
    document.getElementById("prop-assigned").value  = d.assigned_to || "";
    document.getElementById("prop-w").value         = Math.round(d.w || DESK_DEFAULT_W);
    document.getElementById("prop-h").value         = Math.round(d.h || DESK_DEFAULT_H);
  }
  if (type === "zone" && idx !== null && mapState.zones[idx]) {
    var z = mapState.zones[idx];
    document.getElementById("prop-zone-name").value  = z.name || "";
    document.getElementById("prop-zone-space").value = z.space_type || "open_space";
    document.getElementById("prop-zone-color").value = z.color || "#16a34a";
  }
}

function clearDrawingLayer() {
  var layer = document.getElementById("drawing-layer");
  if (layer) layer.innerHTML = "";
}

function updateDrawingLayer() {
  var ns    = "http://www.w3.org/2000/svg";
  var layer = document.getElementById("drawing-layer");
  if (!layer || !editorState.drawingZone) return;
  layer.innerHTML = "";
  var pts = editorState.drawingZone.points;
  if (!pts.length) return;

  var ptsStr = pts.map(function(p){ return p.x + "," + p.y; }).join(" ");

  var pl = document.createElementNS(ns, "polyline");
  pl.setAttribute("points", ptsStr);
  pl.setAttribute("fill", "none");
  pl.setAttribute("stroke", "#3b82f6");
  pl.setAttribute("stroke-width", "2");
  pl.setAttribute("stroke-dasharray", "6 3");
  pl.setAttribute("pointer-events", "none");
  layer.appendChild(pl);

  // Dots at each vertex
  pts.forEach(function(p, k) {
    var c = document.createElementNS(ns, "circle");
    c.setAttribute("cx", String(p.x)); c.setAttribute("cy", String(p.y));
    c.setAttribute("r", "4");
    c.setAttribute("fill", k === 0 ? "#ef4444" : "#3b82f6");
    c.setAttribute("pointer-events", "none");
    layer.appendChild(c);
  });
}

// ── Zoom / Pan (viewBox-based) ────────────────────────────────────────────────

var _minZoomFactor = 0.5, _maxZoomFactor = 8;

function _clampViewBox(x, y, w, h) {
  var origW = parseViewBox(mapState.planSvg).w || 1000;
  var origH = parseViewBox(mapState.planSvg).h || 1000;
  var minW  = origW / _maxZoomFactor, maxW = origW / _minZoomFactor;
  w = Math.max(minW, Math.min(maxW, w));
  h = w * origH / origW;
  return { x:x, y:y, w:w, h:h };
}

function initSvgZoomPan() {
  var svg  = document.getElementById("placement-svg");
  var wrap = document.getElementById("placement-canvas-wrap");
  if (!svg || !wrap) return;

  // Wheel zoom centered on cursor
  wrap.addEventListener("wheel", function(e) {
    e.preventDefault();
    var pt   = svgCoordsFromClient(e);
    var factor = e.deltaY < 0 ? 0.85 : 1.15;
    var vb = mapState.viewBox;
    var nw = vb.w * factor;
    var nh = vb.h * factor;
    var origVb = parseViewBox(mapState.planSvg);
    var minW   = (origVb.w || 1000) / _maxZoomFactor;
    var maxW   = (origVb.w || 1000) / _minZoomFactor;
    nw = Math.max(minW, Math.min(maxW, nw));
    nh = (origVb.h || 1000) * nw / (origVb.w || 1000);
    // Keep point under cursor fixed
    var nx = pt.x - (pt.x - vb.x) * nw / vb.w;
    var ny = pt.y - (pt.y - vb.y) * nh / vb.h;
    setViewBox(nx, ny, nw, nh);
  }, { passive: false });

  // Pan in select mode (pointerdown on background)
  svg.addEventListener("pointerdown", function(e) {
    if (editorState.placementMode !== "select") return;
    if (e.target !== svg && !e.target.closest("#floorplan-layer")) return;
    editorState.isPanning = true;
    editorState.panStart  = { svgX: svgCoordsFromClient(e).x, svgY: svgCoordsFromClient(e).y,
                               vxStart: mapState.viewBox.x, vyStart: mapState.viewBox.y };
    svg.setPointerCapture(e.pointerId);
    wrap.style.cursor = "grabbing";
  });

  svg.addEventListener("pointermove", function(e) {
    if (!editorState.isPanning) {
      // Update rubber-band for drawing mode
      if (editorState.placementMode === "draw-zone" && editorState.drawingZone && editorState.drawingZone.points.length > 0) {
        var cur = svgCoordsFromClient(e);
        // show rubber band line from last point to cursor
        var ns = "http://www.w3.org/2000/svg";
        var layer = document.getElementById("drawing-layer");
        if (layer) {
          // Remove old rubber-band line if any
          var old = layer.querySelector(".rubber-band");
          if (old) old.parentNode.removeChild(old);
          var pts = editorState.drawingZone.points;
          var last = pts[pts.length - 1];
          var line = document.createElementNS(ns, "line");
          line.setAttribute("class", "rubber-band");
          line.setAttribute("x1", String(last.x)); line.setAttribute("y1", String(last.y));
          line.setAttribute("x2", String(cur.x));  line.setAttribute("y2", String(cur.y));
          line.setAttribute("stroke", "#3b82f6");
          line.setAttribute("stroke-width", "1.5");
          line.setAttribute("stroke-dasharray", "4 3");
          line.setAttribute("pointer-events", "none");
          layer.appendChild(line);
        }
      }
      return;
    }
    var cur = svgCoordsFromClient(e);
    // Note: panStart stores the SVG coord from the first click + original viewBox offset
    // We need to move viewBox so that the original SVG point stays under cursor
    var ps = editorState.panStart;
    var nx = ps.vxStart - (cur.x - ps.svgX);
    var ny = ps.vyStart - (cur.y - ps.svgY);
    // Recalculate cur after adjusting (just update x/y, keep w/h)
    setViewBox(nx, ny, mapState.viewBox.w, mapState.viewBox.h);
  });

  svg.addEventListener("pointerup", function(e) {
    if (editorState.isPanning) {
      editorState.isPanning = false;
      wrap.style.cursor = "default";
    }
  });

  // Click handler for adding objects
  svg.addEventListener("click", function(e) {
    if (e.target !== svg && !e.target.closest("#floorplan-layer") &&
        !e.target.closest("#drawing-layer")) return;

    var pt = svgCoordsFromClient(e);

    if (editorState.placementMode === "desk") {
      var autoIdx = mapState.desks.length + 1;
      var newDesk = {
        id:          (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : ("d-" + Date.now()),
        label:       "D-" + autoIdx,
        type:        "flex",
        space_type:  "desk",
        assigned_to: null,
        x: pt.x - DESK_DEFAULT_W / 2,
        y: pt.y - DESK_DEFAULT_H / 2,
        w: DESK_DEFAULT_W,
        h: DESK_DEFAULT_H,
      };
      mapState.desks.push(newDesk);
      selectItem("desk", mapState.desks.length - 1);
      return;
    }

    if (editorState.placementMode === "draw-zone") {
      if (!editorState.drawingZone) {
        editorState.drawingZone = { points: [] };
      }
      var pts = editorState.drawingZone.points;

      // Check close distance to first point
      if (pts.length >= 3) {
        var first = pts[0];
        var r = mapState.viewBox.w * 0.015;
        var dist = Math.sqrt((pt.x - first.x) * (pt.x - first.x) + (pt.y - first.y) * (pt.y - first.y));
        if (dist < r) {
          // Close polygon
          var newId = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : ("z-" + Date.now());
          mapState.zones.push({
            id:         newId,
            name:       "Новая зона",
            space_type: "open_space",
            color:      null,
            points:     pts.slice(),
          });
          editorState.drawingZone = null;
          clearDrawingLayer();
          selectItem("zone", mapState.zones.length - 1);
          return;
        }
      }
      pts.push({ x: pt.x, y: pt.y });
      updateDrawingLayer();
      return;
    }
  });
}

// ── Properties panel listeners ────────────────────────────────────────────────

function initPropsListeners() {
  document.getElementById("prop-label")?.addEventListener("input", function() {
    if (editorState.selectedType !== "desk" || editorState.selectedIdx === null) return;
    mapState.desks[editorState.selectedIdx].label = this.value;
    renderMarkers(); renderLists();
  });
  document.getElementById("prop-desk-type")?.addEventListener("change", function() {
    if (editorState.selectedType !== "desk" || editorState.selectedIdx === null) return;
    mapState.desks[editorState.selectedIdx].type = this.value;
  });
  document.getElementById("prop-space")?.addEventListener("change", function() {
    if (editorState.selectedType !== "desk" || editorState.selectedIdx === null) return;
    mapState.desks[editorState.selectedIdx].space_type = this.value;
    renderMarkers(); renderLists();
  });
  document.getElementById("prop-assigned")?.addEventListener("input", function() {
    if (editorState.selectedType !== "desk" || editorState.selectedIdx === null) return;
    mapState.desks[editorState.selectedIdx].assigned_to = this.value || null;
  });
  document.getElementById("prop-w")?.addEventListener("input", function() {
    if (editorState.selectedType !== "desk" || editorState.selectedIdx === null) return;
    mapState.desks[editorState.selectedIdx].w = parseFloat(this.value) || DESK_DEFAULT_W;
    renderMarkers();
  });
  document.getElementById("prop-h")?.addEventListener("input", function() {
    if (editorState.selectedType !== "desk" || editorState.selectedIdx === null) return;
    mapState.desks[editorState.selectedIdx].h = parseFloat(this.value) || DESK_DEFAULT_H;
    renderMarkers();
  });
  document.getElementById("prop-delete-btn")?.addEventListener("click", function() {
    if (editorState.selectedType !== "desk" || editorState.selectedIdx === null) return;
    mapState.desks.splice(editorState.selectedIdx, 1);
    editorState.selectedType = null; editorState.selectedIdx = null;
    renderMarkers(); renderLists(); showPropsPanel(null, null);
  });

  document.getElementById("prop-zone-name")?.addEventListener("input", function() {
    if (editorState.selectedType !== "zone" || editorState.selectedIdx === null) return;
    mapState.zones[editorState.selectedIdx].name = this.value;
    renderZones(); renderLists();
  });
  document.getElementById("prop-zone-space")?.addEventListener("change", function() {
    if (editorState.selectedType !== "zone" || editorState.selectedIdx === null) return;
    mapState.zones[editorState.selectedIdx].space_type = this.value;
    renderZones(); renderLists();
  });
  document.getElementById("prop-zone-color")?.addEventListener("input", function() {
    if (editorState.selectedType !== "zone" || editorState.selectedIdx === null) return;
    mapState.zones[editorState.selectedIdx].color = this.value;
    renderZones(); renderLists();
  });
  document.getElementById("prop-zone-delete-btn")?.addEventListener("click", function() {
    if (editorState.selectedType !== "zone" || editorState.selectedIdx === null) return;
    mapState.zones.splice(editorState.selectedIdx, 1);
    editorState.selectedType = null; editorState.selectedIdx = null;
    renderZones(); renderLists(); showPropsPanel(null, null);
  });
}

// ── SVG upload ────────────────────────────────────────────────────────────────

async function uploadFloorSVG(file) {
  if (!mapState.floorId) { showToast("Выберите этаж.", "error"); return; }
  try {
    var text = await file.text();
    var resp = await fetch(API_BASE + "/floors/" + mapState.floorId + "/map/draft/plan-svg", {
      method:  "POST",
      headers: Object.assign({ "Content-Type": "image/svg+xml" }, authHeader()),
      body:    text,
    });
    if (!resp.ok) {
      var body = await resp.json().catch(function() { return {}; });
      showToast("Ошибка SVG: " + (body.detail || resp.status), "error");
      return;
    }
    await loadFloorMap(mapState.floorId);
    showToast("SVG загружен в черновик.", "success");
  } catch (e) {
    showToast("Ошибка: " + e.message, "error");
  }
}

// ── Save / Publish / Discard ──────────────────────────────────────────────────

async function saveDraft() {
  if (!mapState.floorId) { showToast("Выберите этаж.", "error"); return; }
  try {
    var resp = await fetch(API_BASE + "/floors/" + mapState.floorId + "/map/draft", {
      method:  "PUT",
      headers: Object.assign({ "Content-Type": "application/json" }, authHeader()),
      body:    JSON.stringify({
        plan_svg: mapState.planSvg,
        desks:    mapState.desks,
        zones:    mapState.zones,
        version:  mapState.version,
      }),
    });
    if (resp.status === 409) { showToast("Конфликт версий. Перезагрузите.", "error"); return; }
    if (!resp.ok) {
      var body = await resp.json().catch(function() { return {}; });
      showToast("Ошибка: " + (body.detail || resp.status), "error");
      return;
    }
    var data = await resp.json();
    mapState.version = data.version;
    mapState.status  = data.status;
    updateStatusBadge();
    showToast("Черновик сохранён.", "success");
  } catch (e) {
    showToast("Ошибка: " + e.message, "error");
  }
}

async function publishMap() {
  if (!mapState.floorId) { showToast("Выберите этаж.", "error"); return; }
  if (!confirm("Опубликовать карту? Клиенты увидят изменения.")) return;
  try {
    var resp = await fetch(API_BASE + "/floors/" + mapState.floorId + "/map/publish", {
      method: "POST", headers: authHeader(),
    });
    if (!resp.ok) {
      var body = await resp.json().catch(function() { return {}; });
      showToast("Ошибка публикации: " + (body.detail || resp.status), "error");
      return;
    }
    showToast("Карта опубликована.", "success");
    await loadFloorMap(mapState.floorId);
    await loadFloors();
  } catch (e) {
    showToast("Ошибка: " + e.message, "error");
  }
}

async function discardDraft() {
  if (!mapState.floorId) { showToast("Выберите этаж.", "error"); return; }
  if (!confirm("Отменить черновик? Все несохранённые изменения будут потеряны.")) return;
  try {
    await fetch(API_BASE + "/floors/" + mapState.floorId + "/map/draft", {
      method: "DELETE", headers: authHeader(),
    });
    showToast("Черновик отменён.", "info");
    await loadFloorMap(mapState.floorId);
  } catch (e) {
    showToast("Ошибка: " + e.message, "error");
  }
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

function initEditorKeyboard() {
  document.addEventListener("keydown", function(e) {
    if (e.key === "Escape") {
      if (editorState.drawingZone) {
        editorState.drawingZone = null;
        clearDrawingLayer();
        return;
      }
      if (editorState.selectedType !== null) {
        editorState.selectedType = null; editorState.selectedIdx = null;
        renderZones(); renderMarkers(); renderLists(); showPropsPanel(null, null);
      }
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && editorState.selectedType !== null) {
      var active = document.activeElement;
      if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT")) return;
      if (editorState.selectedType === "desk") {
        mapState.desks.splice(editorState.selectedIdx, 1);
      } else if (editorState.selectedType === "zone") {
        mapState.zones.splice(editorState.selectedIdx, 1);
      }
      editorState.selectedType = null; editorState.selectedIdx = null;
      renderZones(); renderMarkers(); renderLists(); showPropsPanel(null, null);
    }
  });
}

// ── Editor init ───────────────────────────────────────────────────────────────

function initEditorListeners() {
  var floorSel = document.getElementById("placement-floor-select");
  if (floorSel) {
    floorSel.addEventListener("change", function() {
      var fid = floorSel.value || null;
      mapState.floorId = fid;
      loadFloorMap(fid);
    });
  }

  // Mode buttons
  document.querySelectorAll(".placement-mode-btn").forEach(function(btn) {
    btn.addEventListener("click", function() {
      editorState.placementMode = btn.dataset.mode;
      editorState.drawingZone   = null;
      clearDrawingLayer();
      document.querySelectorAll(".placement-mode-btn").forEach(function(b) {
        b.classList.toggle("active", b.dataset.mode === btn.dataset.mode);
      });
      var wrap = document.getElementById("placement-canvas-wrap");
      if (wrap) {
        wrap.style.cursor = (btn.dataset.mode === "select") ? "default" : "crosshair";
      }
    });
  });

  // Action buttons
  document.getElementById("save-draft-btn")?.addEventListener("click", saveDraft);
  document.getElementById("publish-btn")?.addEventListener("click", publishMap);
  document.getElementById("discard-draft-btn")?.addEventListener("click", discardDraft);

  // SVG file upload
  var planFile = document.getElementById("plan-file");
  if (planFile) {
    planFile.addEventListener("change", function() {
      if (planFile.files[0]) { uploadFloorSVG(planFile.files[0]); planFile.value = ""; }
    });
  }

  initSvgZoomPan();
  initPropsListeners();
  initEditorKeyboard();
}

// ── (all legacy PNG-overlay editor code removed — replaced by SVG editor above) ──

// ── Tab switching ─────────────────────────────────────────────────────────────
document.querySelectorAll(".nav-item[data-tab]").forEach(function (btn) {
  btn.addEventListener("click", function () {
    document.querySelectorAll(".nav-item").forEach(function (b) { b.classList.remove("active"); });
    document.querySelectorAll(".tab-content").forEach(function (t) { t.classList.add("hidden"); });
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).classList.remove("hidden");
    if (btn.dataset.tab === "analytics") loadAnalytics();
  });
});

// ── Reservation filters ───────────────────────────────────────────────────────
document.getElementById("apply-filters-btn").addEventListener("click", loadReservations);
document.getElementById("reset-filters-btn").addEventListener("click", function () {
  document.getElementById("filter-office").value    = "";
  document.getElementById("filter-date-from").value = "";
  document.getElementById("filter-date-to").value   = "";
  document.getElementById("filter-user").value      = "";
  document.getElementById("filter-status").value    = "";
  loadReservations();
});

// ── Login form ────────────────────────────────────────────────────────────────
document.getElementById("login-form").addEventListener("submit", async function (e) {
  e.preventDefault();
  loginError.classList.add("hidden");
  var username = document.getElementById("login-username").value.trim();
  var password = document.getElementById("login-password").value;
  if (!username || !password) {
    loginError.textContent = "Введите логин и пароль.";
    loginError.classList.remove("hidden");
    return;
  }
  try {
    var form = new URLSearchParams({ username: username, password: password });
    var resp = await fetch(API_BASE + "/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    });
    if (!resp.ok) {
      var body = await resp.json().catch(function () { return {}; });
      throw new Error(body.detail || ("Ошибка " + resp.status));
    }
    var data = await resp.json();
    setToken(data.access_token, username);
    showToast("Добро пожаловать, " + username + "!", "success");
    await loadAll();
  } catch (e) {
    loginError.textContent = e.message;
    loginError.classList.remove("hidden");
  }
});

document.getElementById("login-password").addEventListener("keydown", function (e) {
  if (e.key === "Enter") document.getElementById("login-form").requestSubmit();
});

// ── Logout ────────────────────────────────────────────────────────────────────
logoutBtn.addEventListener("click", function () {
  clearToken();
  showToast("Вы вышли из панели администратора.", "info");
});

// ── Refresh buttons ───────────────────────────────────────────────────────────
document.getElementById("refresh-offices").addEventListener("click", loadOffices);
document.getElementById("refresh-floors").addEventListener("click", loadFloors);
document.getElementById("refresh-desks")?.addEventListener("click", loadDesks);
document.getElementById("refresh-policies").addEventListener("click", loadPolicies);
document.getElementById("refresh-reservations").addEventListener("click", loadReservations);
document.getElementById("refresh-analytics").addEventListener("click", loadAnalytics);

// ── Create office ─────────────────────────────────────────────────────────────
document.getElementById("create-office-btn").addEventListener("click", async function () {
  var name = officeName.value.trim();
  if (!name) { showToast("Введите название офиса.", "error"); return; }
  try {
    await apiRequest("/offices", {
      method: "POST",
      body: JSON.stringify({ name: name, address: officeAddress.value.trim() || null }),
    });
    showToast("Офис «" + name + "» создан.", "success");
    officeName.value = "";
    officeAddress.value = "";
    await loadAll();
  } catch (e) {
    showToast("Ошибка: " + e.message, "error");
  }
});

// ── Create floor ──────────────────────────────────────────────────────────────
document.getElementById("create-floor-btn").addEventListener("click", async function () {
  var officeId = Number(floorOfficeSelect.value);
  var name = floorName.value.trim();
  if (!officeId || !name) { showToast("Выберите офис и введите название этажа.", "error"); return; }
  try {
    await apiRequest("/floors", {
      method: "POST",
      body: JSON.stringify({ office_id: officeId, name: name }),
    });
    showToast("Этаж «" + name + "» создан.", "success");
    floorName.value = "";
    await loadAll();
  } catch (e) {
    showToast("Ошибка: " + e.message, "error");
  }
});

// ── Upload floor plan (PNG legacy — kept for backward compat via /floors/{id}/plan) ──
document.getElementById("upload-plan-btn")?.addEventListener("click", async function () {
  var floorId = planFloorSelect?.value;
  var file = planFile?.files?.[0];
  if (!floorId || !file) { showToast("Выберите этаж и файл PNG.", "error"); return; }
  try {
    var token = getToken();
    var formData = new FormData();
    formData.append("file", file);
    var resp = await fetch(API_BASE + "/floors/" + floorId + "/plan", {
      method: "POST",
      headers: token ? { Authorization: "Bearer " + token } : {},
      body: formData,
    });
    if (!resp.ok) {
      var body = await resp.json().catch(function () { return {}; });
      throw new Error(body.detail || ("Ошибка " + resp.status));
    }
    showToast("План этажа загружен.", "success");
    if (planFile) planFile.value = "";
    await loadFloors();
  } catch (e) {
    showToast("Ошибка: " + e.message, "error");
  }
});

// ── Create policy ─────────────────────────────────────────────────────────────
document.getElementById("create-policy-btn").addEventListener("click", async function () {
  var officeId = Number(policyOfficeSelect.value);
  var name = policyName.value.trim();
  if (!officeId || !name) { showToast("Выберите офис и введите название политики.", "error"); return; }
  try {
    await apiRequest("/policies", {
      method: "POST",
      body: JSON.stringify({
        office_id: officeId,
        name: name,
        min_days_ahead: Number(policyMinDays.value),
        max_days_ahead: Number(policyMaxDays.value),
        min_duration_minutes: Number(policyMinDur.value),
        max_duration_minutes: Number(policyMaxDur.value),
        no_show_timeout_minutes: Number(policyNoshow.value),
      }),
    });
    showToast("Политика «" + name + "» создана.", "success");
    policyName.value = "";
    await loadPolicies();
  } catch (e) {
    showToast("Ошибка: " + e.message, "error");
  }
});

// ── Departments ───────────────────────────────────────────────────────────────

async function loadDepartments() {
  const tbody = document.getElementById("departments-body");
  if (!tbody) return;
  try {
    const depts = await apiRequest("/departments");
    if (!depts.length) {
      tbody.innerHTML = '<tr><td colspan="2" class="empty">Нет отделов</td></tr>';
      return;
    }
    tbody.innerHTML = "";
    for (const d of depts) {
      const tr = document.createElement("tr");
      const tdName = document.createElement("td");
      tdName.textContent = d.name;
      const tdAct = document.createElement("td");
      tdAct.append(makeDeleteBtn("Удалить", async function () {
        if (!confirm("Удалить отдел «" + d.name + "»?")) return;
        try {
          await apiRequest("/departments/" + d.id, { method: "DELETE" });
          showToast("Отдел «" + d.name + "» удалён.", "success");
          await loadDepartments();
        } catch (e) {
          showToast("Ошибка: " + e.message, "error");
        }
      }));
      tr.append(tdName, tdAct);
      tbody.append(tr);
    }
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="2" class="empty">Ошибка загрузки</td></tr>';
  }
}

document.getElementById("refresh-departments")?.addEventListener("click", loadDepartments);

document.getElementById("add-dept-btn")?.addEventListener("click", async () => {
  const nameInput = document.getElementById("dept-name");
  const msgEl     = document.getElementById("dept-msg");
  const name = nameInput?.value.trim();
  if (!name) { if (msgEl) msgEl.innerHTML = '<span class="error-msg">Введите название</span>'; return; }
  try {
    await apiRequest("/departments", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    if (msgEl) msgEl.innerHTML = '<span class="success-msg">Отдел добавлен</span>';
    if (nameInput) nameInput.value = "";
    await loadDepartments();
    setTimeout(() => { if (msgEl) msgEl.innerHTML = ""; }, 3000);
  } catch (e) {
    if (msgEl) msgEl.innerHTML = '<span class="error-msg">' + e.message + '</span>';
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  await checkApi();
  var token    = getToken();
  var username = localStorage.getItem("admin_username");
  if (token && username) {
    try {
      await apiRequest("/offices");
      showAdminUI(username);
      initEditorListeners();
      await loadAll();
    } catch {
      clearToken();
    }
  } else {
    showLoginOverlay();
    initEditorListeners();
    if (window.lucide) lucide.createIcons();
  }
}

init();
