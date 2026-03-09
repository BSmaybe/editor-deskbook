const API_BASE = "/api";

// JWT expiry check
function isTokenExpired(token) {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.exp * 1000 < Date.now();
  } catch { return true; }
}

// Auth guard
const _token = localStorage.getItem("user_token");
const _username = localStorage.getItem("user_username");
if (!_token || !_username || isTokenExpired(_token)) {
  localStorage.removeItem("user_token");
  localStorage.removeItem("user_username");
  window.location.href = "./login.html";
}

// DOM refs
const officeSelect        = document.getElementById("office-select");
const floorSelect         = document.getElementById("floor-select");
const messages            = document.getElementById("messages");
const refreshBookings     = document.getElementById("refresh-bookings");
const policyList          = document.getElementById("policy-list");
const policiesAccordion   = document.getElementById("policies-accordion");
const floorPlanCard       = document.getElementById("floor-plan-card");
const floorPlanImage      = document.getElementById("floor-plan-image");
const floorPlanOverlay    = document.getElementById("floor-plan-overlay");
const deskSvgOverlay      = document.getElementById("desk-svg-overlay");
const mapZoomWrapper      = document.getElementById("map-zoom-wrapper");
const mapZoomContent      = document.getElementById("map-zoom-content");
const mapSidePanel        = document.getElementById("desk-detail-content");
const deskDetailCard      = document.getElementById("desk-detail-card");
const mapControls         = document.getElementById("map-controls");
const userInput           = document.getElementById("user-id");
const dateInput           = document.getElementById("reservation-date");
const startInput          = document.getElementById("start-time");
const endInput            = document.getElementById("end-time");
const myBookingsContainer = document.getElementById("my-bookings");
const loggedAsEl          = document.getElementById("logged-as");
const logoutBtn           = document.getElementById("logout-btn");

const state = {
  offices: [],
  floors: [],
  desks: [],
  availability: new Map(),
  policies: [],
  floorReservations: [],
  favorites: new Set(),
  team: new Set(),        // usernames of teammates (same department)
  myDepartment: null,     // current user's department
};

// Init user info
userInput.value = _username;
loggedAsEl.textContent = _username;
dateInput.value = new Date().toISOString().slice(0, 10);
const userAvatarEl = document.getElementById("user-avatar");
if (userAvatarEl) userAvatarEl.textContent = _username.slice(0, 2).toUpperCase();

function getToken() {
  return localStorage.getItem("user_token");
}

// ── Notification system ───────────────────────────────────────────────────────

const NOTIF_DURATIONS  = { info: 4500, success: 4500, error: 8000 };
const NOTIF_MAX        = 60;
const NOTIF_STORAGE    = "dk_notif_history";

let _notifHistory  = [];
let _notifUnread   = 0;
let _isDrawerOpen  = false;

function _notifLoad() {
  try {
    const raw = localStorage.getItem(NOTIF_STORAGE);
    if (raw) _notifHistory = JSON.parse(raw).slice(-NOTIF_MAX);
  } catch { _notifHistory = []; }
  _notifUnread = _notifHistory.filter(n => !n.read).length;
  _notifUpdateBadge();
}

function _notifSave() {
  try { localStorage.setItem(NOTIF_STORAGE, JSON.stringify(_notifHistory.slice(-NOTIF_MAX))); } catch {}
}

function _notifUpdateBadge() {
  const badge = document.getElementById("notif-badge");
  const bell  = document.getElementById("notif-bell");
  if (!badge) return;
  if (_notifUnread > 0) {
    badge.textContent  = _notifUnread > 9 ? "9+" : String(_notifUnread);
    badge.style.display = "";
    bell?.classList.add("has-unread");
  } else {
    badge.style.display = "none";
    bell?.classList.remove("has-unread");
  }
}

