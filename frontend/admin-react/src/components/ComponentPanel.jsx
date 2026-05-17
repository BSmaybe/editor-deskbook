import React, { useState } from 'react';
import { Plus, Pencil, Search, Trash2 } from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import { assetTypeLabel } from '../lib/i18n.js';
import { EmptyState } from './ui.jsx';
import ComponentEditor from './ComponentEditor.jsx';
import { COMPONENT_CATEGORIES, viewBoxString } from '../lib/componentCatalog.js';

export default function ComponentPanel({ components, onRefresh, onNotice, onError }) {
  const [editing, setEditing] = useState(null); // null | component-form object
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [groupFilter, setGroupFilter] = useState('all');

  const existingIds = components.map((c) => c.id);
  const systemCount = components.filter((c) => c.is_system).length;
  const customCount = components.length - systemCount;
  const filteredComponents = components.filter((c) => {
    const q = query.trim().toLowerCase();
    const matchesQuery = !q || [c.label, c.id, c.asset_type].some((v) => String(v || '').toLowerCase().includes(q));
    const matchesGroup = groupFilter === 'all' || (groupFilter === 'custom' ? !c.is_system : c.palette_group === groupFilter);
    return matchesQuery && matchesGroup;
  });

  function openCreate() {
    setEditing({
      id: '',
      label: '',
      asset_type: 'asset',
      view_box: [0, 0, 100, 60],
      default_w: 100,
      default_h: 60,
      svg_markup: '',
      _isNew: true,
    });
  }

  function openEdit(c) {
    setEditing({
      id: c.id,
      label: c.label,
      asset_type: c.asset_type,
      view_box: Array.isArray(c.view_box) ? [...c.view_box] : [0, 0, c.default_w || 100, c.default_h || 60],
      default_w: c.default_w || 100,
      default_h: c.default_h || 60,
      svg_markup: c.svg_markup || '',
      _isNew: false,
    });
  }

  function closeEditor() {
    setEditing(null);
    onError('');
  }

  async function handleSave(payload) {
    setBusy(true);
    onError('');
    try {
      if (editing._isNew) {
        await apiFetch('/components', { method: 'POST', body: JSON.stringify(payload) });
        onNotice(`Компонент "${payload.label}" создан`);
      } else {
        await apiFetch(`/components/${encodeURIComponent(payload.id)}`, { method: 'PUT', body: JSON.stringify(payload) });
        onNotice(`Компонент "${payload.label}" обновлён`);
      }
      setEditing(null);
      onRefresh();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(c) {
    if (c.is_system) return;
    if (!confirm(`Удалить компонент "${c.label}"?`)) return;
    setBusy(true);
    onError('');
    try {
      await apiFetch(`/components/${encodeURIComponent(c.id)}`, { method: 'DELETE' });
      onNotice(`Компонент "${c.label}" удалён`);
      onRefresh();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  }

  /* ── Editor view ── */
  if (editing) {
    return (
      <ComponentEditor
        form={editing}
        busy={busy}
        existingIds={existingIds}
        onSave={handleSave}
        onCancel={closeEditor}
      />
    );
  }

  /* ── List view ── */
  return (
    <div>
      <div className="component-toolbar">
        <div>
          <h2>Библиотека компонентов</h2>
          <p>{components.length} элементов · {systemCount} системных · {customCount} своих</p>
        </div>
        <button className="tool-button" onClick={openCreate}>
          <Plus size={18} />
          <span>Новый компонент</span>
        </button>
      </div>

      <div className="component-filters">
        <label className="component-search">
          <Search size={16} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск элементов"
          />
        </label>
        <div className="component-filter-tabs">
          <button className={groupFilter === 'all' ? 'active' : ''} onClick={() => setGroupFilter('all')}>Все</button>
          {COMPONENT_CATEGORIES.filter((g) => g.id !== 'custom').map((group) => (
            <button
              key={group.id}
              className={groupFilter === group.id ? 'active' : ''}
              onClick={() => setGroupFilter(group.id)}
            >
              {group.label}
            </button>
          ))}
          <button className={groupFilter === 'custom' ? 'active' : ''} onClick={() => setGroupFilter('custom')}>Свои</button>
        </div>
      </div>

      <section className="component-grid">
        {filteredComponents.map((c) => (
          <article className="component-card" key={c.id}>
            <div
              className="component-thumb"
              dangerouslySetInnerHTML={{
                __html: `<svg viewBox="${viewBoxString(c)}" xmlns="http://www.w3.org/2000/svg">${c.svg_markup || ''}</svg>`,
              }}
            />
            <div className="component-info">
              <h2>{c.label}</h2>
              <p className="component-id">{c.id}</p>
              <p className="component-size">{Math.round(c.default_w || 0)} x {Math.round(c.default_h || 0)}</p>
            </div>
            <div className="component-actions">
              <span className="badge">{assetTypeLabel(c.asset_type)}</span>
              {c.is_system && <span className="badge muted">системный</span>}
              {!c.is_system && (
                <>
                  <button
                    className="icon-button sm"
                    onClick={() => openEdit(c)}
                    title="Редактировать компонент"
                    disabled={busy}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    className="icon-button sm danger"
                    onClick={() => handleDelete(c)}
                    title="Удалить компонент"
                    disabled={busy}
                  >
                    <Trash2 size={14} />
                  </button>
                </>
              )}
            </div>
          </article>
        ))}
        {!filteredComponents.length && (
          <EmptyState text="Под текущий фильтр ничего не подходит" />
        )}
      </section>
    </div>
  );
}
