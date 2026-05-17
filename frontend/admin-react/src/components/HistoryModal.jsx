import React, { useCallback, useEffect, useState } from 'react';
import { Clock, RotateCcw, X } from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import { statusLabel } from '../lib/i18n.js';

export default function HistoryModal({ floorId, open, onClose, onRestored, onError }) {
  const [revisions, setRevisions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(null);

  const load = useCallback(async () => {
    if (!floorId || !open) return;
    setLoading(true);
    onError('');
    try {
      const data = await apiFetch(`/floors/${floorId}/layout/revisions`);
      setRevisions(Array.isArray(data) ? data : []);
    } catch (err) {
      onError(err.message);
    } finally {
      setLoading(false);
    }
  }, [floorId, open, onError]);

  useEffect(() => { load(); }, [load]);

  async function restore(revisionId) {
    setRestoring(revisionId);
    onError('');
    try {
      await apiFetch(`/floors/${floorId}/layout/revisions/${revisionId}/restore`, {
        method: 'POST',
      });
      onRestored();
      onClose();
    } catch (err) {
      onError(err.message);
    } finally {
      setRestoring(null);
    }
  }

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content history-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2><Clock size={18} /> История версий</h2>
          <button className="icon-button" onClick={onClose} title="Закрыть"><X size={18} /></button>
        </div>

        {loading ? (
          <p className="modal-loading">Загружаем версии...</p>
        ) : revisions.length === 0 ? (
          <p className="modal-empty">Версий пока нет</p>
        ) : (
          <div className="revision-list">
            {revisions.map((rev) => (
              <div key={rev.revision_id || rev.id} className="revision-row">
                <div className="revision-info">
                  <strong>v{rev.version}</strong>
                  <span className={`revision-status ${rev.status}`}>{statusLabel(rev.status)}</span>
                  <span className="revision-date">
                    {rev.published_at
                      ? new Date(rev.published_at).toLocaleString()
                      : rev.updated_at
                        ? new Date(rev.updated_at).toLocaleString()
                        : '—'}
                  </span>
                </div>
                <button
                  className="tool-button sm"
                  onClick={() => restore(rev.revision_id || rev.id)}
                  disabled={restoring === (rev.revision_id || rev.id)}
                  title="Восстановить эту версию"
                >
                  <RotateCcw size={14} />
                  <span>{restoring === (rev.revision_id || rev.id) ? '...' : 'Восстановить'}</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
