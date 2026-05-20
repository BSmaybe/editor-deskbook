import React, { useEffect, useState } from 'react';
import { Building2, CircleAlert, Save } from 'lucide-react';

export function Metric({ label, value }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function EmptyState({ text }) {
  return <div className="empty-state">{text}</div>;
}

export function Notice({ notice, error, onDismissNotice, onDismissError }) {
  const [visible, setVisible] = useState(true);
  const text = error || notice;

  useEffect(() => {
    if (!text) return;
    setVisible(true);
    if (error) return;
    const timer = setTimeout(() => {
      setVisible(false);
      onDismissNotice?.();
    }, 4000);
    return () => clearTimeout(timer);
  }, [text, error, onDismissNotice]);

  if (!text || !visible) return null;
  return (
    <div className={`notice ${error ? 'error' : 'ok'}`}>
      {error ? <CircleAlert size={18} /> : <Save size={18} />}
      <span>{text}</span>
      {error && (
        <button
          type="button"
          className="notice-close"
          onClick={() => { setVisible(false); onDismissError?.(); }}
          aria-label="Закрыть"
        >
          ×
        </button>
      )}
    </div>
  );
}

export function LoginScreen({ busy, error, onSubmit }) {
  return (
    <main className="login-page">
      <form className="login-panel" onSubmit={onSubmit}>
        <div className="brand compact">
          <Building2 size={22} />
          <div>
            <strong>DeskBook</strong>
            <span>Админ редактора</span>
          </div>
        </div>
        <label>
          <span>Логин</span>
          <input name="username" autoComplete="username" required />
        </label>
        <label>
          <span>Пароль</span>
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        {error && (
          <div className="notice error">
            <CircleAlert size={18} />
            <span>{error}</span>
          </div>
        )}
        <button className="primary-button" disabled={busy}>
          {busy ? 'Вход...' : 'Войти'}
        </button>
      </form>
    </main>
  );
}

export function RegisterScreen() {
  const API_BASE = import.meta.env.VITE_API_BASE || '/api';
  const params = new URLSearchParams(window.location.search);
  const inviteToken = params.get('invite') || '';

  const [inviteInfo, setInviteInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!inviteToken) {
      setError('Отсутствует токен приглашения');
      setLoading(false);
      return;
    }
    fetch(`${API_BASE}/invites/${inviteToken}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.detail || 'Приглашение недействительно');
        }
        return res.json();
      })
      .then((data) => setInviteInfo(data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [inviteToken, API_BASE]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    const form = new FormData(e.currentTarget);
    const password = form.get('password');
    const confirm = form.get('confirm');
    if (password !== confirm) {
      setError('Пароли не совпадают');
      setBusy(false);
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: form.get('username'),
          email: inviteInfo.email,
          password,
          invite_token: inviteToken,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Ошибка ${res.status}`);
      }
      setSuccess('Регистрация успешна! Теперь вы можете войти.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="login-page">
        <div className="login-panel"><p>Проверка приглашения...</p></div>
      </main>
    );
  }

  if (success) {
    return (
      <main className="login-page">
        <div className="login-panel">
          <div className="brand compact">
            <Building2 size={22} />
            <div><strong>DeskBook</strong><span>Регистрация</span></div>
          </div>
          <div className="notice ok"><Save size={18} /><span>{success}</span></div>
          <a href="/" className="primary-button" style={{ textAlign: 'center', textDecoration: 'none', display: 'block' }}>
            Перейти к входу
          </a>
        </div>
      </main>
    );
  }

  if (!inviteInfo) {
    return (
      <main className="login-page">
        <div className="login-panel">
          <div className="brand compact">
            <Building2 size={22} />
            <div><strong>DeskBook</strong><span>Регистрация</span></div>
          </div>
          <div className="notice error"><CircleAlert size={18} /><span>{error || 'Приглашение недействительно'}</span></div>
        </div>
      </main>
    );
  }

  return (
    <main className="login-page">
      <form className="login-panel" onSubmit={handleSubmit}>
        <div className="brand compact">
          <Building2 size={22} />
          <div><strong>DeskBook</strong><span>Регистрация по приглашению</span></div>
        </div>
        <div style={{ padding: '8px 12px', background: 'var(--surface-2, #f3f4f6)', borderRadius: 8, fontSize: 14 }}>
          <strong>Email:</strong> {inviteInfo.email}<br />
          <strong>Роль:</strong> {inviteInfo.role === 'admin' ? 'Администратор' : 'Пользователь'}
        </div>
        <label>
          <span>Имя пользователя</span>
          <input name="username" autoComplete="username" required />
        </label>
        <label>
          <span>Пароль</span>
          <input name="password" type="password" autoComplete="new-password" required minLength={6} />
        </label>
        <label>
          <span>Повторите пароль</span>
          <input name="confirm" type="password" autoComplete="new-password" required minLength={6} />
        </label>
        {error && (
          <div className="notice error"><CircleAlert size={18} /><span>{error}</span></div>
        )}
        <button className="primary-button" disabled={busy}>
          {busy ? 'Регистрация...' : 'Зарегистрироваться'}
        </button>
      </form>
    </main>
  );
}
