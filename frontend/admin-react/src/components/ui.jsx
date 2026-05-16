import React from 'react';
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

export function Notice({ notice, error }) {
  if (!notice && !error) return null;
  return (
    <div className={`notice ${error ? 'error' : 'ok'}`}>
      {error ? <CircleAlert size={18} /> : <Save size={18} />}
      <span>{error || notice}</span>
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
            <span>Editor Admin</span>
          </div>
        </div>
        <label>
          <span>Username</span>
          <input name="username" autoComplete="username" required />
        </label>
        <label>
          <span>Password</span>
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        {error && (
          <div className="notice error">
            <CircleAlert size={18} />
            <span>{error}</span>
          </div>
        )}
        <button className="primary-button" disabled={busy}>
          {busy ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
