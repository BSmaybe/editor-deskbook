const API_BASE = "http://localhost:8000";

// ── DOM refs ─────────────────────────────────────────────────────────────────
const loginOverlay     = document.getElementById("login-overlay");
const loginUsername    = document.getElementById("login-username");
const loginPassword    = document.getElementById("login-password");
const loginBtn         = document.getElementById("login-btn");
const loginError       = document.getElementById("login-error");
const logoutBtn        = document.getElementById("logout-btn");
const loggedAs         = document.getElementById("logged-as");
const apiStatus        = document.getElementById("api-status");
const messages         = document.getElementById("messages");

// Tables
const officesBody      = document.getElementById("offices-body");
const floorsBody       = document.getElementById("floors-body");
const desksBody        = document.getElementById("desks-body");
const policiesBody     = document.getElementById("policies-body");
const reservationsBody = document.getElementById("reservations-body");

// Office form
const officeName       = document.getElementById("office-name");
const officeAddress    = document.getElementById("office-address");

// Floor form
const floorOfficeSelect = document.getElementById("floor-office-select");
const floorName         = document.getElementById("floor-name");
const planFloorSelect   = document.getElementById("plan-floor-select");
const planFile          = document.getElementById("plan-file");

// Desk form
const deskFloorSelect  = document.getElementById("desk-floor-select");
const deskLabel        = document.getElementById("desk-label");
const deskType         = document.getElementById("desk-type");
const deskZone         = document.getElementById("desk-zone");
const deskAssigned     = document.getElementById("desk-assigned");

// Policy form
const policyOfficeSelect = document.getElementById("policy-office-select");
const policyName         = document.getElementById("policy-name");
const policyMinDays      = document.getElementById("policy-min-days");
const policyMaxDays      = document.getElementById("policy-max-days");
const policyMinDur       = document.getElementById("policy-min-dur");
const policyMaxDur       = document.getElementById("policy-max-dur");
const policyNoshow       = document.getElementById("policy-noshow");

// ── State ─────────────────────────────────────────────────────────────────────
const state = { offices: [], floors: [], desks: [], policies: [], reservations: [] };

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
  logoutBtn.classList.remove("hidden");
  loggedAs.textContent = `admin: ${username}`;
  loggedAs.classList.remove("hidden");
}

