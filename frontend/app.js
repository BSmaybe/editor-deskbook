const API_BASE = "http://localhost:8000";

// ── DOM refs ────────────────────────────────────────────────────────────────
const officeSelect         = document.getElementById("office-select");
const floorSelect          = document.getElementById("floor-select");
const desksContainer       = document.getElementById("desks");
const messages             = document.getElementById("messages");
const refreshButton        = document.getElementById("refresh");
const refreshBookings      = document.getElementById("refresh-bookings");
const apiStatus            = document.getElementById("api-status");
const policyList           = document.getElementById("policy-list");
const policyEmpty          = document.getElementById("policy-empty");
const floorPlanPlaceholder = document.getElementById("floor-plan-placeholder");
const floorPlanFigure      = document.getElementById("floor-plan-figure");
const floorPlanImage       = document.getElementById("floor-plan-image");
const floorPlanCaption     = document.getElementById("floor-plan-caption");
const floorPlanOverlay     = document.getElementById("floor-plan-overlay");
const userInput            = document.getElementById("user-id");
const dateInput            = document.getElementById("reservation-date");
const startInput           = document.getElementById("start-time");
const endInput             = document.getElementById("end-time");
const myBookingsContainer  = document.getElementById("my-bookings");
const deskTemplate         = document.getElementById("desk-card-template");

// Auth DOM refs
const loginOverlay    = document.getElementById("login-overlay");
const authTitle       = document.getElementById("auth-title");
const formLogin       = document.getElementById("form-login");
const formRegister    = document.getElementById("form-register");
const loginUsername   = document.getElementById("login-username");
const loginPassword   = document.getElementById("login-password");
const regUsername     = document.getElementById("reg-username");
const regEmail        = document.getElementById("reg-email");
const regPassword     = document.getElementById("reg-password");
const authError       = document.getElementById("auth-error");
const authSubmitBtn   = document.getElementById("auth-submit-btn");
const authToggleLink  = document.getElementById("auth-toggle-link");
const authToggleText  = document.getElementById("auth-toggle-text");
const loggedAs        = document.getElementById("logged-as");
const logoutBtn       = document.getElementById("logout-btn");

// ── State ───────────────────────────────────────────────────────────────────
const state = {
  offices: [],
  floors: [],
  desks: [],
  availability: new Map(),
  policies: [],
};

let isLoginMode = true;

dateInput.value = new Date().toISOString().slice(0, 10);

// ── Auth helpers ─────────────────────────────────────────────────────────────
function getToken() {
  return localStorage.getItem("user_token");
}

function setToken(token, username) {
  localStorage.setItem("user_token", token);
  localStorage.setItem("user_username", username);
  showUserUI(username);
}

function clearToken() {
  localStorage.removeItem("user_token");
  localStorage.removeItem("user_username");
  userInput.value = "";
  showLoginOverlay();
}

function showLoginOverlay() {
  loginOverlay.classList.remove("hidden");
  logoutBtn.classList.add("hidden");
  loggedAs.classList.add("hidden");
}

function showUserUI(username) {
  loginOverlay.classList.add("hidden");
  loggedAs.textContent = username;
  loggedAs.classList.remove("hidden");
  logoutBtn.classList.remove("hidden");
  userInput.value = username;
}

// ── Helpers ─────────────────────────────────────────────────────────────────
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

// ── API calls ────────────────────────────────────────────────────────────────
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
  officeSelect.innerHTML = '<option value="">Выберите офис</option>';
  try {
    state.offices = await apiRequest("/offices");
    for (const o of state.offices) {
      const opt = document.createElement("option");
      opt.value = o.id;
      opt.textContent = o.address ? `${o.name}, ${o.address}` : o.name;
      officeSelect.append(opt);
    }
  } catch (e) {
    addMessage(`Не удалось загрузить офисы: ${e.message}`, "error");
  }
}