function _relTime(ts) {
  const diff = Date.now() - ts;
  if (diff < 60_000)       return "только что";
  if (diff < 3_600_000)    return `${Math.floor(diff / 60_000)} мин назад`;
  if (diff < 86_400_000)   return `${Math.floor(diff / 3_600_000)} ч назад`;
  return new Date(ts).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

function _notifRenderDrawer() {
  const body = document.getElementById("notif-drawer-body");
  if (!body) return;
  if (!_notifHistory.length) {
    body.innerHTML = '<p class="empty" style="padding:40px 16px">Нет уведомлений</p>';
    return;
  }
  body.innerHTML = "";
  for (let i = _notifHistory.length - 1; i >= 0; i--) {
    const n   = _notifHistory[i];
    const el  = document.createElement("div");
    el.className = `notif-item notif-item-${n.type}${n.read ? " is-read" : ""}`;
    el.innerHTML = `
      <span class="notif-item-dot"></span>
      <span class="notif-item-text">${n.text}</span>
      <span class="notif-item-time">${_relTime(n.ts)}</span>`;
    body.append(el);
  }
}

function openNotifDrawer() {
  _isDrawerOpen = true;
  _notifHistory.forEach(n => n.read = true);
  _notifUnread = 0;
  _notifSave();
  _notifUpdateBadge();
  _notifRenderDrawer();
  document.getElementById("notif-drawer")?.classList.add("open");
  document.getElementById("notif-backdrop")?.classList.add("open");
}

function closeNotifDrawer() {
  _isDrawerOpen = false;
  document.getElementById("notif-drawer")?.classList.remove("open");
  document.getElementById("notif-backdrop")?.classList.remove("open");
}

function addMessage(text, type = "info") {
  // Save to history
  const entry = { text, type, ts: Date.now(), read: _isDrawerOpen };
  _notifHistory.push(entry);
  if (_notifHistory.length > NOTIF_MAX) _notifHistory.shift();
  if (!_isDrawerOpen) _notifUnread++;
  _notifSave();
  _notifUpdateBadge();
  if (_isDrawerOpen) _notifRenderDrawer();

  // Show toast
  const container = messages;
  if (!container) return;

  // Cap visible toasts at 4
  const existing = container.querySelectorAll(".message");
  if (existing.length >= 4) existing[existing.length - 1].remove();

  const duration = NOTIF_DURATIONS[type] ?? 4500;
  const item = document.createElement("div");
  item.className = `message ${type}`;

  const textNode = document.createElement("span");
  textNode.className = "toast-text";
  textNode.textContent = text;

  const closeBtn = document.createElement("button");
  closeBtn.className = "toast-close";
  closeBtn.innerHTML = "✕";

  const bar = document.createElement("div");
  bar.className = "toast-bar";
  bar.style.animationDuration = `${duration}ms`;

  item.append(textNode, closeBtn, bar);
  container.prepend(item);

  const dismiss = () => {
    item.style.opacity = "0";
    item.style.transform = "translateX(10px)";
    setTimeout(() => item.remove(), 220);
  };

  let timer = setTimeout(dismiss, duration);
  item.addEventListener("mouseenter", () => { clearTimeout(timer); bar.style.animationPlayState = "paused"; });
  item.addEventListener("mouseleave", () => { timer = setTimeout(dismiss, 1800); bar.style.animationPlayState = "running"; });
  closeBtn.addEventListener("click",   () => { clearTimeout(timer); dismiss(); });
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

async function loadFavorites() {
  try {
    const desks = await apiRequest("/users/me/favorites");
    state.favorites = new Set(desks.map(d => d.id));
  } catch {
    state.favorites = new Set();
  }
}

async function loadTeam() {
  try {
    const members = await apiRequest("/users/team");
    state.team = new Set(members.map(m => m.username));
    // derive my department from my own profile
    const me = await apiRequest(`/users/${encodeURIComponent(_username)}`);
    state.myDepartment = me.department || null;
  } catch {
    state.team = new Set();
    state.myDepartment = null;
  }
}

async function checkApi() {
  try {
    await apiRequest("/health");
  } catch {
    addMessage("API недоступно. Проверьте соединение.", "error");
  }
}

async function loadOffices() {
  officeSelect.innerHTML = '<option value="">Выберите офис</option>';
  try {
    state.offices = await apiRequest("/offices");
    for (const o of state.offices) {
      const opt = document.createElement("option");
      opt.value = o.id;
      opt.textContent = o.address ? `${o.name} — ${o.address}` : o.name;
      officeSelect.append(opt);
    }
  } catch (e) {
    addMessage(`Офисы: ${e.message}`, "error");
  }
}

async function loadFloors(officeId) {
  floorSelect.innerHTML = '<option value="">Выберите этаж</option>';
  floorSelect.disabled = true;
  renderFloorPlan(null);
  hideColleagues();
  if (!officeId) return;
  try {
    state.floors = await apiRequest(`/floors?office_id=${officeId}`);
    for (const f of state.floors) {
      const opt = document.createElement("option");
      opt.value = f.id;
      opt.textContent = f.plan_url ? `${f.name} ✦` : f.name;
      floorSelect.append(opt);
    }
    floorSelect.disabled = false;
  } catch (e) {
    addMessage(`Этажи: ${e.message}`, "error");
  }
}

async function loadPolicies(officeId) {
  policiesAccordion?.classList.remove("open");
  const toggleBtn = document.getElementById("policies-toggle");
  if (toggleBtn) toggleBtn.textContent = "Правила ▾";
  policyList.innerHTML = "";
  if (!officeId) return;
  try {
    state.policies = await apiRequest(`/policies?office_id=${officeId}`);
    if (state.policies.length) {
      renderPolicies();
    }
  } catch (e) {
    addMessage(`Политики: ${e.message}`, "error");
  }
}

async function loadDesks(floorId) {
  if (!floorId) return;
  try {
    state.desks = await apiRequest(`/desks?floor_id=${floorId}`);
    await refreshAvailability();
  } catch (e) {
    addMessage(`Места: ${e.message}`, "error");
  }
}

async function refreshAvailability() {
  const rd = dateInput.value;
  const st = startInput.value;
  const et = endInput.value;
  if (!rd || !st || !et) {
    addMessage("Заполните дату и время.", "error");
    return;
  }
  state.availability.clear();

  const availFetch = Promise.all(
    state.desks.map(async (desk) => {
      const qs = new URLSearchParams({
        desk_id: String(desk.id),
        reservation_date: rd,
        start_time: st,
        end_time: et,
      });
      const uid = userInput.value.trim();
      if (uid) qs.append("user_id", uid);
      try {
        const result = await apiRequest(`/availability?${qs}`);
        state.availability.set(desk.id, result);
      } catch (e) {
        state.availability.set(desk.id, { available: false, reason: e.message });
      }
    })
  );

  const floorId = floorSelect.value;
  const resvFetch = (floorId
    ? apiRequest(`/floors/${floorId}/reservations?date=${rd}`)
    : Promise.resolve([])
  ).then((all) => {
    state.floorReservations = all;
  }).catch(() => { state.floorReservations = []; });

  await Promise.all([availFetch, resvFetch]);
  renderPlanMarkersFiltered();
  renderColleagues();
}

async function loadMyBookings() {
  try {
    const all = await apiRequest("/reservations");
    const mine = all.filter(
      (r) => r.user_id === userInput.value && r.status === "active"
    );
    renderMyBookings(mine);
  } catch (e) {
    addMessage(`Бронирования: ${e.message}`, "error");
  }
}

async function cancelBooking(id) {
  if (!confirm("Отменить бронирование?")) return;
  try {
    await apiRequest(`/reservations/${id}/cancel`, { method: "POST" });
    addMessage("Бронирование отменено.", "success");
    await loadMyBookings();
    if (floorSelect.value) await refreshAvailability();
  } catch (e) {
    addMessage(`Ошибка: ${e.message}`, "error");
  }
}

async function reserveDesk(deskId) {
  const userId = userInput.value.trim();
  if (!userId) {
    addMessage("Войдите в систему.", "error");
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
    addMessage("Бронь создана!", "success");
    await refreshAvailability();
    await loadMyBookings();
  } catch (e) {
    addMessage(`Ошибка: ${e.message}`, "error");
  }
}

async function reserveBatch(deskId, dates, startTime, endTime) {
  if (!dates.length) {
    addMessage("Выберите хотя бы один день и диапазон дат.", "error");
    return;
  }
  try {
    const result = await apiRequest("/reservations/batch", {
      method: "POST",
      body: JSON.stringify({ desk_id: deskId, dates, start_time: startTime, end_time: endTime }),
    });
    const created = result.created?.length ?? 0;
    const skipped = result.skipped?.length ?? 0;
    if (skipped > 0) {
      addMessage(`Создано ${created} броней, пропущено ${skipped} (конфликты).`, "info");
    } else {
      addMessage(`Серия создана: ${created} бронирований.`, "success");
    }
    await refreshAvailability();
    await loadMyBookings();
  } catch (e) {
    addMessage(`Ошибка серии: ${e.message}`, "error");
  }
}

function renderPolicies() {
  policyList.innerHTML = "";
  for (const p of state.policies) {
    const card = document.createElement("div");
    card.className = "policy-card";
    card.innerHTML = `
      <h3>${p.name}</h3>
      <div class="policy-details">
        <div>Заранее: ${p.min_days_ahead}–${p.max_days_ahead} дней</div>
        <div>Длительность: ${p.min_duration_minutes ?? "—"}–${p.max_duration_minutes ?? "—"} мин</div>
        <div>No-show таймаут: ${p.no_show_timeout_minutes} мин</div>
      </div>`;
    policyList.append(card);
  }
}

// ── Zoom / Pan ────────────────────────────────────────────────────────────────

let _zoom = 1, _tx = 0, _ty = 0, _isPanning = false, _panStart = null, _panOffset = null, _minZoom = 1;
let _zoomInitialized = false;
// Explicit image bounds (set by fitFloorPlan, used by centerOnMarker)
let _imgX = 0, _imgY = 0, _imgW = 0, _imgH = 0;
// Fit mode: 'contain' fits whole image without upscaling (default), 'height' fills container height
let _fitMode = 'contain';
// Pending desk to focus after floor plan loads (used by navigateToDesk)
let _pendingFocusDeskId = null;

function _applyTransform() {
  if (mapZoomContent) {
    mapZoomContent.style.transform = `translate(${_tx}px, ${_ty}px)`;
  }
  // Resize frame instead of CSS scale → browser re-rasterizes image at zoom size (no blur)
  const frame = document.getElementById("map-image-frame");
  if (frame && _imgW) {
    frame.style.width  = Math.round(_imgW * _zoom) + "px";
    frame.style.height = Math.round(_imgH * _zoom) + "px";
  }
  const ind = document.getElementById("zoom-indicator");
  if (ind) ind.textContent = Math.round(_zoom * 100) + "%";
}

function initZoomPan() {
  if (!mapZoomWrapper || !mapZoomContent) return;
  _zoom = 1; _tx = 0; _ty = 0; _minZoom = 1;
  _applyTransform();

  if (_zoomInitialized) return; // attach listeners only once
  _zoomInitialized = true;

  mapZoomWrapper.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = mapZoomWrapper.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const prevZoom = _zoom;
    _zoom = Math.min(4, Math.max(_minZoom, _zoom * (e.deltaY < 0 ? 1.15 : 0.87)));
    // keep point under cursor fixed: translate(Tx,Ty) scale(Z) → cursor = (cx,cy) in wrapper
    // content point = (cx - Tx) / prevZ, new Tx = cx - contentX * newZ
    _tx = cx - (cx - _tx) / prevZoom * _zoom;
    _ty = cy - (cy - _ty) / prevZoom * _zoom;
    _applyTransform();
    mapZoomContent.style.cursor = _zoom > _minZoom ? "grab" : "default";
  }, { passive: false });

  mapZoomWrapper.addEventListener("mousedown", (e) => {
    if (_zoom <= _minZoom) return;
    _isPanning = true;
    _panStart  = { x: e.clientX, y: e.clientY };
    _panOffset = { x: _tx, y: _ty };
    mapZoomContent.style.cursor = "grabbing";
    e.preventDefault();
  });

  window.addEventListener("mousemove", (e) => {
    if (!_isPanning) return;
    _tx = _panOffset.x + (e.clientX - _panStart.x);
    _ty = _panOffset.y + (e.clientY - _panStart.y);
    _applyTransform();
  });

  window.addEventListener("mouseup", () => {
    if (!_isPanning) return;
    _isPanning = false;
    mapZoomContent.style.cursor = _zoom > _minZoom ? "grab" : "default";
  });

  document.getElementById("zoom-in-btn")?.addEventListener("click", () => {
    const cx = mapZoomWrapper.clientWidth / 2, cy = mapZoomWrapper.clientHeight / 2;
    const prev = _zoom;
    _zoom = Math.min(4, _zoom * 1.3);
    _tx = cx - (cx - _tx) / prev * _zoom;
    _ty = cy - (cy - _ty) / prev * _zoom;
    _applyTransform();
    mapZoomContent.style.cursor = "grab";
  });
  document.getElementById("zoom-out-btn")?.addEventListener("click", () => {
    const cx = mapZoomWrapper.clientWidth / 2, cy = mapZoomWrapper.clientHeight / 2;
    const prev = _zoom;
    _zoom = Math.max(_minZoom, _zoom / 1.3);
    _tx = cx - (cx - _tx) / prev * _zoom;
    _ty = cy - (cy - _ty) / prev * _zoom;
    _applyTransform();
    if (_zoom <= _minZoom) mapZoomContent.style.cursor = "default";
  });
  document.getElementById("focus-my-desk-btn")?.addEventListener("click", () => {
    const myResv = state.floorReservations.find(r => r.user_id === _username && r.status === "active");
    if (!myResv) { addMessage("Нет активной брони на этом этаже", "info"); return; }
    highlightDesk(myResv.desk_id);
    centerOnMarker(myResv.desk_id);
    const markerEl = deskSvgOverlay?.querySelector(`[data-desk-id="${myResv.desk_id}"]`);
    const deskObj  = state.desks.find(d => d.id === myResv.desk_id);
    if (markerEl && deskObj) showSidePanel(markerEl, deskObj);
  });

  document.getElementById("fit-mode-btn")?.addEventListener("click", () => {
    _fitMode = _fitMode === 'height' ? 'contain' : 'height';
    fitFloorPlan();
  });

  // Re-fit when wrapper resizes (window resize)
  let _fitRO;
  new ResizeObserver(() => {
    clearTimeout(_fitRO);
    _fitRO = setTimeout(() => { if (floorPlanImage.naturalWidth) fitFloorPlan(); }, 80);
  }).observe(mapZoomWrapper);
}

// ── Fit image to wrapper ──────────────────────────────────────────────────────