function showLoginOverlay() {
  loginOverlay.classList.remove("hidden");
  logoutBtn.classList.add("hidden");
  loggedAs.classList.add("hidden");
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function addMessage(text, type = "info") {
  const item = document.createElement("div");
  item.className = `message ${type}`;
  item.textContent = text;
  messages.prepend(item);
}

function setApiStatus(ok) {
  apiStatus.textContent = ok ? "API: доступно" : "API: недоступно";
  apiStatus.style.background = ok ? "#dcfce7" : "#fee2e2";
  apiStatus.style.color = ok ? "#166534" : "#991b1b";
  apiStatus.style.borderColor = ok ? "#bbf7d0" : "#fecaca";
}

async function apiRequest(path, options = {}) {
  const token = getToken();
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || `Ошибка ${response.status}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

function makeDeleteBtn(label, onClick) {
  const btn = document.createElement("button");
  btn.className = "button danger small";
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  return btn;
}

function makeCancelBtn(reservationId) {
  return makeDeleteBtn("Отменить", async () => {
    try {
      await apiRequest(`/reservations/${reservationId}/cancel`, { method: "POST" });
      addMessage("Бронирование отменено.", "success");
      await loadReservations();
    } catch (e) {
      addMessage(`Ошибка: ${e.message}`, "error");
    }
  });
}

// ── API calls ─────────────────────────────────────────────────────────────────
async function checkApi() {
  try {
    await apiRequest("/health");
    setApiStatus(true);
  } catch {
    setApiStatus(false);
    addMessage("API недоступно. Запустите backend на http://localhost:8000.", "error");
  }
}

async function loadOffices() {
  try {
    state.offices = await apiRequest("/offices");
    renderOfficesTable();
    populateOfficeSelects();
  } catch (e) {
    addMessage(`Не удалось загрузить офисы: ${e.message}`, "error");
  }
}

async function loadFloors() {
  try {
    state.floors = await apiRequest("/floors");
    renderFloorsTable();
    populateFloorSelects();
  } catch (e) {
    addMessage(`Не удалось загрузить этажи: ${e.message}`, "error");
  }
}

async function loadDesks() {
  try {
    state.desks = await apiRequest("/desks");
    renderDesksTable();
  } catch (e) {
    addMessage(`Не удалось загрузить рабочие места: ${e.message}`, "error");
  }
}

async function loadPolicies() {
  try {
    state.policies = await apiRequest("/policies");
    renderPoliciesTable();
  } catch (e) {
    addMessage(`Не удалось загрузить политики: ${e.message}`, "error");
  }
}

async function loadReservations() {
  try {
    state.reservations = await apiRequest("/reservations");
    renderReservationsTable();
  } catch (e) {
    addMessage(`Не удалось загрузить бронирования: ${e.message}`, "error");
  }
}

async function loadAll() {
  await loadOffices();
  await Promise.all([loadFloors(), loadPolicies(), loadReservations()]);
  await loadDesks();
}

// ── Render ────────────────────────────────────────────────────────────────────
function officeName_(officeId) {
  return state.offices.find((o) => o.id === officeId)?.name ?? officeId;
}

function floorName_(floorId) {
  const f = state.floors.find((f) => f.id === floorId);
  return f ? `${f.name} (офис ${officeName_(f.office_id)})` : floorId;
}

function renderOfficesTable() {
  officesBody.innerHTML = "";
  if (!state.offices.length) {
    officesBody.innerHTML = '<tr><td colspan="4" class="empty">Нет офисов.</td></tr>';
    return;
  }
  for (const o of state.offices) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${o.id}</td><td>${o.name}</td><td>${o.address || "—"}</td><td></td>`;
    tr.querySelector("td:last-child").append(
      makeDeleteBtn("Удалить", async () => {
        if (!confirm(`Удалить офис «${o.name}»?`)) return;
        try {
          await apiRequest(`/offices/${o.id}`, { method: "DELETE" });
          addMessage(`Офис «${o.name}» удалён.`, "success");
          await loadAll();
        } catch (e) {
          addMessage(`Ошибка: ${e.message}`, "error");
        }
      })
    );
    officesBody.append(tr);
  }
}

function renderFloorsTable() {
  floorsBody.innerHTML = "";
  if (!state.floors.length) {
    floorsBody.innerHTML = '<tr><td colspan="5" class="empty">Нет этажей.</td></tr>';
    return;
  }
  for (const f of state.floors) {
    const tr = document.createElement("tr");
    const planCell = f.plan_url
      ? `<a href="${f.plan_url}" target="_blank" rel="noopener">Посмотреть</a>`
      : "Нет";
    tr.innerHTML = `<td>${f.id}</td><td>${officeName_(f.office_id)}</td><td>${f.name}</td><td>${planCell}</td><td></td>`;
    tr.querySelector("td:last-child").append(
      makeDeleteBtn("Удалить", async () => {
        if (!confirm(`Удалить этаж «${f.name}»?`)) return;
        try {
          await apiRequest(`/floors/${f.id}`, { method: "DELETE" });
          addMessage(`Этаж «${f.name}» удалён.`, "success");
          await loadAll();
        } catch (e) {
          addMessage(`Ошибка: ${e.message}`, "error");
        }
      })
    );
    floorsBody.append(tr);
  }
}

