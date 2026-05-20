import React, { useEffect, useRef, useState } from 'react';
import {
  BookTemplate,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clock,
  Download,
  Eye,
  FileDown,
  FilePlus2,
  FileJson,
  FileUp,
  GitCompareArrows,
  ImageIcon,
  ListChecks,
  Move,
  Package,
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

function ptFromAny(point) {
  if (!point) return { x: 0, y: 0 };
  return Array.isArray(point)
    ? { x: Number(point[0]), y: Number(point[1]) }
    : { x: Number(point.x ?? 0), y: Number(point.y ?? 0) };
}

function structurePoints(item) {
  const pts = Array.isArray(item?.pts)
    ? item.pts
    : (Array.isArray(item?.points) ? item.points : []);
  return pts.map(ptFromAny).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
}

function pointInPolygon(px, py, points) {
  if (!Array.isArray(points) || points.length < 3) return false;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    const crosses = ((a.y > py) !== (b.y > py)) &&
      (px < ((b.x - a.x) * (py - a.y)) / Math.max(1e-9, b.y - a.y) + a.x);
    if (crosses) inside = !inside;
  }
  return inside;
}

function polygonArea(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) / 2;
}

function orientation(a, b, c) {
  return (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
}

function onSegment(a, b, c) {
  return Math.min(a.x, c.x) <= b.x && b.x <= Math.max(a.x, c.x) &&
    Math.min(a.y, c.y) <= b.y && b.y <= Math.max(a.y, c.y);
}

function segmentsIntersect(a, b, c, d) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if ((o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0)) return true;
  if (Math.abs(o1) < 1e-9 && onSegment(a, c, b)) return true;
  if (Math.abs(o2) < 1e-9 && onSegment(a, d, b)) return true;
  if (Math.abs(o3) < 1e-9 && onSegment(c, a, d)) return true;
  if (Math.abs(o4) < 1e-9 && onSegment(c, b, d)) return true;
  return false;
}

function boundarySelfIntersects(points) {
  if (!Array.isArray(points) || points.length < 4) return false;
  const segments = points.map((point, index) => ({ a: point, b: points[(index + 1) % points.length] }));
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const adjacent = Math.abs(i - j) === 1 || (i === 0 && j === segments.length - 1);
      if (adjacent) continue;
      if (segmentsIntersect(segments[i].a, segments[i].b, segments[j].a, segments[j].b)) return true;
    }
  }
  return false;
}

function deskRect(desk) {
  const w = Math.max(1, Number(desk?.w ?? desk?.width ?? desk?.size?.w ?? desk?.size?.width ?? desk?.geometry?.w ?? desk?.geometry?.width ?? 100));
  const h = Math.max(1, Number(desk?.h ?? desk?.height ?? desk?.size?.h ?? desk?.size?.height ?? desk?.geometry?.h ?? desk?.geometry?.height ?? 60));
  const directX = Number(desk?.x ?? desk?.left ?? desk?.position?.x ?? desk?.geometry?.x);
  const directY = Number(desk?.y ?? desk?.top ?? desk?.position?.y ?? desk?.geometry?.y);
  const centerX = Number(desk?.cx ?? desk?.center_x ?? desk?.center?.x);
  const centerY = Number(desk?.cy ?? desk?.center_y ?? desk?.center?.y);
  return {
    x: Number.isFinite(directX) ? directX : (Number.isFinite(centerX) ? centerX - w / 2 : 0),
    y: Number.isFinite(directY) ? directY : (Number.isFinite(centerY) ? centerY - h / 2 : 0),
    w,
    h,
  };
}

function rectsOverlap(a, b) {
  const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return ix > 1 && iy > 1;
}

