import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Boxes, Building2, Layers3, LogOut, Mail, PanelLeftClose, PanelLeftOpen, RefreshCw } from 'lucide-react';
import { apiFetch, login, logout, setUnauthorizedHandler, tokenFromStorage, usernameFromStorage } from './lib/api.js';
import { LoginScreen, Notice, RegisterScreen } from './components/ui.jsx';
import LayoutPanel from './components/LayoutPanel.jsx';
import ComponentPanel from './components/ComponentPanel.jsx';
import BuildingPanel from './components/BuildingPanel.jsx';
import InvitePanel from './components/InvitePanel.jsx';
import OnboardingModal from './components/OnboardingModal.jsx';
import { mergeComponentCatalog } from './lib/componentCatalog.js';
import './styles.css';

async function loadPublishedSvgPreview(floorId) {
  try {
    const svg = await apiFetch(`/floors/${floorId}/layout/published.svg`, {
      headers: { Accept: 'image/svg+xml' },
    });
    if (typeof svg === 'string' && svg.includes('<svg')) return svg;
  } catch {
    // Fall back to JSON + renderer below. This also covers old nginx builds
    // that handled .svg as a static asset instead of proxying /api.
  }

  try {
    const published = await apiFetch(`/floors/${floorId}/layout/published`);
    if (!published?.layout) return '';
    const rendered = await apiFetch('/render/svg', {
      method: 'POST',
      headers: { Accept: 'image/svg+xml' },
      body: JSON.stringify(published.layout),
    });
    return typeof rendered === 'string' && rendered.includes('<svg') ? rendered : '';
  } catch {
    return '';
  }
}