function makeQrBtn(desk) {
  const btn = document.createElement("button");
  btn.className = "button secondary small";
  btn.textContent = "QR";
  btn.title = `Показать QR-код для места «${desk.label}»`;
  btn.addEventListener("click", async () => {
    const token = getToken();
    try {
      const resp = await fetch(`${API_BASE}/desks/${desk.id}/qr`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        addMessage(`Не удалось получить QR: ${body.detail || resp.status}`, "error");
        return;
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
    } catch (e) {
      addMessage(`Ошибка при загрузке QR: ${e.message}`, "error");
    }
  });
  return btn;
}

function renderDesksTable() {
  desksBody.innerHTML = "";
  if (!state.desks.length) {
    desksBody.innerHTML = '<tr><td colspan="7" class="empty">Нет рабочих мест.</td></tr>';
    return;
  }
  for (const d of state.desks) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${d.id}</td><td>${floorName_(d.floor_id)}</td><td>${d.label}</td><td>${d.type === "fixed" ? "Закреплённое" : "Гибкое"}</td><td>${d.zone || "—"}</td><td>${d.assigned_to || "—"}</td><td></td>`;
    const actionCell = tr.querySelector("td:last-child");
    const btnRow = document.createElement("div");
    btnRow.className = "btn-row";
    btnRow.append(
      makeQrBtn(d),
      makeDeleteBtn("Удалить", async () => {
        if (!confirm(`Удалить место «${d.label}»?`)) return;
        try {
          await apiRequest(`/desks/${d.id}`, { method: "DELETE" });
          addMessage(`Место «${d.label}» удалено.`, "success");
          await loadDesks();
        } catch (e) {
          addMessage(`Ошибка: ${e.message}`, "error");
        }
      })
    );
    actionCell.append(btnRow);
    desksBody.append(tr);
  }
}

function renderPoliciesTable() {
  policiesBody.innerHTML = "";
  if (!state.policies.length) {
    policiesBody.innerHTML = '<tr><td colspan="7" class="empty">Нет политик.</td></tr>';
    return;
  }
  for (const p of state.policies) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${p.id}</td><td>${officeName_(p.office_id)}</td><td>${p.name}</td><td>${p.min_days_ahead}–${p.max_days_ahead}</td><td>${p.min_duration_minutes}–${p.max_duration_minutes}</td><td>${p.no_show_timeout_minutes}</td><td></td>`;
    tr.querySelector("td:last-child").append(
      makeDeleteBtn("Удалить", async () => {
        if (!confirm(`Удалить политику «${p.name}»?`)) return;
        try {
          await apiRequest(`/policies/${p.id}`, { method: "DELETE" });
          addMessage(`Политика «${p.name}» удалена.`, "success");
          await loadPolicies();
        } catch (e) {
          addMessage(`Ошибка: ${e.message}`, "error");
        }
      })
    );
    policiesBody.append(tr);
  }
}