function fitFloorPlan() {
  if (!floorPlanImage.naturalWidth || !mapZoomWrapper.clientWidth || !mapZoomWrapper.clientHeight) return;
  const frame = document.getElementById("map-image-frame");
  if (!frame) return;

  const wW = mapZoomWrapper.clientWidth;
  const wH = mapZoomWrapper.clientHeight;
  const nW = floorPlanImage.naturalWidth;
  const nH = floorPlanImage.naturalHeight;

  if (_fitMode === 'height') {
    // Fill container height exactly; frame may be wider than wrapper → pan
    _imgH = wH;
    _imgW = Math.round(nW * wH / nH);
  } else {
    // Contain: fit entire image, cap scale at 1.0 (no upscale = no blur)
    if (wW / nW < wH / nH) {
      _imgW = Math.min(nW, wW);
      _imgH = Math.round(_imgW * nH / nW);
    } else {
      _imgH = Math.min(nH, wH);
      _imgW = Math.round(_imgH * nW / nH);
    }
  }

  // Frame always at (0,0) in content space; centering done via _tx/_ty translate
  _imgX = 0; _imgY = 0;
  frame.style.left   = "0px";
  frame.style.top    = "0px";
  frame.style.width  = _imgW + "px";
  frame.style.height = _imgH + "px";
  frame.style.display = "block";

  // minZoom: allow zoom-out to see full frame when it overflows the wrapper
  _minZoom = Math.min(1.0, wW / Math.max(_imgW, 1), wH / Math.max(_imgH, 1));
  _zoom = 1.0;
  // Center image in wrapper via translate (no CSS scale)
  _tx = Math.round((wW - _imgW) / 2);
  _ty = Math.round((wH - _imgH) / 2);
  _applyTransform();

  if (mapZoomContent) mapZoomContent.style.cursor = _zoom > _minZoom ? "grab" : "default";

  const btn = document.getElementById("fit-mode-btn");
  if (btn) {
    btn.textContent = _fitMode === 'height' ? '⊠' : '↕';
    btn.title = _fitMode === 'height'
      ? 'По высоте — нажать: Вписать целиком'
      : 'Вписать целиком — нажать: По высоте';
    btn.classList.toggle("active", _fitMode === 'contain');
  }

  // Focus pending desk after navigation (navigateToDesk sets this)
  if (_pendingFocusDeskId) {
    const deskId = _pendingFocusDeskId;
    _pendingFocusDeskId = null;
    setTimeout(() => {
      highlightDesk(deskId);
      centerOnMarker(deskId);
      const markerEl = deskSvgOverlay?.querySelector(`[data-desk-id="${deskId}"]`);
      const deskObj  = state.desks.find(d => d.id === deskId);
      if (markerEl && deskObj) showSidePanel(markerEl, deskObj);
    }, 50);
  }
}

// ── Floor plan ───────────────────────────────────────────────────────────────

// State for the currently shown map revision (SVG-based)
let _currentRevision = null;

async function renderFloorPlan(floor) {
  document.getElementById("floor-plan-placeholder")?.remove();
  closeSidePanel();
  _currentRevision = null;

  const imageFrame = document.getElementById("map-image-frame");

  // Try to load published SVG revision
  if (floor?.id) {
    try {
      const resp = await fetch(`${API_BASE}/floors/${floor.id}/map/published`, {
        headers: { Authorization: "Bearer " + getToken() },
      });
      if (resp.ok) {
        const rev = await resp.json();
        if (rev.plan_svg) {
          _currentRevision = rev;
          _renderInlineSVGFloor(rev, imageFrame);
          return;
        }
      }
    } catch { /* fall through to PNG */ }
  }

  // PNG fallback
  if (!floor?.plan_url) {
    if (imageFrame) imageFrame.style.display = "none";
    if (deskSvgOverlay) deskSvgOverlay.innerHTML = "";
    if (mapControls) mapControls.style.display = "none";
    const ph = document.createElement("p");
    ph.id = "floor-plan-placeholder";
    ph.className = "empty";
    ph.style.cssText = "padding:60px 16px;text-align:center";
    ph.textContent = floor
      ? "У этого этажа нет плана."
      : "Выберите офис и этаж для отображения карты.";
    mapZoomWrapper.appendChild(ph);
    return;
  }

  if (imageFrame) imageFrame.style.display = "none"; // hidden until fitFloorPlan sizes it
  floorPlanImage.crossOrigin = "anonymous";
  floorPlanImage.onload = fitFloorPlan;
  floorPlanImage.src = floor.plan_url;
  if (mapControls) mapControls.style.display = "";
  initZoomPan();
  renderPlanMarkersFiltered();
}

function _renderInlineSVGFloor(rev, imageFrame) {
  // Hide the PNG image frame
  if (imageFrame) imageFrame.style.display = "none";
  if (deskSvgOverlay) deskSvgOverlay.innerHTML = "";
  if (mapControls) mapControls.style.display = "";

  // Remove or reuse inline SVG container
  let svgWrap = document.getElementById("inline-svg-wrap");
  if (!svgWrap) {
    svgWrap = document.createElement("div");
    svgWrap.id = "inline-svg-wrap";
    svgWrap.style.cssText = "width:100%;height:100%;position:relative;overflow:hidden";
    mapZoomWrapper.appendChild(svgWrap);
  }

  // Parse viewBox
  const vbMatch = rev.plan_svg.match(/viewBox\s*=\s*["']([^"']+)["']/);
  const vbParts = vbMatch ? vbMatch[1].trim().split(/[\s,]+/).map(Number) : [0, 0, 1000, 1000];
  const [vx, vy, vw, vh] = vbParts.length >= 4 ? vbParts : [0, 0, 1000, 1000];

  // Build a combined SVG: floor plan + zones + desk markers
  const SPACE_COLORS_CLIENT = {
    desk: "#2563eb", meeting_room: "#7c3aed", call_room: "#0891b2",
    open_space: "#16a34a", lounge: "#d97706",
  };
  const markerR = Math.max(4, vw * 0.008);

  // Zones markup
  let zonesHtml = "";
  if (rev.zones && rev.zones.length) {
    for (const zone of rev.zones) {
      if (!zone.points || zone.points.length < 3) continue;
      const color = zone.color || SPACE_COLORS_CLIENT[zone.space_type] || "#16a34a";
      const pts = zone.points.map(p => `${p.x},${p.y}`).join(" ");
      const cx = zone.points.reduce((s, p) => s + p.x, 0) / zone.points.length;
      const cy = zone.points.reduce((s, p) => s + p.y, 0) / zone.points.length;
      zonesHtml += `<polygon points="${pts}" fill="${color}" fill-opacity="0.2" stroke="${color}" stroke-width="1.5" pointer-events="none"/>`;
      zonesHtml += `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" fill="${color}" font-size="${Math.max(8, vw * 0.012)}" pointer-events="none">${_escSvgText(zone.name)}</text>`;
    }
  }

  // Desk markers from revision
  let markersHtml = "";
  if (rev.desks && rev.desks.length) {
    for (const desk of rev.desks) {
      if (desk.x == null) continue;
      const cx = desk.x + (desk.w || 30) / 2;
      const cy = desk.y + (desk.h || 20) / 2;
      const color = SPACE_COLORS_CLIENT[desk.space_type] || "#2563eb";
      const deskId = desk.id || desk.label;
      markersHtml += `<g class="desk-tile client-marker" data-desk-id="${_escAttr(deskId)}" data-desk-label="${_escAttr(desk.label)}" cursor="pointer">` +
        `<circle cx="${cx}" cy="${cy}" r="${markerR}" fill="${color}" stroke="white" stroke-width="2.5"/>` +
        `</g>`;
    }
  }

  // Inject combined SVG
  const parser = new DOMParser();
  const doc = parser.parseFromString(rev.plan_svg, "image/svg+xml");
  const srcSvg = doc.documentElement;
  const innerContent = srcSvg.innerHTML;

  svgWrap.innerHTML = `
    <svg id="inline-floor-svg" viewBox="${vx} ${vy} ${vw} ${vh}"
         style="width:100%;height:100%;display:block;user-select:none"
         xmlns="http://www.w3.org/2000/svg">
      <g id="if-floorplan" pointer-events="none">${innerContent}</g>
      <g id="if-zones">${zonesHtml}</g>
      <g id="if-markers">${markersHtml}</g>
    </svg>`;

  // Attach click handlers to markers
  const inlineSvg = document.getElementById("inline-floor-svg");
  inlineSvg?.querySelectorAll(".client-marker").forEach(marker => {
    const deskLabel = marker.dataset.deskLabel;
    marker.addEventListener("click", () => {
      // Find matching legacy desk by label or id
      const desk = state.desks.find(d => d.label === deskLabel) ||
                   state.desks.find(d => String(d.id) === String(marker.dataset.deskId));
      if (desk) {
        showSidePanel(marker, desk);
      }
    });
  });

  // Basic zoom/pan on the inline SVG via viewBox manipulation
  _initInlineSvgZoomPan(inlineSvg, vx, vy, vw, vh);
}

function _escSvgText(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function _escAttr(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function _initInlineSvgZoomPan(svg, origX, origY, origW, origH) {
  if (!svg) return;
  let vx = origX, vy = origY, vw = origW, vh = origH;
  let isPanning = false, panStart = null;

  function applyVB() {
    svg.setAttribute("viewBox", `${vx} ${vy} ${vw} ${vh}`);
  }

  svg.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = svg.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    const ptX = vx + px * vw, ptY = vy + py * vh;
    const factor = e.deltaY < 0 ? 0.85 : 1.15;
    const nw = Math.max(origW / 8, Math.min(origW / 0.5, vw * factor));
    const nh = origH * nw / origW;
    vx = ptX - px * nw;
    vy = ptY - py * nh;
    vw = nw; vh = nh;
    applyVB();
  }, { passive: false });

  svg.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".client-marker")) return;
    isPanning = true;
    panStart = { clientX: e.clientX, clientY: e.clientY, vx, vy };
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener("pointermove", (e) => {
    if (!isPanning || !panStart) return;
    const rect = svg.getBoundingClientRect();
    const dx = -(e.clientX - panStart.clientX) / rect.width  * vw;
    const dy = -(e.clientY - panStart.clientY) / rect.height * vh;
    vx = panStart.vx + dx;
    vy = panStart.vy + dy;
    applyVB();
  });
  svg.addEventListener("pointerup", () => { isPanning = false; panStart = null; });
}

