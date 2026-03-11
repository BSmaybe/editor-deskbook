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
const adminSidebarToggle = document.getElementById("admin-sidebar-toggle");

const ADMIN_SIDEBAR_COLLAPSED_KEY = "admin_sidebar_collapsed";

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
const policyMaxPerDay    = document.getElementById("policy-max-per-day");

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
  applyAdminSidebarState(isAdminSidebarCollapsed(), false);
  if (window.lucide) lucide.createIcons();
}

function showLoginOverlay() {
  loginOverlay.classList.remove("hidden");
  adminApp.classList.add("hidden");
}

function isAdminSidebarCollapsed() {
  return localStorage.getItem(ADMIN_SIDEBAR_COLLAPSED_KEY) === "1";
}

function applyAdminSidebarState(collapsed, persist) {
  if (adminApp) adminApp.classList.toggle("sidebar-collapsed", !!collapsed);
  if (adminSidebarToggle) {
    adminSidebarToggle.setAttribute("aria-expanded", String(!collapsed));
    adminSidebarToggle.title = collapsed ? "Показать меню" : "Скрыть меню";
  }
  if (persist !== false) {
    localStorage.setItem(ADMIN_SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
  }
}

function initAdminSidebarToggle() {
  if (!adminSidebarToggle) return;
  applyAdminSidebarState(isAdminSidebarCollapsed(), false);
  adminSidebarToggle.addEventListener("click", function () {
    applyAdminSidebarState(!adminApp.classList.contains("sidebar-collapsed"), true);
  });
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
    policiesBody.innerHTML = '<tr><td colspan="8" class="empty">Нет политик.</td></tr>';
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
      "<td>" + (p.max_bookings_per_day || 1) + "</td>" +
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
  [planFloorSelect].forEach(function (sel) {
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
  if (typeof populateEdFloorSelect === "function") {
    populateEdFloorSelect(state.floors, state.offices);
  }
}

// ── escHtml utility (kept for other render functions) ──────────────────────────

function escHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── Old editor removed — see editor.js ────────────────────────────────────────

/* DELETED: parseViewBox, setViewBox, svgCoordsFromClient, updateStatusBadge,
   loadFloorMap, renderFloorPlan, renderZones, renderMarkers, renderLists,
   selectItem, showPropsPanel, clearDrawingLayer, updateDrawingLayer,
   initSvgZoomPan, initPropsListeners, initEditorKeyboard, initEditorListeners
   — all replaced by editor.js */

// ── Tab switching ─────────────────────────────────────────────────────────────
document.querySelectorAll(".nav-item[data-tab]").forEach(function (btn) {
  btn.addEventListener("click", function () {
    document.querySelectorAll(".nav-item").forEach(function (b) { b.classList.remove("active"); });
    document.querySelectorAll(".tab-content").forEach(function (t) { t.classList.add("hidden"); });
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).classList.remove("hidden");
    document.dispatchEvent(new CustomEvent("admin:tab-change", { detail: { tab: btn.dataset.tab } }));
    if (btn.dataset.tab === "analytics") loadAnalytics();
    if (btn.dataset.tab === "editor" && typeof populateEdFloorSelect === "function") {
      populateEdFloorSelect(state.floors, state.offices);
    }
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
        max_bookings_per_day: Number(policyMaxPerDay.value) || 1,
      }),
    });
    showToast("Политика «" + name + "» создана.", "success");
    policyName.value = "";
    if (policyMaxPerDay) policyMaxPerDay.value = "1";
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
  initAdminSidebarToggle();
  var token    = getToken();
  var username = localStorage.getItem("admin_username");
  if (token && username) {
    try {
      await apiRequest("/offices");
      showAdminUI(username);
      if (typeof initFloorEditor === "function") initFloorEditor();
      await loadAll();
    } catch {
      clearToken();
    }
  } else {
    showLoginOverlay();
    if (typeof initFloorEditor === "function") initFloorEditor();
    if (window.lucide) lucide.createIcons();
  }
}

init();