const isInviteUrl = new URLSearchParams(window.location.search).has('invite');

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
  const [canvasDirty, setCanvasDirty] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem('deskbook_sidebar_collapsed') === '1',
  );
  const [showOnboarding, setShowOnboarding] = useState(false);

  const selectedFloor = useMemo(
    () => floors.find((f) => String(f.id) === String(selectedFloorId)),
    [floors, selectedFloorId],
  );

  const componentCatalog = useMemo(
    () => mergeComponentCatalog(components),
    [components],
  );

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
      setSelectedFloorId((prev) => {
        if (nextFloors.some((floor) => String(floor.id) === String(prev))) return prev;
        return nextFloors.length ? String(nextFloors[0].id) : '';
      });
      return { offices: Array.isArray(o) ? o : [], floors: nextFloors, components: Array.isArray(c) ? c : [] };
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const loadLayout = useCallback(async (floorId, { refreshPreview = true } = {}) => {
    if (!floorId || !tokenFromStorage()) {
      setLayout(null);
      setSvgPreview('');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (refreshPreview) {
        const [lr, sr] = await Promise.allSettled([
          apiFetch(`/floors/${floorId}/layout`),
          loadPublishedSvgPreview(floorId),
        ]);
        setLayout(lr.status === 'fulfilled' ? lr.value : null);
        setSvgPreview(sr.status === 'fulfilled' ? sr.value : '');
      } else {
        setLayout(await apiFetch(`/floors/${floorId}/layout`));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, []);

  // Auto-logout when any API call gets 401 (token expired)
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setToken('');
      setUsername('');
      setLayout(null);
      setSvgPreview('');
    });
  }, []);

  useEffect(() => {
    if (token) loadReferenceData();
  }, [token, loadReferenceData]);

  useEffect(() => {
    loadLayout(selectedFloorId);
  }, [selectedFloorId, loadLayout]);

  useEffect(() => {
    localStorage.setItem('deskbook_sidebar_collapsed', sidebarCollapsed ? '1' : '0');
  }, [sidebarCollapsed]);

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
      if (!localStorage.getItem('deskbook_onboarding_seen')) {
        setShowOnboarding(true);
      }
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
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await loadReferenceData();
      await loadLayout(selectedFloorId);
      setNotice('Данные обновлены');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function publishDraft() {
    if (!selectedFloorId || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await apiFetch(`/floors/${selectedFloorId}/layout/publish`, { method: 'POST' });
      await loadLayout(selectedFloorId);
      setNotice('Черновик опубликован');
    } catch (err) {
      setError(err.message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function syncDesks() {
    if (!selectedFloorId || busyRef.current) return;
    busyRef.current = true;
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
      busyRef.current = false;
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

  if (isInviteUrl) return <RegisterScreen />;

  if (!token) {
    return <LoginScreen busy={busy} error={error} onSubmit={handleLogin} />;
  }

  return (
    <div className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="brand">
          <Building2 size={22} />
          <div className="brand-copy">
            <strong>DeskBook</strong>
            <span>Админ редактора</span>
          </div>
          <button
            type="button"
            className="sidebar-toggle"
            onClick={() => setSidebarCollapsed((value) => !value)}
            title={sidebarCollapsed ? 'Развернуть меню' : 'Свернуть меню'}
            aria-label={sidebarCollapsed ? 'Развернуть меню' : 'Свернуть меню'}
            aria-expanded={!sidebarCollapsed}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>
        <nav className="tabs">
          <button type="button" className={activeTab === 'buildings' ? 'active' : ''} onClick={() => setActiveTab('buildings')} title="Здания">
            <Building2 size={18} /> <span>Здания</span>
          </button>
          <button type="button" className={activeTab === 'components' ? 'active' : ''} onClick={() => setActiveTab('components')} title="Компоненты">
            <Boxes size={18} /> <span>Компоненты</span>
          </button>
          <button type="button" className={activeTab === 'layout' ? 'active' : ''} onClick={() => setActiveTab('layout')} title="План">
            <Layers3 size={18} /> <span>План</span>
          </button>
          <button type="button" className={activeTab === 'invites' ? 'active' : ''} onClick={() => setActiveTab('invites')} title="Приглашения">
            <Mail size={18} /> <span>Приглашения</span>
          </button>
        </nav>
        <div className="session">
          <span>{username}</span>
          <button type="button" className="icon-button" onClick={handleLogout} title="Выйти">
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <h1>Редактор карт</h1>
            <p>{selectedFloor ? `${selectedFloor.name} · этаж #${selectedFloor.id}` : 'Создайте или выберите этаж'}</p>
          </div>
          <div className="toolbar">
            {activeTab === 'layout' && (
              <>
                {layout && (
                  <span className={`status-chip ${canvasDirty ? 'warning' : layout.status === 'draft' ? 'warning' : 'ok'}`}>
                    {canvasDirty ? 'Изменён' : layout.status === 'draft' ? 'Черновик' : 'Опубликован'}
                  </span>
                )}
                {svgPreview && <span className="status-chip ok">Предпросмотр доступен</span>}
                {floors.length > 0 && (
                  <select
                    className="floor-select"
                    value={selectedFloorId}
                    onChange={(e) => { setSelectedFloorId(e.target.value); setCanvasDirty(false); }}
                    title="Выбрать этаж"
                  >
                    {floors.map((f) => (
                      <option key={f.id} value={String(f.id)}>{f.name}</option>
                    ))}
                  </select>
                )}
              </>
            )}
            <button className="tool-button" onClick={refreshAll} disabled={busy} title="Обновить">
              <RefreshCw size={18} />
              <span>Обновить</span>
            </button>
          </div>
        </header>

        <Notice notice={notice} error={error} onDismissNotice={() => setNotice('')} onDismissError={() => setError('')} />

        {/* LayoutPanel stays mounted to preserve canvas viewport, undo history and selection */}
        <div style={{ display: activeTab === 'layout' ? 'contents' : 'none' }}>
          <LayoutPanel
            floorId={selectedFloorId}
            selectedFloor={selectedFloor}
            layout={layout}
            svgPreview={svgPreview}
            busy={busy}
            components={componentCatalog}
            onPublish={publishDraft}
            onSync={syncDesks}
            onDownload={downloadSvg}
            onLayoutChange={(options) => loadLayout(selectedFloorId, options)}
            onDirtyChange={setCanvasDirty}
            onNotice={setNotice}
            onError={setError}
          />
        </div>
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
            components={componentCatalog}
            onRefresh={async () => {
              await loadReferenceData();
              // Reload layout so canvas picks up updated component visuals
              await loadLayout(selectedFloorId);
            }}
            onNotice={setNotice}
            onError={setError}
          />
        )}
        {activeTab === 'invites' && (
          <InvitePanel
            onNotice={setNotice}
            onError={setError}
          />
        )}
      </main>

      {showOnboarding && (
        <OnboardingModal
          onClose={() => {
            setShowOnboarding(false);
            localStorage.setItem('deskbook_onboarding_seen', '1');
          }}
          onNavigate={(tab) => {
            setShowOnboarding(false);
            setActiveTab(tab);
            localStorage.setItem('deskbook_onboarding_seen', '1');
          }}
        />
      )}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
