import React, { useCallback, useEffect, useState } from 'react';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { apiFetch } from '../lib/api.js';

export default function InvitePanel({ onNotice, onError }) {
  const [invites, setInvites] = useState([]);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('user');
  const [expiresIn, setExpiresIn] = useState('72');

  const onErrorRef = React.useRef(onError);
  onErrorRef.current = onError;

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const data = await apiFetch('/admin/invites');
      setInvites(Array.isArray(data) ? data : []);
    } catch (err) {
      onErrorRef.current(err.message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleCreate(e) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    try {
      const hours = parseInt(expiresIn, 10);
      await apiFetch('/admin/invites', {
        method: 'POST',
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          role,
          expires_in_hours: hours > 0 ? hours : null,
        }),
      });
      setEmail('');
      onNotice('Приглашение создано');
      await load();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id) {
    if (!confirm('Удалить приглашение?')) return;
    try {
      await apiFetch(`/admin/invites/${id}`, { method: 'DELETE' });
      onNotice('Приглашение удалено');
      await load();
    } catch (err) {
      onError(err.message);
    }
  }

  function copyLink(token) {
    const url = `${window.location.origin}?invite=${token}`;
    navigator.clipboard.writeText(url).then(
      () => onNotice('Ссылка скопирована'),
      () => onError('Не удалось скопировать'),
    );
  }

  function formatDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function inviteStatus(inv) {
    if (inv.used_at) return 'использовано';
    if (inv.expires_at && new Date(inv.expires_at) < new Date()) return 'истекло';
    return 'активно';
  }

  return (
    <section className="panel-section">
      <h2>Приглашения</h2>

      <form onSubmit={handleCreate} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end', marginBottom: 16 }}>
        <label style={{ flex: '1 1 200px' }}>
          <span style={{ fontSize: 13 }}>Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="user@company.com"
            required
            style={{ width: '100%' }}
          />
        </label>
        <label style={{ flex: '0 0 140px' }}>
          <span style={{ fontSize: 13 }}>Роль</span>
          <select value={role} onChange={(e) => setRole(e.target.value)} style={{ width: '100%' }}>
            <option value="user">Пользователь</option>
            <option value="admin">Администратор</option>
          </select>
        </label>
        <label style={{ flex: '0 0 120px' }}>
          <span style={{ fontSize: 13 }}>Срок (часы)</span>
          <input
            type="number"
            value={expiresIn}
            onChange={(e) => setExpiresIn(e.target.value)}
            min="1"
            placeholder="72"
            style={{ width: '100%' }}
          />
        </label>
        <button type="submit" className="tool-button" disabled={busy} style={{ height: 36 }}>
          <Plus size={16} /> Создать
        </button>
      </form>

      {invites.length === 0 && !busy && <p style={{ color: '#888', fontSize: 14 }}>Нет приглашений</p>}

      {invites.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border, #e5e7eb)', textAlign: 'left' }}>
                <th style={{ padding: '6px 8px' }}>Email</th>
                <th style={{ padding: '6px 8px' }}>Роль</th>
                <th style={{ padding: '6px 8px' }}>Статус</th>
                <th style={{ padding: '6px 8px' }}>Истекает</th>
                <th style={{ padding: '6px 8px' }}>Создано</th>
                <th style={{ padding: '6px 8px' }}></th>
              </tr>
            </thead>
            <tbody>
              {invites.map((inv) => {
                const status = inviteStatus(inv);
                return (
                  <tr key={inv.id} style={{ borderBottom: '1px solid var(--border, #f0f0f0)' }}>
                    <td style={{ padding: '6px 8px' }}>{inv.email}</td>
                    <td style={{ padding: '6px 8px' }}>{inv.role === 'admin' ? 'Админ' : 'Пользователь'}</td>
                    <td style={{ padding: '6px 8px' }}>
                      <span style={{
                        padding: '2px 8px',
                        borderRadius: 12,
                        fontSize: 12,
                        background: status === 'активно' ? '#dcfce7' : status === 'использовано' ? '#e0e7ff' : '#fef3c7',
                        color: status === 'активно' ? '#166534' : status === 'использовано' ? '#3730a3' : '#92400e',
                      }}>
                        {status}
                      </span>
                    </td>
                    <td style={{ padding: '6px 8px' }}>{formatDate(inv.expires_at)}</td>
                    <td style={{ padding: '6px 8px' }}>{formatDate(inv.created_at)}</td>
                    <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                      {status === 'активно' && (
                        <button
                          type="button"
                          className="icon-button"
                          onClick={() => copyLink(inv.token)}
                          title="Копировать ссылку"
                        >
                          <Copy size={16} />
                        </button>
                      )}
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => handleDelete(inv.id)}
                        title="Удалить"
                        style={{ color: '#dc2626' }}
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
