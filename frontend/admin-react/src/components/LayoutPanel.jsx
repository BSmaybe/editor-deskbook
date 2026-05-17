import React, { useEffect, useRef, useState } from 'react';
import {
  Clock,
  Download,
  Eye,
  FilePlus2,
  FileJson,
  FileUp,
  Move,
  Rocket,
  Save,
  Trash2,
} from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import { statusLabel } from '../lib/i18n.js';
import { EmptyState, Metric } from './ui.jsx';
import CanvasEditor from './CanvasEditor.jsx';
import ImportModal from './ImportModal.jsx';
import HistoryModal from './HistoryModal.jsx';

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

function createBlankLayout(floorId) {
  const suffix = String(floorId || 'new').replace(/[^A-Za-z0-9_-]+/g, '-');
  return {
    v: 2,
    vb: [0, 0, 1200, 800],
    building_id: `building-${suffix}`,
    storey_id: suffix,
    zone_id: 'main',
    components: [],
    boundaries: [],
    walls: [],
    partitions: [],
    doors: [],
    desks: [],
  };
}

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
  const [importOpen, setImportOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [creatingBlank, setCreatingBlank] = useState(false);
  const [canvasDirty, setCanvasDirty] = useState(false);
  const canvasRef = useRef(null);

  useEffect(() => {
    setCanvasDirty(false);
  }, [floorId, layout?.id]);

  useEffect(() => {
    if (mode !== 'canvas') setCanvasDirty(false);
  }, [mode]);

  async function createBlankDraft() {
    if (!floorId) return;
    if (layout && !confirm('Заменить текущий черновик пустой картой?')) return;
    setCreatingBlank(true);
    onError('');
    try {
      await apiFetch(`/floors/${floorId}/layout/draft`, {
        method: 'PUT',
        body: JSON.stringify({
          version: layout?.version || 0,
          layout: createBlankLayout(floorId),
        }),
      });
      onNotice('Пустой черновик создан');
      await onLayoutChange?.();
      setMode('canvas');
    } catch (err) {
      onError(err.message);
    } finally {
      setCreatingBlank(false);
    }
  }

  async function saveCanvasIfNeeded() {
    if (mode !== 'canvas' || !canvasRef.current?.saveIfDirty) return null;
    return canvasRef.current.saveIfDirty();
  }

  async function switchMode(nextMode) {
    if (nextMode === mode) return;
    if (mode === 'canvas' && canvasRef.current?.hasDirty?.()) {
      try {
        await canvasRef.current.saveIfDirty();
      } catch {
        return;
      }
    }
    setMode(nextMode);
  }

  async function handlePublish() {
    onError('');
    try {
      const saved = await saveCanvasIfNeeded();
      const savedDraft = saved && saved.saved !== false;
      if (!savedDraft && layout?.status !== 'draft') {
        onError('Нет черновика для публикации. Измените карту или создайте пустой черновик.');
        return;
      }
      await onPublish();
    } catch {
      // CanvasEditor already surfaced the specific save error.
    }
  }

  async function handleDownload() {
    const currentLayout = mode === 'canvas' && canvasRef.current?.getCurrentLayout
      ? canvasRef.current.getCurrentLayout()
      : layout?.layout;
    await onDownload(currentLayout || null);
  }

  return (
    <div className="layout-grid">
      <section className="preview-panel">
        <div className="panel-title">
          <div className="tab-bar">
            <button className={`tab-btn ${mode === 'preview' ? 'active' : ''}`} onClick={() => switchMode('preview')}>
              <Eye size={16} /> Предпросмотр
            </button>
            <button className={`tab-btn ${mode === 'canvas' ? 'active' : ''}`} onClick={() => switchMode('canvas')}>
              <Move size={16} /> Холст
            </button>
            <button className={`tab-btn ${mode === 'json' ? 'active' : ''}`} onClick={() => switchMode('json')}>
              <FileJson size={16} /> JSON черновика
            </button>
          </div>
          <div className="toolbar">
            {!layout && (
              <button
                className="tool-button secondary"
                onClick={createBlankDraft}
                disabled={!floorId || creatingBlank}
                title="Создать пустой черновик"
              >
                <FilePlus2 size={18} />
                <span>{creatingBlank ? 'Создание...' : 'Пустой черновик'}</span>
              </button>
            )}
            <button className="icon-button" onClick={() => setImportOpen(true)} title="Импорт SVG">
              <FileUp size={18} />
            </button>
            <button className="icon-button" onClick={() => setHistoryOpen(true)} title="История">
              <Clock size={18} />
            </button>
            <button className="icon-button" onClick={handleDownload} disabled={!layout && !svgPreview} title="Скачать текущий SVG">
              <Download size={18} />
            </button>
            <button
              className="tool-button"
              onClick={handlePublish}
              disabled={busy || !layout || (layout.status !== 'draft' && !canvasDirty)}
              title="Опубликовать"
            >
              <Rocket size={18} />
              <span>Опубликовать</span>
            </button>
          </div>
        </div>
        {mode === 'preview' && <SvgPreview svgPreview={svgPreview} layout={layout} onOpenCanvas={() => switchMode('canvas')} />}
        {mode === 'canvas' && (
          <CanvasEditor
            ref={canvasRef}
            layout={layout}
            floorId={floorId}
            components={components}
            onLayoutChange={onLayoutChange}
            onDirtyChange={setCanvasDirty}
            onNotice={onNotice}
            onError={onError}
          />
        )}
        {mode === 'json' && (
          <DraftJsonEditor layout={layout} floorId={floorId} onLayoutChange={onLayoutChange} onNotice={onNotice} onError={onError} />
        )}
      </section>

      <LayoutInspector layout={layout} busy={busy} onSync={onSync} />

      <ImportModal
        floorId={floorId}
        layoutVersion={layout?.version || 0}
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => { onLayoutChange(); onNotice('SVG импортирован как черновик'); }}
        onError={onError}
      />
      <HistoryModal
        floorId={floorId}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onRestored={() => { onLayoutChange(); onNotice('Версия восстановлена'); }}
        onError={onError}
      />
    </div>
  );
}

