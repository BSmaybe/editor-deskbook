import React, { useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import { EmptyState } from './ui.jsx';
import ComponentEditor from './ComponentEditor.jsx';

export default function ComponentPanel({ components, onRefresh, onNotice, onError }) {
  const [editing, setEditing] = useState(null); // null | component-form object
  const [busy, setBusy] = useState(false);

  const existingIds = components.map((c) => c.id);

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
        onNotice(`Component "${payload.label}" created`);
      } else {
        await apiFetch(`/components/${encodeURIComponent(payload.id)}`, { method: 'PUT', body: JSON.stringify(payload) });
        onNotice(`Component "${payload.label}" updated`);
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
    if (!confirm(`Delete component "${c.label}"?`)) return;
    setBusy(true);
    onError('');
    try {
      await apiFetch(`/components/${encodeURIComponent(c.id)}`, { method: 'DELETE' });
      onNotice(`Component "${c.label}" deleted`);
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
      <div className="panel-actions">
        <button className="tool-button" onClick={openCreate}>
          <Plus size={18} />
          <span>New component</span>
        </button>
      </div>

      <section className="component-grid">
        {components.map((c) => (
          <article className="component-card" key={c.id}>
            <div
              className="component-thumb"
              dangerouslySetInnerHTML={{
                __html: `<svg viewBox="${(Array.isArray(c.view_box) ? c.view_box : [0,0,100,60]).join(' ')}" xmlns="http://www.w3.org/2000/svg">${c.svg_markup || ''}</svg>`,
              }}
            />
            <div className="component-info">
              <h2>{c.label}</h2>
              <p className="component-id">{c.id}</p>
            </div>
            <div className="component-actions">
              <span className="badge">{c.asset_type}</span>
              <button
                className="icon-button sm"
                onClick={() => openEdit(c)}
                title="Edit component"
                disabled={busy}
              >
                <Pencil size={14} />
              </button>
              <button
                className="icon-button sm danger"
                onClick={() => handleDelete(c)}
                title="Delete component"
                disabled={busy}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </article>
        ))}
        {!components.length && (
          <EmptyState text="No custom components yet. Click 'New component' to create one." />
        )}
      </section>
    </div>
  );
}