// ── Side panel ───────────────────────────────────────────────────────────────

let _selectedDeskId = null;

function closeSidePanel() {
  _selectedDeskId = null;
  deskSvgOverlay?.querySelectorAll(".desk-tile.selected")
    .forEach(m => m.classList.remove("selected"));
  if (mapSidePanel) mapSidePanel.innerHTML = "";
  const emptyEl = document.getElementById("desk-detail-empty");
  if (emptyEl) emptyEl.style.display = "";
}

function showSidePanel(marker, desk) {
  deskSvgOverlay?.querySelectorAll(".desk-tile.selected")
    .forEach(m => m.classList.remove("selected"));

  // Toggle off if same desk clicked again
  if (_selectedDeskId === desk.id) {
    closeSidePanel();
    return;
  }
  _selectedDeskId = desk.id;
  marker.classList.add("selected");
  const emptyEl = document.getElementById("desk-detail-empty");
  if (emptyEl) emptyEl.style.display = "none";

  const avail  = state.availability.get(desk.id);
  const myResv = state.floorReservations.find(
    (r) => r.desk_id === desk.id && r.user_id === _username && r.status === "active"
  );
  const booked = state.floorReservations.find(
    (r) => r.desk_id === desk.id && r.status === "active"
  );

  const SPACE_LABELS = {
    desk: "Рабочий стол", meeting_room: "Переговорная",
    call_room: "Call-room", open_space: "Open Space", lounge: "Лаунж",
  };
  const spaceLabel = SPACE_LABELS[desk.space_type] ?? desk.space_type ?? "Место";
  const typeLabel  = desk.type === "fixed" ? "Закреплённое" : "Гибкое";

  let statusHtml;
  if (myResv) {
    statusHtml = `<span class="badge" style="background:var(--primary-light);color:var(--primary);border:1px solid var(--primary-border)">Моё</span>`;
  } else if (avail?.available) {
    statusHtml = `<span class="badge available">Доступно</span>`;
  } else {
    statusHtml = `<span class="badge busy">Занято</span>`;
  }

  let bookedHtml = "";
  if (booked && !myResv) {
    bookedHtml = `<div class="side-panel-meta">
      <i data-lucide="user" style="width:12px;height:12px"></i>
      ${booked.user_id} · ${booked.start_time?.slice(0, 5) ?? "?"} – ${booked.end_time?.slice(0, 5) ?? "?"}
    </div>
    <div style="display:flex;gap:6px;margin-top:10px">
      <button class="btn btn-secondary btn-sm" id="_sp_route" style="flex:1">
        <i data-lucide="route" style="width:12px;height:12px"></i> Маршрут
      </button>
      <button class="btn btn-secondary btn-sm" id="_sp_profile" data-username="${booked.user_id}" style="flex:1">
        <i data-lucide="user-circle" style="width:12px;height:12px"></i> Профиль
      </button>
    </div>`;
  }

  let actionHtml = "";
  if (avail?.available) {
    actionHtml = `<button class="btn btn-primary btn-sm" id="_sp_book" style="width:100%">Забронировать</button>`;
  } else if (myResv) {
    actionHtml = `<button class="btn btn-danger btn-sm" id="_sp_cancel" data-id="${myResv.id}" style="width:100%">Отменить мою бронь</button>`;
  }

  const isFav = state.favorites.has(desk.id);
  const favBtnHtml = `<button class="btn btn-secondary btn-sm" id="_sp_fav" data-desk-id="${desk.id}" title="${isFav ? "Убрать из избранного" : "В избранное"}" style="font-size:16px;padding:0 8px">${isFav ? "★" : "☆"}</button>`;

  mapSidePanel.innerHTML = `
    <div class="side-panel-header">
      <div>
        <div class="side-panel-title">${desk.label}</div>
        <div class="side-panel-type">${spaceLabel} · ${typeLabel}</div>
      </div>
      <div style="display:flex;align-items:center;gap:6px">${statusHtml}${favBtnHtml}</div>
    </div>
    ${bookedHtml}
    <div id="_sp_colleague_area"></div>
    ${actionHtml ? `<div style="margin-top:12px">${actionHtml}</div>` : ""}`;

  if (window.lucide) lucide.createIcons({ nodes: [mapSidePanel] });

  mapSidePanel.querySelector("#_sp_book")?.addEventListener("click", () => {
    reserveDesk(desk.id);
  });
  mapSidePanel.querySelector("#_sp_cancel")?.addEventListener("click", (e) => {
    cancelBooking(parseInt(e.currentTarget.dataset.id));
  });

  mapSidePanel.querySelector("#_sp_fav")?.addEventListener("click", async (e) => {
    const did = parseInt(e.currentTarget.dataset.deskId);
    const wasFav = state.favorites.has(did);
    try {
      if (wasFav) {
        await apiRequest(`/users/me/favorites/${did}`, { method: "DELETE" });
        state.favorites.delete(did);
      } else {
        await apiRequest(`/users/me/favorites/${did}`, { method: "POST" });
        state.favorites.add(did);
      }
      const markerEl = deskSvgOverlay?.querySelector(`[data-desk-id="${did}"]`);
      if (markerEl) markerEl.classList.toggle("favorite", state.favorites.has(did));
      const btn = mapSidePanel.querySelector("#_sp_fav");
      if (btn) {
        const nowFav = state.favorites.has(did);
        btn.textContent = nowFav ? "★" : "☆";
        btn.title = nowFav ? "Убрать из избранного" : "В избранное";
      }
      addMessage(state.favorites.has(did) ? "Добавлено в избранное" : "Убрано из избранного", "success");
    } catch (err) {
      addMessage(`Ошибка: ${err.message}`, "error");
    }
  });

  mapSidePanel.querySelector("#_sp_route")?.addEventListener("click", (e) => {
    const btn = e.currentTarget;
    if (btn.classList.contains("route-active")) {
      btn.classList.remove("route-active");
      highlightDesk(null);
      document.getElementById("desk-pointer-line")?.remove();
    } else {
      btn.classList.add("route-active");
      highlightDesk(desk.id);
      buildRoute(desk.id);
    }
  });

  mapSidePanel.querySelector("#_sp_profile")?.addEventListener("click", (e) => {
    openProfileModal(e.currentTarget.dataset.username);
  });

  if (booked && booked.user_id !== _username) {
    const target = mapSidePanel.querySelector("#_sp_colleague_area");
    if (target) fetchColleagueCard(booked.user_id, target);
  }

  // ── Recurring booking section (only when desk is available) ──
  if (avail?.available) {
    const recurSection = document.createElement("div");
    recurSection.className = "recur-section";

    const toggleBtn = document.createElement("button");
    toggleBtn.className = "recur-toggle-btn";
    toggleBtn.innerHTML = '<span class="recur-toggle-icon">▶</span> Повторить';

    const recurBody = document.createElement("div");
    recurBody.className = "recur-body";

    // Day-of-week buttons: Mon–Sun (0=Sun in JS, we map to Mon–Sun display)
    const DAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
    // JS getDay(): 0=Sun,1=Mon,...,6=Sat → display order Mon..Sun maps to JS days 1,2,3,4,5,6,0
    const DAY_JS    = [1, 2, 3, 4, 5, 6, 0];

    const _selectedDays = new Set([1, 2, 3, 4, 5]); // default Mon–Fri

    const daysRow = document.createElement("div");
    daysRow.className = "recur-days";

    DAY_LABELS.forEach((label, i) => {
      const dayJs = DAY_JS[i];
      const btn = document.createElement("button");
      btn.className = "recur-day-btn" + (_selectedDays.has(dayJs) ? " active" : "");
      btn.textContent = label;
      btn.title = label;
      btn.type = "button";
      btn.addEventListener("click", () => {
        if (_selectedDays.has(dayJs)) {
          _selectedDays.delete(dayJs);
          btn.classList.remove("active");
        } else {
          _selectedDays.add(dayJs);
          btn.classList.add("active");
        }
      });
      daysRow.append(btn);
    });

    // End-date picker
    const today    = new Date();
    const maxDate  = new Date(today.getTime() + 60 * 24 * 60 * 60 * 1000);
    const minDate  = new Date(today.getTime() + 1  * 24 * 60 * 60 * 1000);
    const fmt = (d) => d.toISOString().slice(0, 10);

    const endRow = document.createElement("div");
    endRow.className = "recur-end-row";

    const endLabel = document.createElement("label");
    endLabel.textContent = "До";

    const endDateInput = document.createElement("input");
    endDateInput.type = "date";
    endDateInput.min  = fmt(minDate);
    endDateInput.max  = fmt(maxDate);
    endDateInput.value = fmt(maxDate);

    endRow.append(endLabel, endDateInput);

    // "Book series" button
    const batchBtn = document.createElement("button");
    batchBtn.className = "btn btn-primary btn-sm";
    batchBtn.style.width = "100%";
    batchBtn.type = "button";
    batchBtn.textContent = "Забронировать серию";

    batchBtn.addEventListener("click", () => {
      const startDate = new Date(dateInput.value + "T00:00:00");
      const endDate   = new Date(endDateInput.value + "T00:00:00");
      const st  = startInput.value;
      const et  = endInput.value;

      if (!endDateInput.value || endDate < minDate) {
        addMessage("Укажите конечную дату (минимум завтра).", "error");
        return;
      }
      if (!_selectedDays.size) {
        addMessage("Выберите хотя бы один день недели.", "error");
        return;
      }

      // Generate dates from startDate (or tomorrow, whichever is later) to endDate
      const dates = [];
      const cursor = new Date(Math.max(startDate.getTime(), minDate.getTime()));
      while (cursor <= endDate) {
        if (_selectedDays.has(cursor.getDay())) {
          dates.push(fmt(cursor));
        }
        cursor.setDate(cursor.getDate() + 1);
      }

      if (!dates.length) {
        addMessage("Нет подходящих дат в выбранном диапазоне.", "info");
        return;
      }

      reserveBatch(desk.id, dates, st, et);
    });

    recurBody.append(daysRow, endRow, batchBtn);

    // Toggle expand/collapse
    toggleBtn.addEventListener("click", () => {
      const isOpen = recurBody.classList.toggle("open");
      toggleBtn.classList.toggle("open", isOpen);
    });

    recurSection.append(toggleBtn, recurBody);
    mapSidePanel.append(recurSection);
  }
}