/* ───────────── SVG preview ───────────── */

function SvgPreview({ svgPreview, layout, onOpenCanvas }) {
  return (
    <div className="svg-stage">
      {svgPreview ? (
        <div className="svg-preview" dangerouslySetInnerHTML={{ __html: svgPreview }} />
      ) : layout ? (
        <div className="empty-state">
          <div className="empty-stack">
            <strong>Опубликованный SVG недоступен</strong>
            <span>Черновик есть. Откройте холст для редактирования или опубликуйте черновик, чтобы создать предпросмотр.</span>
            <button className="tool-button secondary" onClick={onOpenCanvas}>Открыть холст</button>
          </div>
        </div>
      ) : (
        <EmptyState text="Опубликованного предпросмотра пока нет" />
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
      onError('Некорректный JSON');
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
            <span>{saving ? 'Сохранение...' : 'Сохранить черновик'}</span>
          </button>
        )}
        {layout?.status === 'draft' && (
          <button className="tool-button sm secondary" onClick={discardDraft} disabled={saving}>
            <Trash2 size={16} />
            <span>Удалить черновик</span>
          </button>
        )}
      </div>
      <textarea
        className="code-area full"
        value={jsonText}
        onChange={(e) => { setJsonText(e.target.value); setDirty(true); }}
        spellCheck={false}
        placeholder="Нет данных карты"
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
          <h2>Информация о плане</h2>
          <p>Метаданные черновика и публикации</p>
        </div>
      </div>
      <div className="summary-list">
        <Metric label="Статус" value={statusLabel(layout?.status)} />
        <Metric label="Объекты" value={desks.length} />
        <Metric label="Группы" value={groups.length} />
        <Metric label="Конструкции" value={structures} />
        <Metric label="Версия" value={layout?.version || '-'} />
        <Metric label="Опубликовано" value={layout?.published_at ? new Date(layout.published_at).toLocaleString() : '-'} />
      </div>
      <button className="tool-button wide" onClick={onSync} disabled={!layout || busy}>
        <Save size={18} />
        <span>Синхронизировать объекты</span>
      </button>
    </aside>
  );
}
