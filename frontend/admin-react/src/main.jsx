import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Boxes, Building2, Layers3, LogOut, RefreshCw } from 'lucide-react';
import { apiFetch, login, logout, tokenFromStorage, usernameFromStorage } from './lib/api.js';
import { LoginScreen, Notice } from './components/ui.jsx';
import LayoutPanel from './components/LayoutPanel.jsx';
import ComponentPanel from './components/ComponentPanel.jsx';
import BuildingPanel from './components/BuildingPanel.jsx';
import './styles.css';

function App() {
  const [token, setToken] = useState(tokenFromStorage());
  const [username, setUsername] = useState(usernameFromStorage());
  const [activeTab, setActiveTab] = useState('layout');
  const [offices, setOffices] = useState([]);
  const [floors, setFloors] = useState([]);
  const [components, setComponents] = useState([]);
  const [selectedFloorId, setSelectedFloorId] = useState('');
  const [layout, setLayout] = useState(null);
  const [svgPreview, setSvgPreview] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const selectedFloor = useMemo(
    () => floors.find((f) => String(f.id) === String(selectedFloorId)),
    [floors, selectedFloorId],
  );

  const floorsByOffice = useMemo(() => {
    const names = new Map(offices.map((o) => [o.id, o.name]));
    return floors.reduce((acc, f) => {
      const key = names.get(f.office_id) || `Office ${f.office_id}`;
      (acc[key] ||= []).push(f);
      return acc;
    }, {});
  }, [floors, offices]);

  const loadReferenceData = useCallback(async () => {
    if (!tokenFromStorage()) return;
    setBusy(true);
    setError('');
    try {
      const [o, f, c] = await Promise.all([
        apiFetch('/offices'),
        apiFetch('/floors'),
        apiFetch('/components'),
      ]);
      setOffices(Array.isArray(o) ? o : []);
      const nextFloors = Array.isArray(f) ? f : [];
      setFloors(nextFloors);
      setComponents(Array.isArray(c) ? c : []);
      if (!nextFloors.some((floor) => String(floor.id) === String(selectedFloorId))) {
        setSelectedFloorId(nextFloors.length ? String(nextFloors[0].id) : '');
      }
      return { offices: Array.isArray(o) ? o : [], floors: nextFloors, components: Array.isArray(c) ? c : [] };
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setBusy(false);
    }
  }, [selectedFloorId]);

  const loadLayout = useCallback(async (floorId) => {
    if (!floorId || !tokenFromStorage()) {
      setLayout(null);
      setSvgPreview('');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const [lr, sr] = await Promise.allSettled([
        apiFetch(`/floors/${floorId}/layout`),
        apiFetch(`/floors/${floorId}/layout/published.svg`, {
          headers: { Accept: 'image/svg+xml' },
        }),
      ]);
      setLayout(lr.status === 'fulfilled' ? lr.value : null);
      setSvgPreview(sr.status === 'fulfilled' ? sr.value : '');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (token) loadReferenceData();
  }, [token, loadReferenceData]);

  useEffect(() => {
    loadLayout(selectedFloorId);
  }, [selectedFloorId, loadLayout]);

  async function handleLogin(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      await login(form.get('username'), form.get('password'));
      setToken(tokenFromStorage());
      setUsername(usernameFromStorage());
      setNotice('Сессия администратора активна');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function handleLogout() {
    logout();
    setToken('');
    setUsername('');
    setLayout(null);
    setSvgPreview('');
  }

  async function refreshAll() {
    await loadReferenceData();
    await loadLayout(selectedFloorId);
    setNotice('Данные обновлены');
  }

  async function publishDraft() {
    if (!selectedFloorId) return;
    setBusy(true);
    setError('');
    try {
      await apiFetch(`/floors/${selectedFloorId}/layout/publish`, { method: 'POST' });
      await loadLayout(selectedFloorId);
      setNotice('Черновик опубликован через Go API');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function syncDesks() {
    if (!selectedFloorId) return;
    setBusy(true);
    setError('');
    try {
      const r = await apiFetch(
        `/floors/${selectedFloorId}/layout/sync-desks?source=published&cleanup=false`,
        { method: 'POST' },
      );
      setNotice(`Синхронизация: ${r.created} создано, ${r.updated} обновлено`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function downloadSvg(layoutDoc = null) {
    if (!selectedFloorId) return;
    try {
      const svg = layoutDoc
        ? await apiFetch('/render/svg', {
            method: 'POST',
            headers: { Accept: 'image/svg+xml' },
            body: JSON.stringify(layoutDoc),
          })
        : await apiFetch(`/floors/${selectedFloorId}/layout/published.svg`, {
            headers: { Accept: 'image/svg+xml' },
          });
      const blob = new Blob([svg], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `floor-${selectedFloorId}-${layoutDoc ? 'current' : 'published'}.svg`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    }
  }

  if (!token) {
    return <LoginScreen busy={busy} error={error} onSubmit={handleLogin} />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <Building2 size={22} />
          <div>
            <strong>DeskBook</strong>
            <span>Editor Admin</span>
          </div>
        </div>
        <nav className="tabs">
          <button className={activeTab === 'layout' ? 'active' : ''} onClick={() => setActiveTab('layout')}>
            <Layers3 size={18} /> Layout
          </button>
          <button className={activeTab === 'buildings' ? 'active' : ''} onClick={() => setActiveTab('buildings')}>
            <Building2 size={18} /> Buildings
          </button>
          <button className={activeTab === 'components' ? 'active' : ''} onClick={() => setActiveTab('components')}>
            <Boxes size={18} /> Components
          </button>
        </nav>
        <div className="session">
          <span>{username}</span>
          <button className="icon-button" onClick={handleLogout} title="Выйти">
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <h1>Редактор карт</h1>
            <p>{selectedFloor ? `${selectedFloor.name} · floor #${selectedFloor.id}` : 'Создайте или выберите этаж'}</p>
          </div>
          <div className="toolbar">
            <select
              className="floor-select"
              value={selectedFloorId}
              onChange={(e) => setSelectedFloorId(e.target.value)}
              disabled={!floors.length}
            >
              {!floors.length && <option value="">Нет этажей</option>}
              {Object.entries(floorsByOffice).map(([office, rows]) => (
                <optgroup label={office} key={office}>
                  {rows.map((f) => (
                    <option value={f.id} key={f.id}>{f.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button className="tool-button" onClick={refreshAll} disabled={busy} title="Обновить">
              <RefreshCw size={18} />
              <span>Refresh</span>
            </button>
          </div>
        </header>

        <Notice notice={notice} error={error} />

        {activeTab === 'layout' && (
          <LayoutPanel
            floorId={selectedFloorId}
            layout={layout}
            svgPreview={svgPreview}
            busy={busy}
            components={components}
            onPublish={publishDraft}
            onSync={syncDesks}
            onDownload={downloadSvg}
            onLayoutChange={() => loadLayout(selectedFloorId)}
            onNotice={setNotice}
            onError={setError}
          />
        )}
        {activeTab === 'buildings' && (
          <BuildingPanel
            offices={offices}
            floors={floors}
            selectedFloorId={selectedFloorId}
            onSelectFloor={setSelectedFloorId}
            onOpenLayout={() => setActiveTab('layout')}
            onRefresh={loadReferenceData}
            onNotice={setNotice}
            onError={setError}
          />
        )}
        {activeTab === 'components' && (
          <ComponentPanel
            components={components}
            onRefresh={loadReferenceData}
            onNotice={setNotice}
            onError={setError}
          />
        )}
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