async function fetchColleagueCard(bookedBy, container) {
  let profile = null;
  try {
    profile = await apiRequest(`/users/${encodeURIComponent(bookedBy)}`);
  } catch {
    // Graceful fallback: show username only
  }

  if (!container.isConnected) return;

  const STATUS_LABELS  = { available: "Доступен", busy: "Занят", away: "Отсутствует" };
  const STATUS_CLASSES = { available: "status-available", busy: "status-busy", away: "status-away" };

  const displayName = profile?.full_name || bookedBy;
  const initials    = displayName.slice(0, 2).toUpperCase();

  const card = document.createElement("div");
  card.className = "colleague-card";

  const avatarEl = document.createElement("div");
  avatarEl.className = "colleague-card-avatar";
  avatarEl.textContent = initials;

  const infoEl = document.createElement("div");
  infoEl.className = "colleague-card-info";

  const nameRow = document.createElement("div");
  nameRow.className = "colleague-card-name";
  nameRow.textContent = displayName;
  infoEl.append(nameRow);

  if (profile?.position) {
    const posRow = document.createElement("div");
    posRow.className = "colleague-card-row";
    posRow.textContent = profile.position;
    infoEl.append(posRow);
  }
  if (profile?.department) {
    const deptRow = document.createElement("div");
    deptRow.className = "colleague-card-row";
    deptRow.textContent = profile.department;
    infoEl.append(deptRow);
  }
  if (profile?.phone) {
    const phoneRow = document.createElement("div");
    phoneRow.className = "colleague-card-row";
    phoneRow.textContent = `📞 ${profile.phone}`;
    infoEl.append(phoneRow);
  }
  if (profile?.user_status && STATUS_LABELS[profile.user_status]) {
    const statusEl = document.createElement("span");
    statusEl.className = `status-badge ${STATUS_CLASSES[profile.user_status]}`;
    statusEl.textContent = STATUS_LABELS[profile.user_status];
    statusEl.style.marginTop = "4px";
    infoEl.append(statusEl);
  }

  card.append(avatarEl, infoEl);
  container.append(card);
}

// ── Profile modal ─────────────────────────────────────────────────────────────

function renderProfileModal(profile, username) {
  const container = document.getElementById("profile-modal");
  if (!container) return;

  const STATUS_LABELS  = { available: "Доступен", busy: "Занят", away: "Отсутствует" };
  const STATUS_CLASSES = { available: "status-available", busy: "status-busy", away: "status-away" };

  const displayName = profile?.full_name || username;
  const initials    = displayName.slice(0, 2).toUpperCase();
  const sub         = [profile?.department, profile?.position].filter(Boolean).join(" · ") || username;
  const statusLabel = profile?.user_status ? STATUS_LABELS[profile.user_status] : null;
  const statusClass = profile?.user_status ? STATUS_CLASSES[profile.user_status] : "";

  container.innerHTML = `
    <div class="profile-modal-header">
      <span class="profile-modal-title">Профиль</span>
      <button class="notif-close-btn" id="profile-modal-close" aria-label="Закрыть">
        <i data-lucide="x" style="width:15px;height:15px"></i>
      </button>
    </div>
    <div class="profile-modal-body">
      <div class="profile-modal-hero">
        <div class="profile-modal-avatar">${initials}</div>
        <div>
          <div class="profile-modal-name">${displayName}</div>
          <div class="profile-modal-sub">${sub}</div>
          ${statusLabel ? `<span class="status-badge ${statusClass}" style="margin-top:6px;display:inline-block">${statusLabel}</span>` : ""}
        </div>
      </div>
      ${profile?.phone ? `<div class="profile-modal-row">
        <i data-lucide="phone" style="width:14px;height:14px;color:var(--text-3)"></i>
        <a href="tel:${profile.phone}">${profile.phone}</a>
      </div>` : ""}
    </div>`;

  if (window.lucide) lucide.createIcons({ nodes: [container] });
  container.querySelector("#profile-modal-close")?.addEventListener("click", closeProfileModal);
}

async function openProfileModal(username) {
  let profile = null;
  try {
    profile = await apiRequest(`/users/${encodeURIComponent(username)}`);
  } catch { /* fallback to username only */ }

  renderProfileModal(profile, username);

  const overlay = document.getElementById("profile-modal-overlay");
  if (!overlay) return;
  overlay.style.display = "flex";
  requestAnimationFrame(() => overlay.classList.add("open"));
}

function closeProfileModal() {
  const overlay = document.getElementById("profile-modal-overlay");
  if (!overlay) return;
  overlay.classList.remove("open");
  overlay.addEventListener("transitionend", () => { overlay.style.display = "none"; }, { once: true });
}

// ── Desk highlight ───────────────────────────────────────────────────────────

let _highlightedDeskId = null;

// A* pathfinding on a downsampled (80×80) copy of the floor plan PNG.
async function computePath(planUrl, x1, y1, x2, y2) {
  const W = 80, H = 80;
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = W; canvas.height = H;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, W, H);
        const px = ctx.getImageData(0, 0, W, H).data;

        const walkable = (gx, gy) => {
          const i = (gy * W + gx) * 4;
          return (px[i] + px[i + 1] + px[i + 2]) / 3 > 160;
        };

        const snap = (fx, fy) => {
          let gx = Math.round(fx * (W - 1)), gy = Math.round(fy * (H - 1));
          if (walkable(gx, gy)) return [gx, gy];
          for (let r = 1; r <= 3; r++) {
            for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
              if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
              const nx = gx + dx, ny = gy + dy;
              if (nx >= 0 && ny >= 0 && nx < W && ny < H && walkable(nx, ny)) return [nx, ny];
            }
          }
          return [gx, gy];
        };

        const [sx, sy] = snap(x1, y1);
        const [ex, ey] = snap(x2, y2);
        const heur = (x, y) => Math.abs(x - ex) + Math.abs(y - ey);
        const key  = (x, y) => y * W + x;

        const heap = [];
        const heapPush = (n) => {
          heap.push(n);
          let i = heap.length - 1;
          while (i > 0) {
            const p = (i - 1) >> 1;
            if (heap[p].f <= heap[i].f) break;
            [heap[p], heap[i]] = [heap[i], heap[p]]; i = p;
          }
        };
        const heapPop = () => {
          const top = heap[0], last = heap.pop();
          if (heap.length) {
            heap[0] = last;
            let i = 0;
            while (true) {
              const l = 2*i+1, r = 2*i+2, n = heap.length;
              let m = i;
              if (l < n && heap[l].f < heap[m].f) m = l;
              if (r < n && heap[r].f < heap[m].f) m = r;
              if (m === i) break;
              [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
            }
          }
          return top;
        };

        const gScore = new Map([[key(sx, sy), 0]]);
        const came   = new Map();
        const closed = new Set();
        heapPush({ x: sx, y: sy, f: heur(sx, sy) });

        const DIRS = [[0,1],[0,-1],[1,0],[-1,0],[1,1],[1,-1],[-1,1],[-1,-1]];
        let found = false;

        while (heap.length) {
          const cur = heapPop();
          const ck = key(cur.x, cur.y);
          if (closed.has(ck)) continue;
          closed.add(ck);
          if (cur.x === ex && cur.y === ey) { found = true; break; }
          if (closed.size > 6000) break;

          const cg = gScore.get(ck) ?? 0;
          for (const [dx, dy] of DIRS) {
            const nx = cur.x + dx, ny = cur.y + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            if (!walkable(nx, ny)) continue;
            const nk = key(nx, ny);
            if (closed.has(nk)) continue;
            const ng = cg + (dx && dy ? 1.414 : 1);
            if (ng < (gScore.get(nk) ?? Infinity)) {
              gScore.set(nk, ng);
              came.set(nk, ck);
              heapPush({ x: nx, y: ny, f: ng + heur(nx, ny) });
            }
          }
        }

        if (!found) { resolve(null); return; }

        const pts = [];
        let ck = key(ex, ey);
        const sk = key(sx, sy);
        while (ck !== undefined) {
          pts.unshift({ x: (ck % W) / (W - 1), y: Math.floor(ck / W) / (H - 1) });
          if (ck === sk) break;
          ck = came.get(ck);
        }

        const out = [pts[0]];
        for (let i = 4; i < pts.length - 1; i += 4) out.push(pts[i]);
        out.push(pts[pts.length - 1]);
        resolve(out);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = planUrl;
  });
}