function renderReservationsTable() {
  reservationsBody.innerHTML = "";
  if (!state.reservations.length) {
    reservationsBody.innerHTML = '<tr><td colspan="8" class="empty">Нет бронирований.</td></tr>';
    return;
  }
  for (const r of state.reservations) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.id}</td>
      <td>${r.desk_id}</td>
      <td>${r.user_id}</td>
      <td>${r.reservation_date}</td>
      <td>${r.start_time?.slice(0, 5) ?? "—"}</td>
      <td>${r.end_time?.slice(0, 5) ?? "—"}</td>
      <td>${r.status}</td>
      <td></td>`;
    if (r.status === "active") {
      tr.querySelector("td:last-child").append(makeCancelBtn(r.id));
    }
    reservationsBody.append(tr);
  }
}

// ── Selects population ────────────────────────────────────────────────────────
function populateOfficeSelects() {
  for (const sel of [floorOfficeSelect, policyOfficeSelect]) {
    const val = sel.value;
    sel.innerHTML = '<option value="">Выберите офис</option>';
    for (const o of state.offices) {
      const opt = document.createElement("option");
      opt.value = o.id;
      opt.textContent = o.name;
      sel.append(opt);
    }
    if (val) sel.value = val;
  }
}

function populateFloorSelects() {
  for (const sel of [deskFloorSelect, planFloorSelect]) {
    const val = sel.value;
    sel.innerHTML = '<option value="">Выберите этаж</option>';
    for (const f of state.floors) {
      const opt = document.createElement("option");
      opt.value = f.id;
      opt.textContent = `${f.name} (${officeName_(f.office_id)})`;
      sel.append(opt);
    }
    if (val) sel.value = val;
  }
}

// ── Events ────────────────────────────────────────────────────────────────────
loginBtn.addEventListener("click", async () => {
  loginError.classList.add("hidden");
  const username = loginUsername.value.trim();
  const password = loginPassword.value;
  if (!username || !password) {
    loginError.textContent = "Введите логин и пароль.";
    loginError.classList.remove("hidden");
    return;
  }
  try {
    const form = new URLSearchParams({ username, password });
    const resp = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      throw new Error(body.detail || `Ошибка ${resp.status}`);
    }
    const data = await resp.json();
    setToken(data.access_token, username);
    addMessage(`Вы вошли как ${username}.`, "success");
    await loadAll();
  } catch (e) {
    loginError.textContent = e.message;
    loginError.classList.remove("hidden");
  }
});

loginPassword.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loginBtn.click();
});

logoutBtn.addEventListener("click", () => {
  clearToken();
  addMessage("Вы вышли из панели администратора.", "info");
});

document.getElementById("refresh-offices").addEventListener("click", loadOffices);
document.getElementById("refresh-floors").addEventListener("click", loadFloors);
document.getElementById("refresh-desks").addEventListener("click", loadDesks);
document.getElementById("refresh-policies").addEventListener("click", loadPolicies);
document.getElementById("refresh-reservations").addEventListener("click", loadReservations);

document.getElementById("create-office-btn").addEventListener("click", async () => {
  const name = officeName.value.trim();
  if (!name) { addMessage("Введите название офиса.", "error"); return; }
  try {
    await apiRequest("/offices", {
      method: "POST",
      body: JSON.stringify({ name, address: officeAddress.value.trim() || null }),
    });
    addMessage(`Офис «${name}» создан.`, "success");
    officeName.value = "";
    officeAddress.value = "";
    await loadAll();
  } catch (e) {
    addMessage(`Ошибка: ${e.message}`, "error");
  }
});

document.getElementById("create-floor-btn").addEventListener("click", async () => {
  const officeId = Number(floorOfficeSelect.value);
  const name = floorName.value.trim();
  if (!officeId || !name) { addMessage("Выберите офис и введите название этажа.", "error"); return; }
  try {
    await apiRequest("/floors", {
      method: "POST",
      body: JSON.stringify({ office_id: officeId, name }),
    });
    addMessage(`Этаж «${name}» создан.`, "success");
    floorName.value = "";
    await loadAll();
  } catch (e) {
    addMessage(`Ошибка: ${e.message}`, "error");
  }
});

document.getElementById("upload-plan-btn").addEventListener("click", async () => {
  const floorId = planFloorSelect.value;
  const file = planFile.files[0];
  if (!floorId || !file) { addMessage("Выберите этаж и файл PNG.", "error"); return; }
  try {
    const token = getToken();
    const formData = new FormData();
    formData.append("file", file);
    const resp = await fetch(`${API_BASE}/floors/${floorId}/plan`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      throw new Error(body.detail || `Ошибка ${resp.status}`);
    }
    addMessage("План этажа загружен.", "success");
    planFile.value = "";
    await loadFloors();
  } catch (e) {
    addMessage(`Ошибка: ${e.message}`, "error");
  }
});

document.getElementById("create-desk-btn").addEventListener("click", async () => {
  const floorId = Number(deskFloorSelect.value);
  const label = deskLabel.value.trim();
  if (!floorId || !label) { addMessage("Выберите этаж и введите метку.", "error"); return; }
  try {
    await apiRequest("/desks", {
      method: "POST",
      body: JSON.stringify({
        floor_id: floorId,
        label,
        type: deskType.value,
        zone: deskZone.value.trim() || null,
        assigned_to: deskAssigned.value.trim() || null,
      }),
    });
    addMessage(`Место «${label}» создано.`, "success");
    deskLabel.value = "";
    deskZone.value = "";
    deskAssigned.value = "";
    await loadDesks();
  } catch (e) {
    addMessage(`Ошибка: ${e.message}`, "error");
  }
});

document.getElementById("create-policy-btn").addEventListener("click", async () => {
  const officeId = Number(policyOfficeSelect.value);
  const name = policyName.value.trim();
  if (!officeId || !name) { addMessage("Выберите офис и введите название политики.", "error"); return; }
  try {
    await apiRequest("/policies", {
      method: "POST",
      body: JSON.stringify({
        office_id: officeId,
        name,
        min_days_ahead: Number(policyMinDays.value),
        max_days_ahead: Number(policyMaxDays.value),
        min_duration_minutes: Number(policyMinDur.value),
        max_duration_minutes: Number(policyMaxDur.value),
        no_show_timeout_minutes: Number(policyNoshow.value),
      }),
    });
    addMessage(`Политика «${name}» создана.`, "success");
    policyName.value = "";
    await loadPolicies();
  } catch (e) {
    addMessage(`Ошибка: ${e.message}`, "error");
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  await checkApi();
  const token = getToken();
  const username = localStorage.getItem("admin_username");
  if (token && username) {
    // Validate token by calling a protected endpoint
    try {
      await apiRequest("/offices");
      showAdminUI(username);
      await loadAll();
    } catch {
      clearToken();
    }
  } else {
    showLoginOverlay();
  }
}

init();
