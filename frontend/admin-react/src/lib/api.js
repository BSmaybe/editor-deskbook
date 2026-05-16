const API_BASE = import.meta.env.VITE_API_BASE || '/api';

export function tokenFromStorage() {
  return localStorage.getItem('admin_token') || '';
}

export function usernameFromStorage() {
  return localStorage.getItem('admin_username') || '';
}

export async function apiFetch(path, options = {}) {
  const token = tokenFromStorage();
  const headers = {
    Accept: 'application/json, text/plain, */*',
    ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || `HTTP ${response.status}`);
  }
  if (response.status === 204) return null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return response.json();
  return response.text();
}

export async function login(username, password) {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ username, password }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || `HTTP ${response.status}`);
  }
  const body = await response.json();
  localStorage.setItem('admin_token', body.access_token);
  localStorage.setItem('admin_username', username);
  return body;
}

export function logout() {
  localStorage.removeItem('admin_token');
  localStorage.removeItem('admin_username');
}