function _drawRouteSvg(points) {
  document.getElementById("desk-pointer-line")?.remove();
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.id = "desk-pointer-line";
  svg.setAttribute("viewBox", "0 0 1 1");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible";
  const poly = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  poly.setAttribute("points", points.map(p => `${p.x},${p.y}`).join(" "));
  poly.setAttribute("stroke", "#2563eb");
  poly.setAttribute("stroke-width", "0.012");
  poly.setAttribute("stroke-dasharray", "0.035 0.018");
  poly.setAttribute("stroke-linejoin", "round");
  poly.setAttribute("stroke-linecap", "round");
  poly.setAttribute("fill", "none");
  poly.setAttribute("opacity", "0.75");
  svg.appendChild(poly);
  floorPlanOverlay.appendChild(svg);
}

function highlightDesk(deskId) {
  deskSvgOverlay?.querySelectorAll(".desk-tile.highlighted")
    .forEach(m => m.classList.remove("highlighted"));
  document.getElementById("desk-pointer-line")?.remove();
  _highlightedDeskId = null;

  if (!deskId) return;

  const marker = deskSvgOverlay?.querySelector(`[data-desk-id="${deskId}"]`);
  if (!marker) return;

  marker.classList.add("highlighted");
  _highlightedDeskId = deskId;
}

function centerOnMarker(deskId) {
  const desk = state.desks.find(d => d.id === deskId);
  if (!desk || typeof desk.position_x !== "number") return;

  const wW = mapZoomWrapper?.clientWidth;
  const wH = mapZoomWrapper?.clientHeight;
  if (!wW || !wH || !_imgW) return;

  const targetZoom = Math.min(4, Math.max(_zoom, Math.max(_minZoom * 2.5, 2)));
  _zoom = targetZoom;
  const cx = desk.position_x + (desk.w || 0.03) / 2;
  const cy = desk.position_y + (desk.h || 0.02) / 2;
  _tx   = wW / 2 - (_imgX + cx * _imgW) * targetZoom;
  _ty   = wH / 2 - (_imgY + cy * _imgH) * targetZoom;
  _applyTransform();
  if (mapZoomContent) mapZoomContent.style.cursor = "grab";
}

async function buildRoute(deskId) {
  document.getElementById("desk-pointer-line")?.remove();
  if (!deskId) return;

  const desk = state.desks.find(d => d.id === deskId);
  if (!desk || typeof desk.position_x !== "number") return;

  const myResv = state.floorReservations.find(r => r.user_id === _username && r.status === "active");
  const myDesk = myResv ? state.desks.find(d => d.id === myResv.desk_id) : null;
  const startX = (myDesk && typeof myDesk.position_x === "number") ? myDesk.position_x : 0.5;
  const startY = (myDesk && typeof myDesk.position_y === "number") ? myDesk.position_y : 0.5;
  const endX = desk.position_x, endY = desk.position_y;

  _drawRouteSvg([{ x: startX, y: startY }, { x: endX, y: endY }]);

  const planUrl = floorPlanImage.src;
  if (planUrl && planUrl !== window.location.href) {
    const path = await computePath(planUrl, startX, startY, endX, endY);
    if (_highlightedDeskId === deskId && path && path.length > 1) {
      _drawRouteSvg(path);
    }
  }
}

// ── Plan markers ────────────────────────────────────────────────────────────

// Space-type fill colors for SVG tiles (available state)
const _TILE_FILL = {
  desk:         { fill: "#dcfce7", stroke: "#16a34a" },
  meeting_room: { fill: "#ede9fe", stroke: "#7c3aed" },
  call_room:    { fill: "#cffafe", stroke: "#0891b2" },
  open_space:   { fill: "#ecfccb", stroke: "#65a30d" },
  lounge:       { fill: "#fef3c7", stroke: "#d97706" },
};

function renderPlanMarkers(svgEl, desks) {
  if (!svgEl) return;
  _highlightedDeskId = null;
  document.getElementById("desk-pointer-line")?.remove();
  svgEl.innerHTML = "";

  desks
    .filter((d) => typeof d.position_x === "number" && typeof d.position_y === "number")
    .forEach((d) => {
      const avail  = state.availability.get(d.id);
      const isMine = state.floorReservations.some(
        (r) => r.desk_id === d.id && r.user_id === _username && r.status === "active"
      );
      const st = d.space_type || "desk";
      const tileW = (d.w || 0.03) * 1000;
      const tileH = (d.h || 0.02) * 1000;
      const tx    = d.position_x * 1000;
      const ty    = d.position_y * 1000;

      let fillColor, strokeColor;
      if (isMine) {
        fillColor = "#dbeafe"; strokeColor = "#2563eb";
      } else if (avail?.available) {
        const c = _TILE_FILL[st] || _TILE_FILL.desk;
        fillColor = c.fill; strokeColor = c.stroke;
      } else {
        fillColor = "#fee2e2"; strokeColor = "#dc2626";
      }

      const ns = "http://www.w3.org/2000/svg";
      const g = document.createElementNS(ns, "g");
      g.classList.add("desk-tile", "st-" + st);
      if (isMine)              g.classList.add("tile-mine");
      else if (avail?.available) g.classList.add("tile-available");
      else                     g.classList.add("tile-busy");
      if (state.favorites.has(d.id)) g.classList.add("favorite");
      g.dataset.deskId = String(d.id);

      const isDesk = st === "desk";
      if (isDesk) {
        // Desk: small circle at center of tile area
        const cx = tx + tileW / 2;
        const cy = ty + tileH / 2;
        const r  = 6;
        const circ = document.createElementNS(ns, "circle");
        circ.setAttribute("cx",           String(cx));
        circ.setAttribute("cy",           String(cy));
        circ.setAttribute("r",            String(r));
        circ.setAttribute("fill",         fillColor);
        circ.setAttribute("stroke",       strokeColor);
        circ.setAttribute("stroke-width", "2");
        g.appendChild(circ);
      } else {
        // Room: rectangle block
        const rect = document.createElementNS(ns, "rect");
        rect.setAttribute("x",            String(tx));
        rect.setAttribute("y",            String(ty));
        rect.setAttribute("width",        String(tileW));
        rect.setAttribute("height",       String(tileH));
        rect.setAttribute("rx",           "8");
        rect.setAttribute("fill",         fillColor);
        rect.setAttribute("stroke",       strokeColor);
        rect.setAttribute("stroke-width", "2");
        g.appendChild(rect);
      }

      g.addEventListener("click", (e) => {
        e.stopPropagation();
        showSidePanel(g, d);
      });

      svgEl.appendChild(g);
    });

  // Reset side panel on floor change / re-render
  closeSidePanel();
  _activeSpaceFilters.clear();
  renderLegend(desks);
  renderSpaceFilter(desks);
  applySpaceFilter();
}

const _LEGEND_LABELS = {
  desk: "Рабочий стол", meeting_room: "Переговорная",
  call_room: "Call-room", open_space: "Open Space", lounge: "Лаунж",
};
const _LEGEND_COLORS = {
  desk: "#059669", meeting_room: "#7c3aed",
  call_room: "#0891b2", open_space: "#65a30d", lounge: "#d97706",
};

function renderLegend(desks) {
  const el = document.getElementById("map-legend");
  if (!el) return;
  const types = [...new Set(desks.map(d => d.space_type || "desk"))];
  if (types.length <= 1) { el.style.display = "none"; return; }
  el.style.display = "";
  el.innerHTML = types.map(t =>
    `<span class="legend-item">
       <span class="legend-dot" style="background:${_LEGEND_COLORS[t] || "#888"}"></span>
       ${_LEGEND_LABELS[t] || t}
     </span>`
  ).join("");
}

// ── Colleagues ──────────────────────────────────────────────────────────────

function hideColleagues() {
  const list  = document.getElementById("colleagues-list");
  const count = document.getElementById("colleagues-count");
  if (list) list.innerHTML = '<p class="empty" style="padding:20px 16px;font-size:12px">Выберите этаж для отображения</p>';
  if (count) count.textContent = "";
  state.floorReservations = [];
}

function renderColleagues() {
  const list  = document.getElementById("colleagues-list");
  const count = document.getElementById("colleagues-count");
  if (!list) return;

  list.innerHTML = "";

  let reservations = state.floorReservations;
  if (_teamFilterActive) {
    reservations = reservations.filter(
      r => r.user_id === _username || state.team.has(r.user_id)
    );
  }

  if (!reservations.length) {
    const emptyMsg = _teamFilterActive
      ? "Сегодня коллеги вашего отдела не забронировали места"
      : "Никого на этаже";
    list.innerHTML = `<p class="empty" style="padding:20px 16px;font-size:12px">${emptyMsg}</p>`;
    if (count) count.textContent = "";
    return;
  }

  if (count) count.textContent = `${reservations.length}`;

  const col = document.createElement("div");
  col.className = "colleague-list";

  for (const r of reservations) {
    const desk = state.desks.find((d) => d.id === r.desk_id);
    const isMe = r.user_id === _username;
    const isTeam = state.team.has(r.user_id);

    const item = document.createElement("div");
    item.className = `colleague-item${isMe ? " is-me" : ""}`;

    const initials  = r.user_id.slice(0, 2).toUpperCase();
    const deskLabel = desk?.label ?? `Место #${r.desk_id}`;
    const time      = `${r.start_time?.slice(0, 5) ?? "?"} – ${r.end_time?.slice(0, 5) ?? "?"}`;
    const meTag     = isMe ? `<span class="colleague-me-tag">вы</span>` : "";
    const teamTag   = !isMe && isTeam ? `<span class="colleague-team-tag">команда</span>` : "";

    item.innerHTML = `
      <div class="colleague-avatar">${initials}</div>
      <div class="colleague-info">
        <div class="colleague-name">${r.user_id}${meTag}${teamTag}</div>
        <div class="colleague-desk">${deskLabel}</div>
      </div>
      <div class="colleague-time">${time}</div>`;

    if (!isMe && desk && typeof desk.position_x === "number") {
      item.style.cursor = "pointer";
      (function(reservation, listItem) {
        listItem.addEventListener("click", () => {
          if (_highlightedDeskId === reservation.desk_id) {
            highlightDesk(null);
            closeSidePanel();
            listItem.classList.remove("active-colleague");
            return;
          }
          document.querySelectorAll(".colleague-item.active-colleague")
            .forEach(el => el.classList.remove("active-colleague"));
          listItem.classList.add("active-colleague");
          highlightDesk(reservation.desk_id);
          centerOnMarker(reservation.desk_id);
          const markerEl = deskSvgOverlay?.querySelector(`[data-desk-id="${reservation.desk_id}"]`);
          const deskObj  = state.desks.find(d => d.id === reservation.desk_id);
          if (markerEl && deskObj) showSidePanel(markerEl, deskObj);
        });
      })(r, item);
    }

    col.append(item);
  }

  list.append(col);
}