function validateLayoutMap(layoutDoc) {
  const issues = [];
  if (!layoutDoc) {
    return [{ level: 'error', title: 'Нет карты', detail: 'Создайте черновик или импортируйте SVG перед проверкой.' }];
  }
  const desks = Array.isArray(layoutDoc.desks) ? layoutDoc.desks : [];
  const boundaries = Array.isArray(layoutDoc.boundaries) ? layoutDoc.boundaries : [];

  if (!desks.length) {
    issues.push({ level: 'warning', title: 'Нет объектов', detail: 'На карте нет рабочих мест или визуальных объектов.' });
  }
  if (!boundaries.length) {
    issues.push({ level: 'warning', title: 'Нет контура этажа', detail: 'Проверка объектов вне зоны будет ограничена.' });
  }

  const seen = new Map();
  desks.forEach((desk, index) => {
    const id = String(desk?.id || '');
    if (!id) {
      issues.push({ level: 'error', title: 'Объект без id', detail: `Позиция #${index + 1} не сможет стабильно сохраняться.` });
    } else if (seen.has(id)) {
      issues.push({ level: 'error', title: 'Дубликат id объекта', detail: `${id} встречается минимум два раза.` });
    }
    seen.set(id, true);

    const rect = deskRect(desk);
    if (![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite)) {
      issues.push({ level: 'error', title: 'Некорректная геометрия объекта', detail: `${desk?.label || id || `#${index + 1}`}: x/y/w/h должны быть числами.` });
    }
    if ((desk?.asset_type === 'workplace' || desk?.bookable) && !desk?.workplace_id) {
      issues.push({ level: 'error', title: 'Рабочее место без workplace_id', detail: `${desk?.label || id || `#${index + 1}`} не свяжется с бронированием.` });
    }
  });

  for (let i = 0; i < desks.length; i++) {
    for (let j = i + 1; j < desks.length; j++) {
      if (rectsOverlap(deskRect(desks[i]), deskRect(desks[j]))) {
        issues.push({
          level: 'warning',
          title: 'Объекты пересекаются',
          detail: `${desks[i].label || desks[i].id || i + 1} и ${desks[j].label || desks[j].id || j + 1}`,
        });
      }
    }
  }

  const boundaryPolygons = boundaries.map(structurePoints).filter((points) => points.length >= 3);
  boundaries.forEach((boundary, index) => {
    const points = structurePoints(boundary);
    if (points.length < 3) {
      issues.push({ level: 'warning', title: 'Контур не замкнут', detail: `Контур #${index + 1} содержит меньше 3 точек.` });
      return;
    }
    if (polygonArea(points) < 100) {
      issues.push({ level: 'warning', title: 'Слишком маленький контур', detail: `Контур #${index + 1} почти не имеет площади.` });
    }
    if (boundarySelfIntersects(points)) {
      issues.push({ level: 'error', title: 'Контур пересекает сам себя', detail: `Контур #${index + 1} нужно поправить перед публикацией.` });
    }
  });

  if (boundaryPolygons.length) {
    desks.forEach((desk) => {
      const rect = deskRect(desk);
      const cx = rect.x + rect.w / 2;
      const cy = rect.y + rect.h / 2;
      if (!boundaryPolygons.some((points) => pointInPolygon(cx, cy, points))) {
        issues.push({
          level: 'warning',
          title: 'Объект вне контура',
          detail: `${desk.label || desk.id || 'Объект'} находится за пределами зоны этажа.`,
        });
      }
    });
  }

  return issues;
}

function validationSummary(issues) {
  const errors = issues.filter((issue) => issue.level === 'error').length;
  const warnings = issues.filter((issue) => issue.level !== 'error').length;
  return { errors, warnings };
}

/* ───────────── main export ───────────── */

export default function LayoutPanel({
  floorId,
  selectedFloor,
  layout,
  svgPreview,
  busy,
  components,
  onPublish,
  onSync,
  onDownload,
  onLayoutChange,
  onDirtyChange,
  onNotice,
  onError,
}) {
  const [mode, setMode] = useState('preview');
  const [importOpen, setImportOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [blockLibOpen, setBlockLibOpen] = useState(false);
  const [blocks, setBlocks] = useState([]);
  const [creatingBlank, setCreatingBlank] = useState(false);
  const [canvasDirty, setCanvasDirty] = useState(false);
  const reportDirty = (v) => { setCanvasDirty(v); onDirtyChange?.(v); };
  const [validationIssues, setValidationIssues] = useState([]);
  const [validationOpen, setValidationOpen] = useState(false);
  const canvasRef = useRef(null);

  useEffect(() => {
    if (templateOpen) {
      apiFetch('/templates').then(setTemplates).catch(() => setTemplates([]));
    }
  }, [templateOpen]);

  useEffect(() => {
    if (blockLibOpen) {
      apiFetch('/blocks').then(setBlocks).catch(() => setBlocks([]));
    }
  }, [blockLibOpen]);

  useEffect(() => {
    reportDirty(false);
    setValidationIssues([]);
    setValidationOpen(false);
  }, [floorId, layout?.id]);

  useEffect(() => {
    if (mode !== 'canvas') reportDirty(false);
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

  async function saveAsTemplate() {
    const currentLayout = canvasRef.current?.getCurrentLayout?.();
    if (!currentLayout) { onError('Нет данных для сохранения шаблона'); return; }
    const name = prompt('Название шаблона:');
    if (!name) return;
    try {
      await apiFetch('/templates', {
        method: 'POST',
        body: JSON.stringify({ name, category: 'custom', layout: currentLayout }),
      });
      onNotice('Шаблон сохранён');
      setTemplateOpen(false);
    } catch (err) {
      onError(err.message);
    }
  }

  async function applyTemplate(tmpl) {
    if (!floorId) return;
    if (layout && !confirm('Заменить текущий черновик шаблоном?')) return;
    try {
      const layoutData = typeof tmpl.layout === 'string' ? JSON.parse(tmpl.layout) : tmpl.layout;
      await apiFetch(`/floors/${floorId}/layout/draft`, {
        method: 'PUT',
        body: JSON.stringify({ version: layout?.version || 0, layout: layoutData }),
      });
      onNotice(`Шаблон «${tmpl.name}» применён`);
      await onLayoutChange?.();
      setMode('canvas');
      setTemplateOpen(false);
    } catch (err) {
      onError(err.message);
    }
  }

  async function deleteTemplate(id) {
    if (!confirm('Удалить шаблон?')) return;
    try {
      await apiFetch(`/templates/${id}`, { method: 'DELETE' });
      setTemplates((prev) => prev.filter((t) => t.id !== id));
      onNotice('Шаблон удалён');
    } catch (err) {
      onError(err.message);
    }
  }

  async function deleteBlock(id) {
    if (!confirm('Удалить блок?')) return;
    try {
      await apiFetch(`/blocks/${id}`, { method: 'DELETE' });
      setBlocks((prev) => prev.filter((b) => b.id !== id));
      onNotice('Блок удалён');
    } catch (err) {
      onError(err.message);
    }
  }

  function insertBlock(block) {
    if (mode !== 'canvas') {
      onError('Переключитесь в режим холста для вставки блока');
      return;
    }
    const objects = Array.isArray(block.objects) ? block.objects : JSON.parse(block.objects || '[]');
    if (!objects.length) { onError('Блок пустой'); return; }
    canvasRef.current?.insertObjects?.(objects);
    setBlockLibOpen(false);
  }

  function exportPdf() {
    const svgContent = svgPreview || (canvasRef.current?.getCurrentLayout
      ? null : null);
    if (!svgPreview) {
      onError('Сначала опубликуйте карту для экспорта в PDF');
      return;
    }
    const printWin = window.open('', '_blank');
    if (!printWin) { onError('Попап заблокирован браузером'); return; }
    const floorName = selectedFloor ? selectedFloor.name : `Этаж ${floorId}`;
    printWin.document.write(`<!DOCTYPE html>
<html><head><title>${floorName} — PDF</title>
<style>
  @page { size: landscape; margin: 12mm; }
  body { margin: 0; font-family: system-ui, sans-serif; }
  h1 { font-size: 16px; margin: 0 0 8px; }
  svg { width: 100%; height: auto; max-height: 90vh; }
</style></head><body>
<h1>${floorName}</h1>
${svgPreview}
<script>window.onload=function(){window.print();}<\/script>
</body></html>`);
    printWin.document.close();
  }

  async function saveCanvasIfNeeded() {
    if (mode !== 'canvas' || !canvasRef.current?.saveIfDirty) return null;
    return canvasRef.current.saveIfDirty();
  }

  function currentLayoutDoc() {
    return mode === 'canvas' && canvasRef.current?.getCurrentLayout
      ? canvasRef.current.getCurrentLayout()
      : layout?.layout;
  }

  function runValidation({ silent = false } = {}) {
    const issues = validateLayoutMap(currentLayoutDoc());
    setValidationIssues(issues);
    setValidationOpen(true);
    const summary = validationSummary(issues);
    if (!silent) {
      if (summary.errors) onError(`Проверка карты: ${summary.errors} ошибок, ${summary.warnings} предупреждений`);
      else if (summary.warnings) onNotice(`Проверка карты: ошибок нет, предупреждений ${summary.warnings}`);
      else onNotice('Проверка карты: проблем не найдено');
    }
    return issues;
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
    const currentLayout = currentLayoutDoc();
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
            <button className="icon-button" onClick={() => switchMode('json')} data-tip="JSON черновика" title="JSON черновика">
              <FileJson size={18} />
            </button>
            <button className="icon-button" onClick={() => setImportOpen(true)} data-tip="Импортировать SVG как черновик">
              <FileUp size={18} />
            </button>
            <button
              className="icon-button"
              onClick={() => { switchMode('canvas'); setTimeout(() => canvasRef.current?.triggerBgUpload?.(), 100); }}
              data-tip="Загрузить подложку (PNG, JPEG, PDF) для обрисовки"
              title="Загрузить подложку (PNG, JPEG, PDF)"
            >
              <ImageIcon size={18} />
            </button>
            <button className="icon-button" onClick={() => setTemplateOpen(!templateOpen)} data-tip="Шаблоны планировок">
              <BookTemplate size={18} />
            </button>
            <button className="icon-button" onClick={() => setBlockLibOpen(!blockLibOpen)} data-tip="Библиотека блоков">
              <Package size={18} />
            </button>
            <button className="icon-button" onClick={() => setHistoryOpen(true)} data-tip="История версий">
              <Clock size={18} />
            </button>
            <button className="icon-button" onClick={handleDownload} disabled={!layout && !svgPreview} data-tip="Скачать SVG файл карты">
              <Download size={18} />
            </button>
            <button className="icon-button" onClick={exportPdf} disabled={!svgPreview} data-tip="Экспортировать в PDF (через печать)">
              <FileDown size={18} />
            </button>
            <button
              className="icon-button"
              onClick={() => runValidation()}
              disabled={!layout && mode !== 'canvas'}
              data-tip="Проверить карту на ошибки"
            >
              <ListChecks size={18} />
            </button>
            <button
              className="tool-button"
              onClick={handlePublish}
              disabled={busy || !layout || (layout.status !== 'draft' && !canvasDirty)}
              data-tip="Опубликовать черновик"
            >
              <Rocket size={18} />
              <span>Опубликовать</span>
            </button>
          </div>
        </div>
        {/* Template panel */}
        {templateOpen && (
          <div className="template-panel">
            <div className="template-panel-header">
              <strong>Шаблоны</strong>
              {mode === 'canvas' && (
                <button className="tool-button secondary" onClick={saveAsTemplate}>
                  <Save size={14} /> Сохранить как шаблон
                </button>
              )}
            </div>
            {templates.length === 0 && <p className="template-empty">Нет сохранённых шаблонов</p>}
            <div className="template-list">
              {templates.map((t) => (
                <div key={t.id} className="template-card">
                  <div className="template-info">
                    <strong>{t.name}</strong>
                    {t.description && <span>{t.description}</span>}
                    <span className="template-category">{t.category}</span>
                  </div>
                  <div className="template-actions">
                    <button className="tool-button" onClick={() => applyTemplate(t)} disabled={!floorId}>
                      Применить
                    </button>
                    <button className="icon-button danger" onClick={() => deleteTemplate(t.id)} title="Удалить">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {/* Block library panel */}
        {blockLibOpen && (
          <div className="template-panel">
            <div className="template-panel-header">
              <strong>Библиотека блоков</strong>
              {mode === 'canvas' && (
                <span className="template-hint">Выберите объекты на холсте и нажмите <Package size={12} style={{verticalAlign:'middle'}} /> в тулбаре чтобы сохранить блок</span>
              )}
            </div>
            {blocks.length === 0 && <p className="template-empty">Нет сохранённых блоков. Выделите объекты на холсте и сохраните как блок.</p>}
            <div className="template-list">
              {blocks.map((b) => (
                <div key={b.id} className="template-card">
                  <div className="template-info">
                    <strong>{b.name}</strong>
                    {b.description && <span>{b.description}</span>}
                    <span className="template-category">{b.category} · {Array.isArray(b.objects) ? b.objects.length : '?'} объектов</span>
                  </div>
                  <div className="template-actions">
                    <button
                      className="tool-button"
                      onClick={() => insertBlock(b)}
                      disabled={mode !== 'canvas'}
                      title={mode !== 'canvas' ? 'Откройте холст чтобы вставить' : 'Вставить на холст'}
                    >
                      Вставить
                    </button>
                    <button className="icon-button danger" onClick={() => deleteBlock(b.id)} title="Удалить блок">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {validationOpen && (
          <ValidationPanel
            issues={validationIssues}
            onClose={() => setValidationOpen(false)}
            onOpenCanvas={() => switchMode('canvas')}
          />
        )}

        {mode === 'preview' && <SvgPreview svgPreview={svgPreview} layout={layout} onOpenCanvas={() => switchMode('canvas')} />}
        {mode === 'canvas' && (
          <CanvasEditor
            ref={canvasRef}
            layout={layout}
            floorId={floorId}
            components={components}
            onLayoutChange={onLayoutChange}
            onDirtyChange={reportDirty}
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

/* ───────────── Status / validation ───────────── */

function PublishStatusStrip({ layout, svgPreview, canvasDirty, validationIssues }) {
  const summary = validationSummary(validationIssues || []);
  const hasDraft = layout?.status === 'draft';
  const hasPublishedPreview = !!svgPreview;
  return (
    <div className="publish-status-strip">
      <span className={`status-chip ${hasDraft || canvasDirty ? 'warning' : 'ok'}`}>
        <GitCompareArrows size={14} />
        {canvasDirty ? 'Черновик изменён' : hasDraft ? 'Есть черновик' : 'Черновик не активен'}
      </span>
      <span className={`status-chip ${hasPublishedPreview ? 'ok' : 'warning'}`}>
        {hasPublishedPreview ? <CircleCheck size={14} /> : <CircleAlert size={14} />}
        {hasPublishedPreview ? 'Предпросмотр доступен' : 'Предпросмотр не создан'}
      </span>
      <span className={`status-chip ${summary.errors ? 'error' : summary.warnings ? 'warning' : 'ok'}`}>
        <ListChecks size={14} />
        {validationIssues.length
          ? `${summary.errors} ошибок · ${summary.warnings} предупреждений`
          : 'Проверка не запускалась'}
      </span>
      {layout?.published_at && (
        <span className="status-chip neutral">
          Опубликовано {new Date(layout.published_at).toLocaleString()}
        </span>
      )}
    </div>
  );
}

function ValidationPanel({ issues, onClose, onOpenCanvas }) {
  const summary = validationSummary(issues || []);
  return (
    <div className="validation-panel">
      <div className="validation-header">
        <div>
          <strong>Проверка карты</strong>
          <span>{summary.errors} ошибок · {summary.warnings} предупреждений</span>
        </div>
        <div className="validation-actions">
          <button className="tool-button secondary sm" onClick={onOpenCanvas}>Открыть холст</button>
          <button className="icon-button" onClick={onClose} title="Закрыть">×</button>
        </div>
      </div>
      {!issues.length ? (
        <div className="validation-empty">
          <CircleCheck size={18} />
          Проблем не найдено
        </div>
      ) : (
        <div className="validation-list">
          {issues.map((issue, index) => (
            <div className={`validation-item ${issue.level}`} key={`${issue.title}-${index}`}>
              {issue.level === 'error' ? <CircleAlert size={16} /> : <CircleCheck size={16} />}
              <div>
                <strong>{issue.title}</strong>
                <span>{issue.detail}</span>
              </div>
            </div>
          ))}
        </div>
      )}
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
  const [collapsed, setCollapsed] = useState(false);
  const desks = layout?.layout?.desks || [];
  const groups = layout?.layout?.groups || [];
  const structures =
    (layout?.layout?.walls?.length || 0) +
    (layout?.layout?.boundaries?.length || 0) +
    (layout?.layout?.partitions?.length || 0) +
    (layout?.layout?.doors?.length || 0);

  return (
    <aside className={`inspector ${collapsed ? 'inspector-collapsed' : ''}`}>
      <div className="panel-title inspector-header" onClick={() => setCollapsed(!collapsed)} style={{ cursor: 'pointer', userSelect: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ChevronRight size={16} className={`inspector-chevron ${collapsed ? '' : 'inspector-chevron-open'}`} />
          <div>
            <h2>Информация о плане</h2>
            {collapsed && <span className="inspector-mini">{statusLabel(layout?.status)} · {desks.length} об. · v{layout?.version || '-'}</span>}
            {!collapsed && <p>Метаданные черновика и публикации</p>}
          </div>
        </div>
      </div>
      {!collapsed && (
        <>
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
        </>
      )}
    </aside>
  );
}
