import React, { useCallback, useEffect, useState } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import { assetTypeLabel } from '../lib/i18n.js';

const DESK_TYPES = ['flex', 'fixed'];
const DESK_TYPE_LABELS = {
  flex: 'Гибкое',
  fixed: 'Закреплённое',
};
const SPACE_TYPES = [
  'workplace',
  'desk',
  'chair',
  'meeting_table',
  'conference_set',
  'call_room',
  'lounge',
  'sofa',
  'plant',
  'storage',
  'printer',
  'reception',
  'column',
  'asset',
];

export default function PropertiesPanel({
  desks,
  selectedIds,
  components,
  onUpdate,
  onDelete,
}) {
  const selected = desks.filter((d) => selectedIds.has(d.id));

  if (!selected.length) {
    return (
      <div className="properties-panel empty">
        <p className="muted">Выберите объект, чтобы редактировать свойства</p>
      </div>
    );
  }

  if (selected.length > 1) {
    return (
      <MultiSelectPanel
        count={selected.length}
        components={components}
        onBulkUpdate={(patch) => {
          for (const desk of selected) onUpdate(desk.id, patch);
        }}
        onDelete={onDelete}
      />
    );
  }

  return (
    <SingleDeskPanel
      desk={selected[0]}
      components={components}
      onUpdate={onUpdate}
      onDelete={onDelete}
    />
  );
}

function SingleDeskPanel({ desk, components, onUpdate, onDelete }) {
  const [label, setLabel] = useState(desk.label || '');
  const [deskType, setDeskType] = useState(desk.type || 'flex');
  const [spaceType, setSpaceType] = useState(desk.space_type || desk.asset_type || 'desk');
  const [componentId, setComponentId] = useState(desk.component_id || '');
  const [rotation, setRotation] = useState(desk.r ?? desk.rotation ?? 0);
  const [w, setW] = useState(desk.w || 100);
  const [h, setH] = useState(desk.h || 60);
  const [x, setX] = useState(Math.round(desk.x || 0));
  const [y, setY] = useState(Math.round(desk.y || 0));

  useEffect(() => {
    setLabel(desk.label || '');
    setDeskType(desk.type || 'flex');
    setSpaceType(desk.space_type || desk.asset_type || 'desk');
    setComponentId(desk.component_id || '');
    setRotation(desk.r ?? desk.rotation ?? 0);
    setW(desk.w || 100);
    setH(desk.h || 60);
    setX(Math.round(desk.x || 0));
    setY(Math.round(desk.y || 0));
  }, [desk]);

  const commit = useCallback(
    (patch) => onUpdate(desk.id, patch),
    [desk.id, onUpdate],
  );

  return (
    <div className="properties-panel">
      <div className="prop-header">
        <h3>Свойства</h3>
        <button
          className="icon-button danger"
          onClick={() => onDelete([desk.id])}
          title="Удалить"
        >
          <Trash2 size={16} />
        </button>
      </div>

      <div className="prop-group">
        <label>Название</label>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => commit({ label })}
          onKeyDown={(e) => e.key === 'Enter' && commit({ label })}
        />
      </div>

      <div className="prop-row">
        <div className="prop-group half">
          <label>X</label>
          <input
            type="number"
            value={x}
            onChange={(e) => setX(Number(e.target.value))}
            onBlur={() => commit({ x })}
          />
        </div>
        <div className="prop-group half">
          <label>Y</label>
          <input
            type="number"
            value={y}
            onChange={(e) => setY(Number(e.target.value))}
            onBlur={() => commit({ y })}
          />
        </div>
      </div>

      <div className="prop-row">
        <div className="prop-group half">
          <label>Ширина</label>
          <input
            type="number"
            value={w}
            min={10}
            onChange={(e) => setW(Number(e.target.value))}
            onBlur={() => commit({ w })}
          />
        </div>
        <div className="prop-group half">
          <label>Высота</label>
          <input
            type="number"
            value={h}
            min={10}
            onChange={(e) => setH(Number(e.target.value))}
            onBlur={() => commit({ h })}
          />
        </div>
      </div>

      <div className="prop-group">
        <label>Поворот</label>
        <div className="prop-row">
          <input
            type="number"
            value={rotation}
            step={15}
            onChange={(e) => {
              const v = Number(e.target.value) % 360;
              setRotation(v);
              commit({ r: v });
            }}
          />
          <button
            className="icon-button"
            onClick={() => { setRotation(0); commit({ r: 0 }); }}
            title="Сбросить поворот"
          >
            <RotateCcw size={14} />
          </button>
        </div>
      </div>

      <div className="prop-group">
        <label>Тип места</label>
        <select value={deskType} onChange={(e) => { setDeskType(e.target.value); commit({ type: e.target.value }); }}>
          {DESK_TYPES.map((t) => <option key={t} value={t}>{DESK_TYPE_LABELS[t] || t}</option>)}
        </select>
      </div>

      <div className="prop-group">
        <label>Тип объекта</label>
        <select value={spaceType} onChange={(e) => { setSpaceType(e.target.value); commit({ space_type: e.target.value, asset_type: e.target.value }); }}>
          {SPACE_TYPES.map((t) => <option key={t} value={t}>{assetTypeLabel(t)}</option>)}
        </select>
      </div>

      <div className="prop-group">
        <label>Компонент</label>
        <select value={componentId} onChange={(e) => {
          const nextId = e.target.value;
          const component = (components || []).find((c) => c.id === nextId);
          setComponentId(nextId);
          if (component) {
            setSpaceType(component.asset_type || 'asset');
            setW(component.default_w || w);
            setH(component.default_h || h);
            commit({
              component_id: nextId,
              symbol_id: nextId,
              asset_type: component.asset_type || 'asset',
              space_type: component.asset_type || 'asset',
              w: component.default_w || w,
              h: component.default_h || h,
            });
          } else {
            commit({ component_id: nextId, symbol_id: nextId });
          }
        }}>
          <option value="">— по умолчанию —</option>
          {(components || []).map((c) => (
            <option key={c.id} value={c.id}>{c.label || c.id}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

function MultiSelectPanel({ count, components, onBulkUpdate, onDelete }) {
  return (
    <div className="properties-panel">
      <div className="prop-header">
        <h3>Выбрано: {count}</h3>
        <button className="icon-button danger" onClick={onDelete} title="Удалить выбранные">
          <Trash2 size={16} />
        </button>
      </div>

      <div className="prop-group">
        <label>Тип места</label>
        <select defaultValue="" onChange={(e) => { if (e.target.value) onBulkUpdate({ type: e.target.value }); }}>
          <option value="">— без изменений —</option>
          {DESK_TYPES.map((t) => <option key={t} value={t}>{DESK_TYPE_LABELS[t] || t}</option>)}
        </select>
      </div>

      <div className="prop-group">
        <label>Компонент</label>
        <select defaultValue="" onChange={(e) => {
          if (!e.target.value) return;
          const component = (components || []).find((c) => c.id === e.target.value);
          onBulkUpdate({
            component_id: e.target.value,
            symbol_id: e.target.value,
            asset_type: component?.asset_type || 'asset',
            space_type: component?.asset_type || 'asset',
            ...(component ? { w: component.default_w, h: component.default_h } : {}),
          });
        }}>
          <option value="">— без изменений —</option>
          {(components || []).map((c) => (
            <option key={c.id} value={c.id}>{c.label || c.id}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