async function loadFloors(officeId) {
  floorSelect.innerHTML = '<option value="">Выберите этаж</option>';
  floorSelect.disabled = true;
  desksContainer.innerHTML = '<div class="empty">Выберите этаж для отображения мест.</div>';
  resetFloorPlan("Выберите этаж для отображения плана.");
  if (!officeId) return;
  try {
    state.floors = await apiRequest(`/floors?office_id=${officeId}`);
    for (const f of state.floors) {
      const opt = document.createElement("option");
      opt.value = f.id;
      opt.textContent = f.plan_url ? `${f.name} (есть план)` : f.name;
      floorSelect.append(opt);
    }
    floorSelect.disabled = false;
  } catch (e) {
    addMessage(`Не удалось загрузить этажи: ${e.message}`, "error");
  }
}

async function loadPolicies(officeId) {
  policyList.classList.add("hidden");
  policyEmpty.textContent = "Выберите офис, чтобы увидеть правила.";
  policyEmpty.classList.remove("hidden");
  if (!officeId) return;
  try {
    state.policies = await apiRequest(`/policies?office_id=${officeId}`);
    renderPolicies();
  } catch (e) {
    policyEmpty.textContent = `Не удалось загрузить правила: ${e.message}`;
  }
}

async function loadDesks(floorId) {
  if (!floorId) {
    desksContainer.innerHTML = '<div class="empty">Выберите этаж для отображения мест.</div>';
    return;
  }
  desksContainer.innerHTML = '<div class="empty">Загрузка мест...</div>';
  try {
    state.desks = await apiRequest(`/desks?floor_id=${floorId}`);
    await refreshAvailability();
  } catch (e) {
    addMessage(`Не удалось загрузить места: ${e.message}`, "error");
    desksContainer.innerHTML = '<div class="empty">Не удалось получить места.</div>';
  }
}

async function refreshAvailability() {
  const params = {
    reservation_date: dateInput.value,
    start_time: startInput.value,
    end_time: endInput.value,
    user_id: userInput.value.trim() || undefined,
  };
  if (!params.reservation_date || !params.start_time || !params.end_time) {
    addMessage("Заполните дату и время, чтобы проверить доступность.", "error");
    return;
  }
  state.availability.clear();
  await Promise.all(
    state.desks.map(async (desk) => {
      const qs = new URLSearchParams({
        desk_id: String(desk.id),
        reservation_date: params.reservation_date,
        start_time: params.start_time,
        end_time: params.end_time,
      });
      if (params.user_id) qs.append("user_id", params.user_id);
      try {
        const result = await apiRequest(`/availability?${qs}`);
        state.availability.set(desk.id, result);
      } catch (e) {
        state.availability.set(desk.id, { available: false, reason: e.message });
      }
    })
  );
  renderDesks();
}

async function loadMyBookings() {
  const userId = userInput.value.trim();
  if (!userId) {
    myBookingsContainer.innerHTML = '<div class="empty">Войдите в систему, чтобы увидеть бронирования.</div>';
    return;
  }
  try {
    const all = await apiRequest("/reservations");
    const mine = all.filter((r) => r.user_id === userId && r.status === "active");
    renderMyBookings(mine);
  } catch (e) {
    addMessage(`Не удалось загрузить бронирования: ${e.message}`, "error");
  }
}

async function cancelBooking(reservationId) {
  try {
    await apiRequest(`/reservations/${reservationId}/cancel`, { method: "POST" });
    addMessage("Бронирование отменено.", "success");
    await loadMyBookings();
    if (floorSelect.value) await refreshAvailability();
  } catch (e) {
    addMessage(`Не удалось отменить бронь: ${e.message}`, "error");
  }
}

async function reserveDesk(deskId) {
  const userId = userInput.value.trim();
  if (!userId) {
    addMessage("Войдите в систему для бронирования.", "error");
    return;
  }
  try {
    await apiRequest("/reservations", {
      method: "POST",
      body: JSON.stringify({
        desk_id: deskId,
        user_id: userId,
        reservation_date: dateInput.value,
        start_time: startInput.value,
        end_time: endInput.value,
      }),
    });
    addMessage("Бронь успешно создана.", "success");
    await refreshAvailability();
    await loadMyBookings();
  } catch (e) {
    addMessage(`Не удалось создать бронь: ${e.message}`, "error");
  }
}

