import React, { useEffect, useState } from 'react';
import {
  Download,
  Eye,
  FileJson,
  Move,
  Rocket,
  Save,
  Trash2,
} from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import { EmptyState, Metric } from './ui.jsx';
import CanvasEditor from './CanvasEditor.jsx';

/* ───────────── helpers ───────────── */

let _uid = 0;
function uid(prefix = 'obj') {
  return `${prefix}-${Date.now().toString(36)}-${(++_uid).toString(36)}`;
}

function snap(v, grid) {
  return grid > 0 ? Math.round(v / grid) * grid : v;
}

function boundingBox(desks, ids) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const d of desks) {
    if (ids && !ids.has(d.id)) continue;
    const x = d.x || 0, y = d.y || 0;
    const w = d.w || 100, h = d.h || 60;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x + w > maxX) maxX = x + w;
    if (y + h > maxY) maxY = y + h;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

const UNDO_LIMIT = 30;

/* ───────────── main export ───────────── */

export default function LayoutPanel({
  floorId,
  layout,
  svgPreview,
  busy,
  components,
  onPublish,
  onSync,
  onDownload,
  onLayoutChange,
  onNotice,
  onError,
}) {
  const [mode, setMode] = useState('preview');

  return (
    <div className="layout-grid">
      <section className="preview-panel">
        <div className="panel-title">
          <div className="tab-bar">
            <button className={`tab-btn ${mode === 'preview' ? 'active' : ''}`} onClick={() => setMode('preview')}>
              <Eye size={16} /> Preview
            </button>
            <button className={`tab-btn ${mode === 'canvas' ? 'active' : ''}`} onClick={() => setMode('canvas')}>
              <Move size={16} /> Canvas
            </button>
            <button className={`tab-btn ${mode === 'json' ? 'active' : ''}`} onClick={() => setMode('json')}>
              <FileJson size={16} /> Draft JSON
            </button>
          </div>
          <div className="toolbar">
            <button className="icon-button" onClick={onDownload} disabled={!svgPreview} title="Скачать SVG">
              <Download size={18} />
            </button>
            <button className="tool-button" onClick={onPublish} disabled={busy || !layout} title="Опубликовать">
              <Rocket size={18} />
              <span>Publish</span>
            </button>
          </div>
        </div>
        {mode === 'preview' && <SvgPreview svgPreview={svgPreview} />}
        {mode === 'canvas' && (
          <CanvasEditor
            layout={layout}
            floorId={floorId}
            components={components}
            onLayoutChange={onLayoutChange}
            onNotice={onNotice}
            onError={onError}
          />
        )}
        {mode === 'json' && (
          <DraftJsonEditor layout={layout} floorId={floorId} onLayoutChange={onLayoutChange} onNotice={onNotice} onError={onError} />
        )}
      </section>

      <LayoutInspector layout={layout} busy={busy} onSync={onSync} />
    </div>
  );
}

/* ───────────── SVG preview ───────────── */

function SvgPreview({ svgPreview }) {
  return (
    <div className="svg-stage">
      {svgPreview ? (
        <div className="svg-preview" dangerouslySetInnerHTML={{ __html: svgPreview }} />
      ) : (
        <EmptyState text="Published SVG is not available" />
      )}
    </div>
  );
}

/* ───────────── Draft JSON editor ───────────── */

function DraftJsonEditor({ layout, floorId, onLayoutChange, onNotice, onError }) {
  const [jsonText, setJsonText] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (layout?.layout) {
      setJsonText(JSON.stringify(layout.layout, null, 2));
      setDirty(false);
    } else {
      setJsonText('');
    }
  }, [layout]);

  async function saveDraft() {
    if (!floorId) return;
    onError('');
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      onError('Invalid JSON');
      return;
    }
    setSaving(true);
    try {
      await apiFetch(`/floors/${floorId}/layout/draft`, {
        method: 'PUT',
        body: JSON.stringify({ version: layout?.version || 0, layout: parsed }),
      });
      setDirty(false);
      onNotice('Черновик сохранён');
      onLayoutChange();
    } catch (err) {
      onError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function discardDraft() {
    if (!floorId) return;
    if (!confirm('Удалить черновик? Будет восстановлена опубликованная версия.')) return;
    onError('');
    setSaving(true);
    try {
      await apiFetch(`/floors/${floorId}/layout/draft`, { method: 'DELETE' });
      onNotice('Черновик удалён');
      onLayoutChange();
    } catch (err) {
      onError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="json-editor">
      <div className="json-toolbar">
        {dirty && (
          <button className="tool-button sm" onClick={saveDraft} disabled={saving}>
            <Save size={16} />
            <span>{saving ? 'Saving...' : 'Save draft'}</span>
          </button>
        )}
        {layout?.status === 'draft' && (
          <button className="tool-button sm secondary" onClick={discardDraft} disabled={saving}>
            <Trash2 size={16} />
            <span>Discard draft</span>
          </button>
        )}
      </div>
      <textarea
        className="code-area full"
        value={jsonText}
        onChange={(e) => { setJsonText(e.target.value); setDirty(true); }}
        spellCheck={false}
        placeholder="No layout data"
      />
    </div>
  );
}

/* ───────────── Layout Inspector ───────────── */

function LayoutInspector({ layout, busy, onSync }) {
  const desks = layout?.layout?.desks || [];
  const groups = layout?.layout?.groups || [];
  const structures =
    (layout?.layout?.walls?.length || 0) +
    (layout?.layout?.boundaries?.length || 0) +
    (layout?.layout?.partitions?.length || 0) +
    (layout?.layout?.doors?.length || 0);

  return (
    <aside className="inspector">
      <div className="panel-title">
        <div>
          <h2>Layout info</h2>
          <p>Draft/published metadata</p>
        </div>
      </div>
      <div className="summary-list">
        <Metric label="Status" value={layout?.status || 'No layout'} />
        <Metric label="Desks" value={desks.length} />
        <Metric label="Groups" value={groups.length} />
        <Metric label="Structure" value={structures} />
        <Metric label="Version" value={layout?.version || '-'} />
        <Metric label="Published" value={layout?.published_at ? new Date(layout.published_at).toLocaleString() : '-'} />
      </div>
      <button className="tool-button wide" onClick={onSync} disabled={!layout || busy}>
        <Save size={18} />
        <span>Sync desks</span>
      </button>
      <div className="object-list">
        {desks.slice(0, 20).map((desk) => (
          <div className="object-row" key={desk.id}>
            <span>{desk.label || desk.id}</span>
            <strong>{desk.asset_type || 'workplace'}</strong>
          </div>
        ))}
        {desks.length > 20 && <div className="object-row muted"><span>+{desks.length - 20} more</span></div>}
        {!desks.length && <EmptyState text="No layout objects" />}
      </div>
    </aside>
  );
}