// ── My bookings ─────────────────────────────────────────────────────────────

function renderMyBookings(bookings) {
  myBookingsContainer.innerHTML = "";
  if (!bookings.length) {
    myBookingsContainer.innerHTML = '<p class="empty">Нет активных бронирований</p>';
    return;
  }
  const list = document.createElement("div");
  list.className = "booking-list";
  for (const b of bookings) {
    const item = document.createElement("div");
    item.className = "booking-item";

    const info = document.createElement("div");
    info.className = "booking-info";

    const deskName =
      state.desks.find((d) => d.id === b.desk_id)?.label ?? `#${b.desk_id}`;

    const title = document.createElement("strong");
    title.textContent = `Место ${deskName}`;

    const meta = document.createElement("span");
    meta.textContent = `${b.reservation_date} · ${b.start_time?.slice(0, 5) ?? "весь день"} – ${b.end_time?.slice(0, 5) ?? ""}`;

    const checkinBadge = document.createElement("span");
    if (b.checked_in_at) {
      checkinBadge.className = "badge checked-in";
      checkinBadge.textContent = `✓ Отмечен в ${b.checked_in_at.slice(11, 16)}`;
    } else {
      checkinBadge.className = "badge not-checked-in";
      checkinBadge.textContent = "Нет отметки";
    }

    info.append(title, meta, checkinBadge);

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "btn btn-danger btn-sm";
    cancelBtn.textContent = "Отменить";
    cancelBtn.addEventListener("click", () => cancelBooking(b.id));

    item.append(info, cancelBtn);
    list.append(item);
  }
  myBookingsContainer.append(list);
}

// ── Favorites filter ────────────────────────────────────────────────────────

let _favFilterActive = false;

// ── Space-type filter ────────────────────────────────────────────────────────

let _activeSpaceFilters = new Set();

const _SF_LABELS = {
  desk: "Рабочий стол", meeting_room: "Переговорная",
  call_room: "Call-room", open_space: "Open Space", lounge: "Лаунж",
};
const _SF_COLORS = {
  desk: "#059669", meeting_room: "#7c3aed",
  call_room: "#0891b2", open_space: "#65a30d", lounge: "#d97706",
};

function applySpaceFilter() {
  const markers = deskSvgOverlay?.querySelectorAll(".desk-tile");
  if (!markers) return;
  markers.forEach((m) => {
    if (_activeSpaceFilters.size === 0) {
      m.classList.remove("filtered-out");
      return;
    }
    const hasMatch = [..._activeSpaceFilters].some(t => m.classList.contains("st-" + t));
    m.classList.toggle("filtered-out", !hasMatch);
  });
}

function renderSpaceFilter(desks) {
  const bar = document.getElementById("space-filter-bar");
  if (!bar) return;

  const types = [...new Set(desks.map(d => d.space_type || "desk"))];
  if (types.length <= 1) {
    bar.style.display = "none";
    bar.innerHTML = "";
    _activeSpaceFilters.clear();
    return;
  }

  bar.style.display = "";
  bar.innerHTML = "";

  // "Все" pill
  const allPill = document.createElement("button");
  allPill.className = "space-filter-pill" + (_activeSpaceFilters.size === 0 ? " active" : "");
  allPill.textContent = "Все";
  allPill.style.backgroundColor = _activeSpaceFilters.size === 0 ? "#475569" : "";
  allPill.addEventListener("click", () => {
    _activeSpaceFilters.clear();
    renderSpaceFilter(desks);
    applySpaceFilter();
  });
  bar.append(allPill);

  for (const t of types) {
    const color   = _SF_COLORS[t] || "#888";
    const label   = _SF_LABELS[t] || t;
    const isActive = _activeSpaceFilters.has(t);

    const pill = document.createElement("button");
    pill.className = "space-filter-pill" + (isActive ? " active" : "");
    if (isActive) pill.style.backgroundColor = color;

    const dot = document.createElement("span");
    dot.className = "space-filter-pill-dot";
    dot.style.background = isActive ? "white" : color;

    const txt = document.createElement("span");
    txt.textContent = label;

    pill.append(dot, txt);
    pill.addEventListener("click", () => {
      if (_activeSpaceFilters.has(t)) {
        _activeSpaceFilters.delete(t);
      } else {
        _activeSpaceFilters.add(t);
      }
      renderSpaceFilter(desks);
      applySpaceFilter();
    });

    bar.append(pill);
  }
}

let _teamFilterActive = false;

function renderPlanMarkersFiltered() {
  let desks = state.desks;
  if (_favFilterActive) {
    desks = desks.filter(d => state.favorites.has(d.id));
  } else if (_teamFilterActive) {
    // Show only desks booked by my team (or by me)
    const teamDeskIds = new Set(
      state.floorReservations
        .filter(r => r.status === "active" && (state.team.has(r.user_id) || r.user_id === _username))
        .map(r => r.desk_id)
    );
    desks = desks.filter(d => teamDeskIds.has(d.id));
  }
  renderPlanMarkers(deskSvgOverlay, desks);
}

// ── Events ──────────────────────────────────────────────────────────────────

officeSelect.addEventListener("change", (e) => {
  localStorage.setItem("dk_office", e.target.value);
  loadFloors(e.target.value);
  loadPolicies(e.target.value);
});

floorSelect.addEventListener("change", (e) => {
  const floorId = e.target.value;
  localStorage.setItem("dk_floor", floorId);
  state.desks = [];
  loadDesks(floorId);
  const floor = state.floors.find((f) => String(f.id) === String(floorId));
  renderFloorPlan(floor);
});

refreshBookings.addEventListener("click", () => loadMyBookings());

// Debounce auto-refresh when date/time params change
let _refreshDebounce;
function debouncedRefresh() {
  clearTimeout(_refreshDebounce);
  _refreshDebounce = setTimeout(refreshAvailability, 400);
}
dateInput.addEventListener("change", debouncedRefresh);
startInput.addEventListener("change", debouncedRefresh);
endInput.addEventListener("change", debouncedRefresh);

// Policies accordion toggle
document.getElementById("policies-toggle")?.addEventListener("click", () => {
  if (!policiesAccordion) return;
  const isOpen = policiesAccordion.classList.toggle("open");
  const btn = document.getElementById("policies-toggle");
  if (btn) btn.textContent = isOpen ? "Правила ▴" : "Правила ▾";
});

const favFilterBtn = document.getElementById("fav-filter-btn");
favFilterBtn?.addEventListener("click", () => {
  _favFilterActive = !_favFilterActive;
  if (_favFilterActive) _teamFilterActive = false;
  favFilterBtn.classList.toggle("btn-primary", _favFilterActive);
  favFilterBtn.classList.toggle("btn-secondary", !_favFilterActive);
  favFilterBtn.textContent = _favFilterActive ? "★ Только избранные" : "☆ Только избранные";
  const teamBtn = document.getElementById("team-filter-btn");
  if (teamBtn) {
    teamBtn.classList.remove("btn-primary");
    teamBtn.classList.add("btn-secondary");
  }
  renderPlanMarkersFiltered();
  renderColleagues();
});

const teamFilterBtn = document.getElementById("team-filter-btn");
teamFilterBtn?.addEventListener("click", () => {
  _teamFilterActive = !_teamFilterActive;
  if (_teamFilterActive) {
    _favFilterActive = false;
    favFilterBtn?.classList.remove("btn-primary");
    favFilterBtn?.classList.add("btn-secondary");
    if (favFilterBtn) favFilterBtn.textContent = "☆ Только избранные";
  }
  teamFilterBtn.classList.toggle("btn-primary", _teamFilterActive);
  teamFilterBtn.classList.toggle("btn-secondary", !_teamFilterActive);
  renderPlanMarkersFiltered();
  renderColleagues();
});

logoutBtn.addEventListener("click", () => {
  localStorage.removeItem("user_token");
  localStorage.removeItem("user_username");
  window.location.href = "./login.html";
});

// ── Notification drawer events ────────────────────────────────────────────────

