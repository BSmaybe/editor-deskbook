import React, { useCallback, useRef, useState } from 'react';
import { FileUp, Upload, X } from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import { structureLabel } from '../lib/i18n.js';

export default function ImportModal({ floorId, layoutVersion = 0, open, onClose, onImported, onError }) {
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [importing, setImporting] = useState(false);
  const inputRef = useRef(null);

  const reset = useCallback(() => {
    setFile(null);
    setResult(null);
    setImporting(false);
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  async function handleFile(f) {
    if (!f || !floorId) return;
    setFile(f);
    setImporting(true);
    onError('');
    try {
      const text = await f.text();
      const res = await apiFetch(`/floors/${floorId}/layout/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'image/svg+xml' },
        body: text,
      });
      setResult(res);
    } catch (err) {
      onError(err.message);
    } finally {
      setImporting(false);
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (f && f.name.endsWith('.svg')) handleFile(f);
  }

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal-content import-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2><FileUp size={18} /> Импорт SVG</h2>
          <button className="icon-button" onClick={handleClose} title="Закрыть"><X size={18} /></button>
        </div>

        {!result ? (
          <div className="import-drop-zone" onDrop={handleDrop} onDragOver={(e) => e.preventDefault()}>
            {importing ? (
              <p>Распознаём элементы SVG...</p>
            ) : (
              <>
                <Upload size={32} />
                <p>Перетащите SVG сюда или выберите файл</p>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".svg"
                  hidden
                  onChange={(e) => handleFile(e.target.files?.[0])}
                />
                <button className="tool-button" onClick={() => inputRef.current?.click()}>
                  Выбрать файл
                </button>
              </>
            )}
          </div>
        ) : (
          <ImportResults
            result={result}
            floorId={floorId}
            layoutVersion={layoutVersion}
            onImported={onImported}
            onClose={handleClose}
            onError={onError}
          />
        )}
      </div>
    </div>
  );
}

function typedStructures(result, type) {
  return (result?.[type] || []).map((item) => ({ ...item, type }));
}

function normalizeImportResult(result) {
  const structures = [
    ...typedStructures(result, 'walls'),
    ...typedStructures(result, 'boundaries'),
    ...typedStructures(result, 'partitions'),
    ...typedStructures(result, 'doors'),
    ...typedStructures(result, 'uncertain'),
  ];
  const legacyItems = result?.elements || result?.items || [];
  return legacyItems.length ? legacyItems : structures;
}

function buildTypeCounts(result, items) {
  const stats = result?.stats || {};
  const fromStats = {
    walls: stats.walls || 0,
    boundaries: stats.boundaries || 0,
    partitions: stats.partitions || 0,
    doors: stats.doors || 0,
    uncertain: stats.uncertain || 0,
    skipped: stats.skipped || 0,
  };
  if (Object.values(fromStats).some((count) => count > 0)) {
    return Object.fromEntries(Object.entries(fromStats).filter(([, count]) => count > 0));
  }
  return items.reduce((acc, el) => {
    const t = el.type || el.classified_as || 'unknown';
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});
}

function buildImportedLayout(result, items) {
  const desks = items
    .filter((el) => el.type === 'workplace' || el.type === 'desk')
    .map((el) => ({
      id: el.id || `imp-${Math.random().toString(36).slice(2, 8)}`,
      label: el.label || el.id || 'Объект',
      x: el.x || el.cx || 0,
      y: el.y || el.cy || 0,
      w: el.width || el.w || 100,
      h: el.height || el.h || 60,
      type: 'flex',
      asset_type: 'desk',
    }));

  return {
    v: 2,
    vb: Array.isArray(result?.vb) && result.vb.length === 4 ? result.vb : [0, 0, 1000, 1000],
    building_id: 'imported-building',
    storey_id: 'imported-floor',
    zone_id: 'main',
    components: [],
    boundaries: result?.boundaries || [],
    walls: result?.walls || [],
    partitions: result?.partitions || [],
    doors: result?.doors || [],
    desks,
  };
}

function ImportResults({ result, floorId, layoutVersion, onImported, onClose, onError }) {
  const [applying, setApplying] = useState(false);

  const items = normalizeImportResult(result);
  const typeCounts = buildTypeCounts(result, items);
  const totalElements = result?.stats?.total_elements ?? items.length;
  const recognizedElements = items.filter((item) => item.type !== 'uncertain').length;

  async function applyImport() {
    setApplying(true);
    onError('');
    try {
      const layout = buildImportedLayout(result, items);
      const hasImportableElements =
        layout.desks.length ||
        layout.walls.length ||
        layout.boundaries.length ||
        layout.partitions.length ||
        layout.doors.length;
      if (!hasImportableElements) {
        onError('В SVG не найдены элементы плана, которые можно импортировать');
        setApplying(false);
        return;
      }

      await apiFetch(`/floors/${floorId}/layout/draft`, {
        method: 'PUT',
        body: JSON.stringify({ version: layoutVersion || 0, layout }),
      });
      onImported();
      onClose();
    } catch (err) {
      onError(err.message);
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="import-results">
      <h3>Результаты распознавания</h3>
      <div className="import-summary">
        {Object.entries(typeCounts).map(([type, count]) => (
          <div key={type} className="import-type-row">
            <span className={`import-badge ${type}`}>{structureLabel(type)}</span>
            <span>{count}</span>
          </div>
        ))}
        <div className="import-type-row total">
          <span>Всего элементов</span>
          <strong>{totalElements}</strong>
        </div>
        <div className="import-type-row total">
          <span>Можно импортировать</span>
          <strong>{recognizedElements}</strong>
        </div>
      </div>

      <div className="import-actions">
        <button className="tool-button" onClick={applyImport} disabled={applying}>
          {applying ? 'Применение...' : 'Применить как черновик'}
        </button>
        <button className="tool-button secondary" onClick={onClose}>Отмена</button>
      </div>
    </div>
  );
}