// ── Render ───────────────────────────────────────────────────────────────────
function renderPolicies() {
  policyList.innerHTML = "";
  if (!state.policies.length) {
    policyEmpty.textContent = "Для выбранного офиса пока не задано правил.";
    policyEmpty.classList.remove("hidden");
    policyList.classList.add("hidden");
    return;
  }
  policyEmpty.classList.add("hidden");
  policyList.classList.remove("hidden");
  for (const p of state.policies) {
    const card = document.createElement("article");
    card.className = "policy-card";
    card.innerHTML = `
      <h3>${p.name}</h3>
      <div class="policy-details">
        <div>Бронирование заранее: от ${p.min_days_ahead} до ${p.max_days_ahead} дней.</div>
        <div>Длительность: от ${p.min_duration_minutes} до ${p.max_duration_minutes} минут.</div>
        <div>Окно no-show: ${p.no_show_timeout_minutes} минут.</div>
      </div>`;
    policyList.append(card);
  }
}

function resetFloorPlan(msg) {
  floorPlanFigure.classList.add("hidden");
  floorPlanPlaceholder.textContent = msg;
  floorPlanPlaceholder.classList.remove("hidden");
  floorPlanOverlay.innerHTML = "";
}

function renderFloorPlan(floor) {
  if (!floor?.plan_url) { resetFloorPlan("План этажа не загружен."); return; }
  floorPlanImage.src = floor.plan_url;
  floorPlanCaption.textContent = `План: ${floor.name}`;
  floorPlanPlaceholder.classList.add("hidden");
  floorPlanFigure.classList.remove("hidden");
  renderPlanMarkers(floorPlanOverlay, state.desks);
}

function renderPlanMarkers(container, desks) {
  if (!container) return;
  container.innerHTML = "";
  desks
    .filter((d) => typeof d.position_x === "number" && typeof d.position_y === "number")
    .forEach((d) => {
      const m = document.createElement("div");
      m.className = "plan-marker";
      m.style.left = `${d.position_x * 100}%`;
      m.style.top = `${d.position_y * 100}%`;
      m.title = d.label;
      m.textContent = d.label.slice(0, 2).toUpperCase();
      container.append(m);
    });
}

function renderDesks() {
  desksContainer.innerHTML = "";
  if (!state.desks.length) {
    desksContainer.innerHTML = '<div class="empty">На этом этаже пока нет мест.</div>';
    renderPlanMarkers(floorPlanOverlay, []);
    return;
  }
  for (const desk of state.desks) {
    const el = deskTemplate.content.cloneNode(true);
    el.querySelector(".desk-title").textContent = desk.label;
    el.querySelector(".desk-type").textContent = desk.type === "fixed" ? "Закреплённое" : "Гибкое";
    el.querySelector(".desk-zone").textContent = desk.zone || "Не указано";
    el.querySelector(".desk-assigned").textContent = desk.assigned_to || "Нет";
    const badge = el.querySelector(".badge");
    const avail = state.availability.get(desk.id);
    badge.textContent = avail?.available ? "Доступно" : "Занято";
    badge.classList.add(avail?.available ? "available" : "busy");
    const btn = el.querySelector(".reserve");
    btn.disabled = !avail?.available;
    btn.addEventListener("click", () => reserveDesk(desk.id));
    desksContainer.append(el);
  }
  renderPlanMarkers(floorPlanOverlay, state.desks);
}

function checkinBadge(checkedInAt) {
  const badge = document.createElement("span");
  if (checkedInAt) {
    badge.className = "badge checked-in";
    badge.textContent = `Отмечен в ${checkedInAt.slice(11, 16)}`;
  } else {
    badge.className = "badge not-checked-in";
    badge.textContent = "Нет отметки";
  }
  return badge;
}

