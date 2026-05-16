import React, { useCallback, useRef, useState } from 'react';
import { FileUp, Upload, X } from 'lucide-react';
import { apiFetch } from '../lib/api.js';

export default function ImportModal({ floorId, open, onClose, onImported, onError }) {
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
          <h2><FileUp size={18} /> SVG Import</h2>
          <button className="icon-button" onClick={handleClose}><X size={18} /></button>
        </div>

        {!result ? (
          <div className="import-drop-zone" onDrop={handleDrop} onDragOver={(e) => e.preventDefault()}>
            {importing ? (
              <p>Classifying SVG elements...</p>
            ) : (
              <>
                <Upload size={32} />
                <p>Drop an SVG file here or click to browse</p>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".svg"
                  hidden
                  onChange={(e) => handleFile(e.target.files?.[0])}
                />
                <button className="tool-button" onClick={() => inputRef.current?.click()}>
                  Choose file
                </button>
              </>
            )}
          </div>
        ) : (
          <ImportResults result={result} floorId={floorId} onImported={onImported} onClose={handleClose} onError={onError} />
        )}
      </div>
    </div>
  );
}

function ImportResults({ result, floorId, onImported, onClose, onError }) {
  const [applying, setApplying] = useState(false);

  const items = result?.elements || result?.items || [];
  const typeCounts = items.reduce((acc, el) => {
    const t = el.type || el.classified_as || 'unknown';
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});

  async function applyImport() {
    setApplying(true);
    onError('');
    try {
      const desks = items
        .filter((el) => el.type === 'workplace' || el.type === 'desk')
        .map((el) => ({
          id: el.id || `imp-${Math.random().toString(36).slice(2, 8)}`,
          label: el.label || el.id || 'Desk',
          x: el.x || el.cx || 0,
          y: el.y || el.cy || 0,
          w: el.width || el.w || 100,
          h: el.height || el.h || 60,
          type: 'flex',
          asset_type: 'desk',
        }));

      if (!desks.length) {
        onError('No workplace elements found in SVG');
        setApplying(false);
        return;
      }

      await apiFetch(`/floors/${floorId}/layout/draft`, {
        method: 'PUT',
        body: JSON.stringify({ version: 0, layout: { desks } }),
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
      <h3>Classification Results</h3>
      <div className="import-summary">
        {Object.entries(typeCounts).map(([type, count]) => (
          <div key={type} className="import-type-row">
            <span className={`import-badge ${type}`}>{type}</span>
            <span>{count}</span>
          </div>
        ))}
        <div className="import-type-row total">
          <span>Total elements</span>
          <strong>{items.length}</strong>
        </div>
      </div>

      <div className="import-actions">
        <button className="tool-button" onClick={applyImport} disabled={applying}>
          {applying ? 'Applying...' : 'Apply as draft'}
        </button>
        <button className="tool-button secondary" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
