import React, { useMemo, useState } from 'react';
import { Check, Layers3, Pencil, Plus, Trash2, X } from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import { pluralRu } from '../lib/i18n.js';
import { EmptyState, Metric } from './ui.jsx';

const DEFAULT_FIRST_FLOOR = '1 этаж';

function trimValue(value) {
  return String(value || '').trim();
}

function groupFloors(offices, floors) {
  const floorsByOfficeID = floors.reduce((acc, floor) => {
    (acc[floor.office_id] ||= []).push(floor);
    return acc;
  }, {});
  const knownOfficeIDs = new Set(offices.map((office) => office.id));
  const rows = offices.map((office) => ({
    office,
    floors: [...(floorsByOfficeID[office.id] || [])].sort((a, b) => a.id - b.id),
  }));
  const orphanFloors = floors
    .filter((floor) => !knownOfficeIDs.has(floor.office_id))
    .sort((a, b) => a.id - b.id);
  if (orphanFloors.length) {
    rows.push({
      office: { id: 0, name: 'Без здания', address: '' },
      floors: orphanFloors,
      readonly: true,
    });
  }
  return rows;
}

export default function BuildingPanel({
  offices,
  floors,
  selectedFloorId,
  onSelectFloor,
  onOpenLayout,
  onRefresh,
  onNotice,
  onError,
}) {
  const [newOffice, setNewOffice] = useState({ name: '', address: '', firstFloor: DEFAULT_FIRST_FLOOR });
  const [editingOfficeId, setEditingOfficeId] = useState(null);
  const [officeForm, setOfficeForm] = useState({ name: '', address: '' });
  const [newFloorNameByOffice, setNewFloorNameByOffice] = useState({});
  const [editingFloorId, setEditingFloorId] = useState(null);
  const [floorName, setFloorName] = useState('');
  const [busyAction, setBusyAction] = useState('');

  const rows = useMemo(() => groupFloors(offices, floors), [offices, floors]);
  const selectedFloor = floors.find((floor) => String(floor.id) === String(selectedFloorId));

  async function refreshAndSelect(floorId) {
    await onRefresh();
    if (floorId) {
      onSelectFloor(String(floorId));
    }
  }

  async function createOffice(event) {
    event.preventDefault();
    const name = trimValue(newOffice.name);
    const address = trimValue(newOffice.address);
    const firstFloor = trimValue(newOffice.firstFloor);
    if (!name) {
      onError('Название здания обязательно');
      return;
    }
    setBusyAction('create-office');
    onError('');
    try {
      const office = await apiFetch('/offices', {
        method: 'POST',
        body: JSON.stringify({ name, address: address || null }),
      });
      let createdFloor = null;
      if (firstFloor) {
        createdFloor = await apiFetch('/floors', {
          method: 'POST',
          body: JSON.stringify({ office_id: office.id, name: firstFloor }),
        });
      }
      setNewOffice({ name: '', address: '', firstFloor: DEFAULT_FIRST_FLOOR });
      await refreshAndSelect(createdFloor?.id);
      onNotice(createdFloor ? 'Здание и первый этаж созданы' : 'Здание создано');
    } catch (err) {
      onError(err.message);
    } finally {
      setBusyAction('');
    }
  }

  function startEditOffice(office) {
    setEditingOfficeId(office.id);
    setOfficeForm({ name: office.name || '', address: office.address || '' });
  }

  async function saveOffice(officeId) {
    const name = trimValue(officeForm.name);
    if (!name) {
      onError('Название здания обязательно');
      return;
    }
    setBusyAction(`office-${officeId}`);
    onError('');
    try {
      await apiFetch(`/offices/${officeId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name, address: trimValue(officeForm.address) }),
      });
      setEditingOfficeId(null);
      await onRefresh();
      onNotice('Здание обновлено');
    } catch (err) {
      onError(err.message);
    } finally {
      setBusyAction('');
    }
  }

  async function deleteOffice(row) {
    const floorsText = row.floors.length ? ` Будут удалены этажи: ${row.floors.map((floor) => floor.name).join(', ')}.` : '';
    if (!confirm(`Удалить здание "${row.office.name}"?${floorsText}`)) return;
    setBusyAction(`office-${row.office.id}`);
    onError('');
    try {
      await apiFetch(`/offices/${row.office.id}`, { method: 'DELETE' });
      if (row.floors.some((floor) => String(floor.id) === String(selectedFloorId))) {
        onSelectFloor('');
      }
      await onRefresh();
      onNotice('Здание удалено');
    } catch (err) {
      onError(err.message);
    } finally {
      setBusyAction('');
    }
  }

  async function createFloor(officeId) {
    const name = trimValue(newFloorNameByOffice[officeId]);
    if (!name) {
      onError('Название этажа обязательно');
      return;
    }
    setBusyAction(`new-floor-${officeId}`);
    onError('');
    try {
      const floor = await apiFetch('/floors', {
        method: 'POST',
        body: JSON.stringify({ office_id: officeId, name }),
      });
      setNewFloorNameByOffice((prev) => ({ ...prev, [officeId]: '' }));
      await refreshAndSelect(floor.id);
      onNotice('Этаж создан');
    } catch (err) {
      onError(err.message);
    } finally {
      setBusyAction('');
    }
  }

  function startEditFloor(floor) {
    setEditingFloorId(floor.id);
    setFloorName(floor.name || '');
  }

  async function saveFloor(floorId) {
    const name = trimValue(floorName);
    if (!name) {
      onError('Название этажа обязательно');
      return;
    }
    setBusyAction(`floor-${floorId}`);
    onError('');
    try {
      await apiFetch(`/floors/${floorId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      });
      setEditingFloorId(null);
      await onRefresh();
      onNotice('Этаж обновлён');
    } catch (err) {
      onError(err.message);
    } finally {
      setBusyAction('');
    }
  }

  async function deleteFloor(floor) {
    if (!confirm(`Удалить этаж "${floor.name}"? Черновики и опубликованные карты этого этажа тоже удалятся.`)) return;
    setBusyAction(`floor-${floor.id}`);
    onError('');
    try {
      await apiFetch(`/floors/${floor.id}`, { method: 'DELETE' });
      if (String(floor.id) === String(selectedFloorId)) {
        onSelectFloor('');
      }
      await onRefresh();
      onNotice('Этаж удалён');
    } catch (err) {
      onError(err.message);
    } finally {
      setBusyAction('');
    }
  }

  function openFloor(floorId) {
    onSelectFloor(String(floorId));
    onOpenLayout();
  }

  return (
    <div className="building-page">
      <section className="building-summary">
        <Metric label="Здания" value={offices.length} />
        <Metric label="Этажи" value={floors.length} />
        <Metric label="Выбран этаж" value={selectedFloor?.name || '-'} />
      </section>

      <section className="building-create-panel">
        <form className="building-create-form" onSubmit={createOffice}>
          <label>
            <span>Здание</span>
            <input
              value={newOffice.name}
              onChange={(event) => setNewOffice((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Например, HQ Almaty"
              disabled={!!busyAction}
            />
          </label>
          <label>
            <span>Адрес</span>
            <input
              value={newOffice.address}
              onChange={(event) => setNewOffice((prev) => ({ ...prev, address: event.target.value }))}
              placeholder="Необязательно"
              disabled={!!busyAction}
            />
          </label>
          <label>
            <span>Первый этаж</span>
            <input
              value={newOffice.firstFloor}
              onChange={(event) => setNewOffice((prev) => ({ ...prev, firstFloor: event.target.value }))}
              placeholder="Можно оставить пустым"
              disabled={!!busyAction}
            />
          </label>
          <button className="tool-button" disabled={!!busyAction}>
            <Plus size={18} />
            <span>Создать</span>
          </button>
        </form>
      </section>

      <section className="building-list">
        {rows.map((row) => {
          const officeBusy = busyAction === `office-${row.office.id}`;
          const officeEditing = editingOfficeId === row.office.id;
          const floorDraft = newFloorNameByOffice[row.office.id] || '';
          return (
            <article className="building-block" key={row.office.id || 'orphan'}>
              <div className="building-header">
                {officeEditing ? (
                  <div className="building-edit-fields">
                    <input
                      value={officeForm.name}
                      onChange={(event) => setOfficeForm((prev) => ({ ...prev, name: event.target.value }))}
                      disabled={officeBusy}
                    />
                    <input
                      value={officeForm.address}
                      onChange={(event) => setOfficeForm((prev) => ({ ...prev, address: event.target.value }))}
                      placeholder="Адрес"
                      disabled={officeBusy}
                    />
                  </div>
                ) : (
                  <div className="building-title">
                    <h2>{row.office.name}</h2>
                    <p>{row.office.address || 'Адрес не указан'}</p>
                  </div>
                )}
                {!row.readonly && (
                  <div className="component-actions">
                    {officeEditing ? (
                      <>
                        <button className="icon-button sm" onClick={() => saveOffice(row.office.id)} disabled={officeBusy} title="Сохранить">
                          <Check size={14} />
                        </button>
                        <button className="icon-button sm" onClick={() => setEditingOfficeId(null)} disabled={officeBusy} title="Отмена">
                          <X size={14} />
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="badge">{row.floors.length} {pluralRu(row.floors.length, 'этаж', 'этажа', 'этажей')}</span>
                        <button className="icon-button sm" onClick={() => startEditOffice(row.office)} disabled={!!busyAction} title="Редактировать здание">
                          <Pencil size={14} />
                        </button>
                        <button className="icon-button sm danger" onClick={() => deleteOffice(row)} disabled={!!busyAction} title="Удалить здание">
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>

              {!row.readonly && (
                <div className="floor-create-row">
                  <input
                    value={floorDraft}
                    onChange={(event) => setNewFloorNameByOffice((prev) => ({ ...prev, [row.office.id]: event.target.value }))}
                    placeholder="Новый этаж"
                    disabled={!!busyAction}
                  />
                  <button className="tool-button sm secondary" onClick={() => createFloor(row.office.id)} disabled={!!busyAction || !trimValue(floorDraft)}>
                    <Plus size={16} />
                    <span>Этаж</span>
                  </button>
                </div>
              )}

              <div className="floor-list">
                {row.floors.map((floor) => {
                  const selected = String(floor.id) === String(selectedFloorId);
                  const floorEditing = editingFloorId === floor.id;
                  const floorBusy = busyAction === `floor-${floor.id}`;
                  return (
                    <div className={`floor-row ${selected ? 'active' : ''}`} key={floor.id}>
                      <Layers3 size={16} />
                      {floorEditing ? (
                        <input
                          value={floorName}
                          onChange={(event) => setFloorName(event.target.value)}
                          disabled={floorBusy}
                        />
                      ) : (
                        <button className="floor-open-button" onClick={() => openFloor(floor.id)}>
                          <span>{floor.name}</span>
                          <small>этаж #{floor.id}</small>
                        </button>
                      )}
                      <div className="component-actions">
                        {floorEditing ? (
                          <>
                            <button className="icon-button sm" onClick={() => saveFloor(floor.id)} disabled={floorBusy} title="Сохранить">
                              <Check size={14} />
                            </button>
                            <button className="icon-button sm" onClick={() => setEditingFloorId(null)} disabled={floorBusy} title="Отмена">
                              <X size={14} />
                            </button>
                          </>
                        ) : (
                          <>
                            {selected && <span className="badge">текущий</span>}
                            <button className="icon-button sm" onClick={() => startEditFloor(floor)} disabled={!!busyAction} title="Редактировать этаж">
                              <Pencil size={14} />
                            </button>
                            <button className="icon-button sm danger" onClick={() => deleteFloor(floor)} disabled={!!busyAction} title="Удалить этаж">
                              <Trash2 size={14} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
                {!row.floors.length && <EmptyState text="Этажей пока нет" />}
              </div>
            </article>
          );
        })}
        {!rows.length && <EmptyState text="Создайте первое здание и этаж" />}
      </section>
    </div>
  );
}