document.getElementById("notif-bell")?.addEventListener("click", openNotifDrawer);
document.getElementById("notif-drawer-close")?.addEventListener("click", closeNotifDrawer);
document.getElementById("notif-backdrop")?.addEventListener("click", closeNotifDrawer);
document.getElementById("notif-clear-btn")?.addEventListener("click", () => {
  _notifHistory = []; _notifUnread = 0;
  _notifSave(); _notifUpdateBadge(); _notifRenderDrawer();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (_isDrawerOpen) closeNotifDrawer();
    else closeProfileModal();
  }
});

document.getElementById("profile-modal-overlay")?.addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closeProfileModal();
});

// ── Panel tabs ────────────────────────────────────────────────────────────────

document.querySelectorAll(".panel-tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".panel-tab-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    const tab = btn.dataset.tab;
    const floorEl    = document.getElementById("colleagues-section");
    const bookingsEl = document.getElementById("panel-bookings-tab");
    if (floorEl)    floorEl.style.display    = tab === "floor"    ? "" : "none";
    if (bookingsEl) bookingsEl.style.display = tab === "bookings" ? "" : "none";
  });
});

// ── Mobile sheet toggle ───────────────────────────────────────────────────────

const sheetToggleBtn = document.getElementById("sheet-toggle-btn");
const panelColumnEl  = document.getElementById("panel-column");
sheetToggleBtn?.addEventListener("click", () => {
  const isOpen = panelColumnEl.classList.toggle("sheet-open");
  sheetToggleBtn.classList.toggle("sheet-open", isOpen);
});

// ── Navigate to desk (cross-floor / cross-office) ────────────────────────────

async function navigateToDesk(officeId, floorId, deskId) {
  _pendingFocusDeskId = deskId;

  // Switch office if needed
  if (String(officeSelect.value) !== String(officeId)) {
    officeSelect.value = String(officeId);
    localStorage.setItem("dk_office", String(officeId));
    await loadFloors(officeId);
    loadPolicies(officeId);
  }

  // Switch floor if needed
  if (String(floorSelect.value) !== String(floorId)) {
    floorSelect.value = String(floorId);
    localStorage.setItem("dk_floor", String(floorId));
    state.desks = [];
    await loadDesks(floorId);
    const floor = state.floors.find(f => String(f.id) === String(floorId));
    renderFloorPlan(floor);
    // fitFloorPlan fires on image onload → picks up _pendingFocusDeskId
  } else {
    // Already on correct floor — focus immediately after markers render
    _pendingFocusDeskId = null;
    setTimeout(() => {
      highlightDesk(deskId);
      centerOnMarker(deskId);
      const markerEl = deskSvgOverlay?.querySelector(`[data-desk-id="${deskId}"]`);
      const deskObj  = state.desks.find(d => d.id === deskId);
      if (markerEl && deskObj) showSidePanel(markerEl, deskObj);
    }, 50);
  }
}

// ── Colleague search ─────────────────────────────────────────────────────────

(function initColleagueSearch() {
  const searchInput   = document.getElementById("colleague-search");
  const dropdown      = document.getElementById("search-dropdown");
  const clearBtn      = document.getElementById("colleague-search-clear");
  if (!searchInput || !dropdown) return;

  let _debounceTimer = null;

  function closeDropdown() {
    dropdown.style.display = "none";
    dropdown.innerHTML = "";
  }

  function clearSearch() {
    searchInput.value = "";
    clearBtn.style.display = "none";
    closeDropdown();
    highlightDesk(null);
  }

  function renderDropdown(users) {
    dropdown.innerHTML = "";
    if (!users.length) {
      dropdown.innerHTML = '<div class="search-empty">Никого не найдено</div>';
      dropdown.style.display = "";
      return;
    }
    for (const u of users) {
      const displayName = u.full_name || u.username;
      const initials    = displayName.slice(0, 2).toUpperCase();
      const sub         = [u.department, u.position].filter(Boolean).join(" · ") || u.username;
      const loc         = u.location;

      // Location line: office · floor · desk (or "Нет брони на эту дату")
      let locLine = "";
      if (loc) {
        const parts = [loc.office_name, loc.floor_name, loc.desk_label].filter(Boolean);
        locLine = parts.join(" · ");
      } else if (dateInput?.value) {
        locLine = "Нет брони на эту дату";
      }

      // Is the user on a different floor than currently selected?
      const onOtherFloor = loc && String(loc.floor_id) !== String(floorSelect.value);
      const isTeamMember = state.team.has(u.username);
      const teamBadge    = isTeamMember ? `<span class="search-team-badge">Моя команда</span>` : "";

      const item = document.createElement("div");
      item.className = "search-result-item";
      item.innerHTML = `
        <div class="search-result-avatar${isTeamMember ? " is-team" : ""}">${initials}</div>
        <div class="search-result-info">
          <div class="search-result-name">${displayName}${teamBadge}</div>
          <div class="search-result-sub">${sub}</div>
          ${locLine ? `<div class="search-result-loc${loc ? "" : " search-result-loc--empty"}">${locLine}</div>` : ""}
        </div>
        ${onOtherFloor ? `<button class="search-goto-btn" data-desk="${loc.desk_id}" data-floor="${loc.floor_id}" data-office="${loc.office_id}">Перейти →</button>` : ""}`;

      // Click on item (not the button) — focus on current floor if possible
      item.addEventListener("mousedown", (e) => {
        if (e.target.closest(".search-goto-btn")) return; // handled below
        e.preventDefault();
        searchInput.value = displayName;
        clearBtn.style.display = "";
        closeDropdown();

        if (loc && String(loc.floor_id) === String(floorSelect.value)) {
          // Same floor — highlight and center
          highlightDesk(loc.desk_id);
          centerOnMarker(loc.desk_id);
          const markerEl = deskSvgOverlay?.querySelector(`[data-desk-id="${loc.desk_id}"]`);
          const deskObj  = state.desks.find(d => d.id === loc.desk_id);
          if (markerEl && deskObj) showSidePanel(markerEl, deskObj);
        } else if (loc && onOtherFloor) {
          // Different floor — navigate automatically
          navigateToDesk(loc.office_id, loc.floor_id, loc.desk_id);
        } else {
          addMessage(`У ${displayName} нет активной брони`, "info");
        }
      });

      // "Перейти →" button
      const gotoBtn = item.querySelector(".search-goto-btn");
      if (gotoBtn) {
        gotoBtn.addEventListener("mousedown", (e) => {
          e.preventDefault();
          searchInput.value = displayName;
          clearBtn.style.display = "";
          closeDropdown();
          navigateToDesk(
            parseInt(gotoBtn.dataset.office),
            parseInt(gotoBtn.dataset.floor),
            parseInt(gotoBtn.dataset.desk),
          );
        });
      }

      dropdown.append(item);
    }
    dropdown.style.display = "";
  }

  searchInput.addEventListener("input", () => {
    const q = searchInput.value.trim();
    clearBtn.style.display = q ? "" : "none";
    clearTimeout(_debounceTimer);

    if (q.length < 2) { closeDropdown(); return; }

    dropdown.innerHTML = '<div class="search-empty">Поиск...</div>';
    dropdown.style.display = "";

    _debounceTimer = setTimeout(async () => {
      try {
        const rd = dateInput?.value || "";
        const st = startInput?.value || "";
        const et = endInput?.value || "";
        let url = `/users/search?q=${encodeURIComponent(q)}&limit=10`;
        if (rd) url += `&date=${encodeURIComponent(rd)}`;
        if (st) url += `&start_time=${encodeURIComponent(st)}`;
        if (et) url += `&end_time=${encodeURIComponent(et)}`;
        const users = await apiRequest(url);
        renderDropdown(users);
      } catch {
        closeDropdown();
      }
    }, 300);
  });

  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") clearSearch();
  });

  clearBtn.addEventListener("click", clearSearch);

  document.addEventListener("click", (e) => {
    if (!e.target.closest("#colleague-search-bar")) closeDropdown();
  });
})();

// ── Init ────────────────────────────────────────────────────────────────────

async function init() {
  if (window.lucide) lucide.createIcons();
  _notifLoad();
  await checkApi();
  await loadOffices();

  const savedOffice = localStorage.getItem("dk_office");
  const savedFloor  = localStorage.getItem("dk_floor");
  if (savedOffice) {
    officeSelect.value = savedOffice;
    await loadFloors(savedOffice);
    await loadPolicies(savedOffice);
    if (savedFloor && state.floors.some(f => String(f.id) === String(savedFloor))) {
      floorSelect.value = savedFloor;
      const floor = state.floors.find(f => String(f.id) === String(savedFloor));
      renderFloorPlan(floor);
      await loadDesks(savedFloor);
    }
  }

  await Promise.all([loadFavorites(), loadTeam()]);
  await loadMyBookings();

  // Handle ?find=<username> from profile "Найти на карте"
  const findParam = new URLSearchParams(window.location.search).get("find");
  if (findParam) {
    // Clean URL without reload
    history.replaceState(null, "", window.location.pathname);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const st    = startInput?.value || "";
      const et    = endInput?.value  || "";
      let url = `/users/search?q=${encodeURIComponent(findParam)}&limit=5&date=${today}`;
      if (st) url += `&start_time=${encodeURIComponent(st)}`;
      if (et) url += `&end_time=${encodeURIComponent(et)}`;
      const results = await apiRequest(url);
      const user = results.find(u => u.username === findParam) || results[0];
      if (user?.location) {
        const loc = user.location;
        navigateToDesk(loc.office_id, loc.floor_id, loc.desk_id);
      } else if (user) {
        addMessage(`У ${user.full_name || findParam} нет брони на сегодня`, "info");
      }
    } catch { /* silent */ }
  }
}

init();