function renderMyBookings(bookings) {
  myBookingsContainer.innerHTML = "";
  if (!bookings.length) {
    myBookingsContainer.innerHTML = '<div class="empty">Активных бронирований нет.</div>';
    return;
  }
  const list = document.createElement("div");
  list.className = "booking-list";
  for (const b of bookings) {
    const item = document.createElement("div");
    item.className = "booking-item";

    const info = document.createElement("div");
    info.className = "booking-info";

    const title = document.createElement("strong");
    title.textContent = `Место #${b.desk_id}`;

    const meta = document.createElement("span");
    meta.textContent = `${b.reservation_date} · ${b.start_time?.slice(0, 5) ?? "весь день"} – ${b.end_time?.slice(0, 5) ?? ""}`;

    info.append(title, meta, checkinBadge(b.checked_in_at));

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "button danger small";
    cancelBtn.textContent = "Отменить";
    cancelBtn.addEventListener("click", () => cancelBooking(b.id));

    item.append(info, cancelBtn);
    list.append(item);
  }
  myBookingsContainer.append(list);
}

// ── Auth toggle ──────────────────────────────────────────────────────────────
function switchAuthMode(loginMode) {
  isLoginMode = loginMode;
  if (loginMode) {
    authTitle.textContent = "Вход в систему";
    formLogin.classList.remove("hidden");
    formRegister.classList.add("hidden");
    authSubmitBtn.textContent = "Войти";
    authToggleText.textContent = "Нет аккаунта?";
    authToggleLink.textContent = "Зарегистрироваться";
  } else {
    authTitle.textContent = "Регистрация";
    formLogin.classList.add("hidden");
    formRegister.classList.remove("hidden");
    authSubmitBtn.textContent = "Зарегистрироваться";
    authToggleText.textContent = "Уже есть аккаунт?";
    authToggleLink.textContent = "Войти";
  }
  authError.classList.add("hidden");
}

// ── Events ───────────────────────────────────────────────────────────────────
officeSelect.addEventListener("change", (e) => {
  loadFloors(e.target.value);
  loadPolicies(e.target.value);
});

floorSelect.addEventListener("change", (e) => {
  const floorId = e.target.value;
  loadDesks(floorId);
  const floor = state.floors.find((f) => String(f.id) === String(floorId));
  renderFloorPlan(floor);
});

refreshButton.addEventListener("click", () => refreshAvailability());
refreshBookings.addEventListener("click", () => loadMyBookings());

authToggleLink.addEventListener("click", (e) => {
  e.preventDefault();
  switchAuthMode(!isLoginMode);
});

authSubmitBtn.addEventListener("click", async () => {
  authError.classList.add("hidden");
  if (isLoginMode) {
    const username = loginUsername.value.trim();
    const password = loginPassword.value;
    if (!username || !password) {
      authError.textContent = "Введите логин и пароль.";
      authError.classList.remove("hidden");
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
      addMessage(`Добро пожаловать, ${username}!`, "success");
      await loadOffices();
      await loadMyBookings();
    } catch (e) {
      authError.textContent = e.message;
      authError.classList.remove("hidden");
    }
  } else {
    const username = regUsername.value.trim();
    const email = regEmail.value.trim();
    const password = regPassword.value;
    if (!username || !email || !password) {
      authError.textContent = "Заполните все поля.";
      authError.classList.remove("hidden");
      return;
    }
    try {
      const resp = await fetch(`${API_BASE}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email, password, role: "user" }),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.detail || `Ошибка ${resp.status}`);
      }
      // Auto-login after registration
      const form = new URLSearchParams({ username, password });
      const loginResp = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form,
      });
      const data = await loginResp.json();
      setToken(data.access_token, username);
      addMessage(`Аккаунт создан. Добро пожаловать, ${username}!`, "success");
      await loadOffices();
      await loadMyBookings();
    } catch (e) {
      authError.textContent = e.message;
      authError.classList.remove("hidden");
    }
  }
});

loginPassword.addEventListener("keydown", (e) => {
  if (e.key === "Enter") authSubmitBtn.click();
});

logoutBtn.addEventListener("click", () => {
  clearToken();
  addMessage("Вы вышли из системы.", "info");
});

// ── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  await checkApi();
  const token = getToken();
  const username = localStorage.getItem("user_username");
  if (token && username) {
    try {
      await apiRequest("/health");
      showUserUI(username);
      await loadOffices();
      await loadMyBookings();
    } catch {
      clearToken();
    }
  } else {
    showLoginOverlay();
  }
}

init();
