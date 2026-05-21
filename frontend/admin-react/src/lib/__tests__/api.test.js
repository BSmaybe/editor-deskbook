import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiFetch, login, logout, tokenFromStorage, setUnauthorizedHandler } from '../api.js';

function mockFetch(status, body, contentType = 'application/json') {
  const response = {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h) => (h === 'content-type' ? contentType : null) },
    json: vi.fn().mockResolvedValue(typeof body === 'string' ? JSON.parse(body) : body),
    text: vi.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
  };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
  return response;
}

beforeEach(() => {
  localStorage.clear();
  setUnauthorizedHandler(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('apiFetch', () => {
  it('adds Authorization header when token exists', async () => {
    localStorage.setItem('admin_token', 'test-token-123');
    mockFetch(200, { id: 1 });
    await apiFetch('/offices');
    const [, options] = fetch.mock.calls[0];
    expect(options.headers['Authorization']).toBe('Bearer test-token-123');
  });

  it('omits Authorization header when no token', async () => {
    mockFetch(200, { id: 1 });
    await apiFetch('/health');
    const [, options] = fetch.mock.calls[0];
    expect(options.headers['Authorization']).toBeUndefined();
  });

  it('returns JSON for JSON response', async () => {
    mockFetch(200, { message: 'ok' });
    const result = await apiFetch('/health');
    expect(result).toEqual({ message: 'ok' });
  });

  it('returns null for 204 No Content', async () => {
    mockFetch(204, null);
    const result = await apiFetch('/floors/1');
    expect(result).toBeNull();
  });

  it('throws on 4xx with detail message', async () => {
    mockFetch(404, { detail: 'не найдено' });
    await expect(apiFetch('/offices/999')).rejects.toThrow('не найдено');
  });

  it('clears token and calls unauthorized handler on 401', async () => {
    localStorage.setItem('admin_token', 'expired-token');
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    mockFetch(401, { detail: 'unauthorized' });
    await expect(apiFetch('/users/me')).rejects.toThrow('Сессия истекла');
    expect(localStorage.getItem('admin_token')).toBeNull();
    expect(handler).toHaveBeenCalledOnce();
  });
});

describe('login', () => {
  it('stores token and username in localStorage', async () => {
    mockFetch(200, { access_token: 'jwt-abc', token_type: 'bearer' });
    await login('admin', 'secret');
    expect(localStorage.getItem('admin_token')).toBe('jwt-abc');
    expect(localStorage.getItem('admin_username')).toBe('admin');
  });

  it('throws on invalid credentials', async () => {
    mockFetch(401, { detail: 'неверный логин или пароль' });
    await expect(login('admin', 'wrong')).rejects.toThrow('неверный логин или пароль');
  });
});

describe('logout', () => {
  it('removes token and username from localStorage', () => {
    localStorage.setItem('admin_token', 'tok');
    localStorage.setItem('admin_username', 'admin');
    logout();
    expect(tokenFromStorage()).toBe('');
    expect(localStorage.getItem('admin_username')).toBeNull();
  });
});
