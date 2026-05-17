export const COMPONENT_CATEGORIES = [
  { id: 'workstations', label: 'Рабочие места' },
  { id: 'meeting', label: 'Переговорные' },
  { id: 'rooms', label: 'Кабинеты' },
  { id: 'lounge', label: 'Лаунж' },
  { id: 'support', label: 'Сервис' },
  { id: 'structure', label: 'Конструкции' },
  { id: 'custom', label: 'Свои' },
];

export const BUILTIN_COMPONENTS = [
  {
    id: 'workplace-desk-chair',
    label: 'Рабочее место',
    asset_type: 'workplace',
    palette_group: 'workstations',
    view_box: [0, 0, 140, 125],
    default_w: 140,
    default_h: 125,
    svg_markup: '<rect class="asset-fill" x="3" y="3" width="134" height="64" rx="8" fill="#dbeafe"/><rect class="asset-outline" x="3" y="3" width="134" height="64" rx="8" fill="none" stroke="#2563eb" stroke-width="1.5"/><rect x="57" y="88" width="26" height="24" rx="7" fill="#f8fafc" stroke="#64748b" stroke-width="1.4"/><path d="M61 88V78h18v10M58 112h24" fill="none" stroke="#64748b" stroke-width="1.4" stroke-linecap="round"/>',
    is_system: true,
  },
  {
    id: 'desk-short',
    label: 'Одинарный стол',
    asset_type: 'desk',
    palette_group: 'workstations',
    view_box: [0, 0, 100, 60],
    default_w: 100,
    default_h: 60,
    svg_markup: '<rect class="asset-fill" x="2" y="2" width="96" height="56" rx="8" fill="#dbeafe"/><rect class="asset-outline" x="2" y="2" width="96" height="56" rx="8" fill="none" stroke="#2563eb" stroke-width="1.5"/>',
    is_system: true,
  },
  {
    id: 'desk-long',
    label: 'Двойной стол',
    asset_type: 'desk',
    palette_group: 'workstations',
    view_box: [0, 0, 160, 60],
    default_w: 160,
    default_h: 60,
    svg_markup: '<rect class="asset-fill" x="2" y="2" width="156" height="56" rx="8" fill="#dbeafe"/><path class="asset-outline" d="M80 8v44" fill="none" stroke="#2563eb" stroke-width="1.5"/><rect class="asset-outline" x="2" y="2" width="156" height="56" rx="8" fill="none" stroke="#2563eb" stroke-width="1.5"/>',
    is_system: true,
  },
  {
    id: 'sit-stand-desk',
    label: 'Стол с регулировкой',
    asset_type: 'desk',
    palette_group: 'workstations',
    view_box: [0, 0, 120, 70],
    default_w: 120,
    default_h: 70,
    svg_markup: '<rect class="asset-fill" x="6" y="8" width="108" height="48" rx="8" fill="#dbeafe"/><rect class="asset-outline" x="6" y="8" width="108" height="48" rx="8" fill="none" stroke="#2563eb" stroke-width="1.5"/><path class="asset-outline" d="M26 56v10M94 56v10M38 20h44" fill="none" stroke="#2563eb" stroke-width="1.5" stroke-linecap="round"/>',
    is_system: true,
  },
  {
    id: 'bench-4',
    label: 'Бенч на 4',
    asset_type: 'desk',
    palette_group: 'workstations',
    view_box: [0, 0, 220, 120],
    default_w: 220,
    default_h: 120,
    svg_markup: '<rect class="asset-fill" x="10" y="14" width="200" height="92" rx="10" fill="#dbeafe"/><path class="asset-outline" d="M110 14v92M10 60h200" fill="none" stroke="#2563eb" stroke-width="1.5"/><rect class="asset-outline" x="10" y="14" width="200" height="92" rx="10" fill="none" stroke="#2563eb" stroke-width="1.5"/>',
    is_system: true,
  },
  {
    id: 'chair',
    label: 'Стул',
    asset_type: 'chair',
    palette_group: 'workstations',
    view_box: [0, 0, 64, 64],
    default_w: 64,
    default_h: 64,
    svg_markup: '<rect class="asset-fill" x="12" y="18" width="40" height="34" rx="10" fill="#f8fafc"/><path class="asset-outline" d="M18 18V8h28v10M14 52h36" fill="none" stroke="#64748b" stroke-width="1.5" stroke-linecap="round"/><rect class="asset-outline" x="12" y="18" width="40" height="34" rx="10" fill="none" stroke="#64748b" stroke-width="1.5"/>',
    is_system: true,
  },
  {
    id: 'meeting-table',
    label: 'Стол переговоров',
    asset_type: 'meeting_table',
    palette_group: 'meeting',
    view_box: [0, 0, 140, 90],
    default_w: 140,
    default_h: 90,
    svg_markup: '<rect class="asset-fill" x="18" y="16" width="104" height="58" rx="22" fill="#eef2ff"/><rect class="asset-outline" x="18" y="16" width="104" height="58" rx="22" fill="none" stroke="#4f46e5" stroke-width="1.5"/><circle cx="22" cy="10" r="5" fill="none" stroke="#4f46e5" stroke-width="1.5"/><circle cx="70" cy="8" r="5" fill="none" stroke="#4f46e5" stroke-width="1.5"/><circle cx="118" cy="10" r="5" fill="none" stroke="#4f46e5" stroke-width="1.5"/><circle cx="22" cy="80" r="5" fill="none" stroke="#4f46e5" stroke-width="1.5"/><circle cx="70" cy="82" r="5" fill="none" stroke="#4f46e5" stroke-width="1.5"/><circle cx="118" cy="80" r="5" fill="none" stroke="#4f46e5" stroke-width="1.5"/>',
    is_system: true,
  },
  {
    id: 'round-table',
    label: 'Круглый стол',
    asset_type: 'meeting_table',
    palette_group: 'meeting',
    view_box: [0, 0, 110, 110],
    default_w: 110,
    default_h: 110,
    svg_markup: '<circle class="asset-fill" cx="55" cy="55" r="34" fill="#eef2ff"/><circle class="asset-outline" cx="55" cy="55" r="34" fill="none" stroke="#4f46e5" stroke-width="1.5"/><circle cx="55" cy="12" r="6" fill="none" stroke="#4f46e5" stroke-width="1.5"/><circle cx="55" cy="98" r="6" fill="none" stroke="#4f46e5" stroke-width="1.5"/><circle cx="12" cy="55" r="6" fill="none" stroke="#4f46e5" stroke-width="1.5"/><circle cx="98" cy="55" r="6" fill="none" stroke="#4f46e5" stroke-width="1.5"/>',
    is_system: true,
  },
  {
    id: 'conference-set',
    label: 'Конференц-сет',
    asset_type: 'conference_set',
    palette_group: 'meeting',
    view_box: [0, 0, 220, 150],
    default_w: 220,
    default_h: 150,
    svg_markup: '<rect class="asset-fill" x="58" y="46" width="104" height="58" rx="22" fill="#eef2ff"/><rect class="asset-outline" x="58" y="46" width="104" height="58" rx="22" fill="none" stroke="#4f46e5" stroke-width="1.5"/><rect x="96" y="6" width="28" height="22" rx="7" fill="#f8fafc" stroke="#64748b" stroke-width="1.4"/><rect x="96" y="122" width="28" height="22" rx="7" fill="#f8fafc" stroke="#64748b" stroke-width="1.4"/><rect x="8" y="64" width="28" height="22" rx="7" fill="#f8fafc" stroke="#64748b" stroke-width="1.4"/><rect x="184" y="64" width="28" height="22" rx="7" fill="#f8fafc" stroke="#64748b" stroke-width="1.4"/>',
    is_system: true,
  },
  {
    id: 'phone-booth',
    label: 'Телефонная кабина',
    asset_type: 'call_room',
    palette_group: 'rooms',
    view_box: [0, 0, 95, 120],
    default_w: 95,
    default_h: 120,
    svg_markup: '<rect class="asset-fill" x="8" y="6" width="79" height="108" rx="12" fill="#ecfeff"/><rect class="asset-outline" x="8" y="6" width="79" height="108" rx="12" fill="none" stroke="#0891b2" stroke-width="1.8"/><path d="M28 34h39M28 52h39M64 92h8" fill="none" stroke="#0891b2" stroke-width="1.5" stroke-linecap="round"/>',
    is_system: true,
  },
  {
    id: 'focus-room',
    label: 'Фокус-комната',
    asset_type: 'call_room',
    palette_group: 'rooms',
    view_box: [0, 0, 150, 115],
    default_w: 150,
    default_h: 115,
    svg_markup: '<rect class="asset-fill" x="8" y="8" width="134" height="99" rx="10" fill="#ecfeff"/><rect class="asset-outline" x="8" y="8" width="134" height="99" rx="10" fill="none" stroke="#0891b2" stroke-width="1.8"/><rect x="38" y="36" width="74" height="38" rx="8" fill="none" stroke="#0891b2" stroke-width="1.5"/><path d="M112 58h18" fill="none" stroke="#0891b2" stroke-width="1.5" stroke-linecap="round"/>',
    is_system: true,
  },
  {
    id: 'sofa',
    label: 'Диван',
    asset_type: 'sofa',
    palette_group: 'lounge',
    view_box: [0, 0, 150, 72],
    default_w: 150,
    default_h: 72,
    svg_markup: '<rect class="asset-fill" x="14" y="24" width="122" height="34" rx="12" fill="#fce7f3"/><path class="asset-outline" d="M22 24V12h106v12M14 44H4v18h142V44h-10M52 24v34M98 24v34" fill="none" stroke="#be185d" stroke-width="1.5" stroke-linejoin="round"/><rect class="asset-outline" x="14" y="24" width="122" height="34" rx="12" fill="none" stroke="#be185d" stroke-width="1.5"/>',
    is_system: true,
  },
  {
    id: 'lounge-chair',
    label: 'Кресло',
    asset_type: 'chair',
    palette_group: 'lounge',
    view_box: [0, 0, 82, 82],
    default_w: 82,
    default_h: 82,
    svg_markup: '<circle class="asset-fill" cx="41" cy="42" r="28" fill="#fce7f3"/><path class="asset-outline" d="M18 42c0-14 10-24 23-24s23 10 23 24v18H18V42zM24 62l-6 12M58 62l6 12" fill="none" stroke="#be185d" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
    is_system: true,
  },
  {
    id: 'plant',
    label: 'Растение',
    asset_type: 'plant',
    palette_group: 'support',
    view_box: [0, 0, 70, 90],
    default_w: 70,
    default_h: 90,
    svg_markup: '<path d="M18 36c-8-18 6-28 17-8C42 8 60 13 48 36c18-8 22 12 4 20H18C0 48 3 28 18 36z" fill="#dcfce7" stroke="#16a34a" stroke-width="1.5" stroke-linejoin="round"/><path d="M35 32v30" fill="none" stroke="#16a34a" stroke-width="1.5"/><rect x="20" y="60" width="30" height="22" rx="5" fill="#fef3c7" stroke="#a16207" stroke-width="1.5"/>',
    is_system: true,
  },
  {
    id: 'storage-cabinet',
    label: 'Шкаф',
    asset_type: 'storage',
    palette_group: 'support',
    view_box: [0, 0, 95, 80],
    default_w: 95,
    default_h: 80,
    svg_markup: '<rect class="asset-fill" x="8" y="8" width="79" height="64" rx="6" fill="#f1f5f9"/><rect class="asset-outline" x="8" y="8" width="79" height="64" rx="6" fill="none" stroke="#64748b" stroke-width="1.5"/><path d="M47.5 8v64M18 24h20M57 24h20M18 44h20M57 44h20" fill="none" stroke="#64748b" stroke-width="1.5" stroke-linecap="round"/>',
    is_system: true,
  },
  {
    id: 'locker-bank',
    label: 'Локеры',
    asset_type: 'storage',
    palette_group: 'support',
    view_box: [0, 0, 150, 82],
    default_w: 150,
    default_h: 82,
    svg_markup: '<rect class="asset-fill" x="8" y="8" width="134" height="66" rx="6" fill="#f1f5f9"/><rect class="asset-outline" x="8" y="8" width="134" height="66" rx="6" fill="none" stroke="#64748b" stroke-width="1.5"/><path d="M41 8v66M74 8v66M107 8v66M22 22h8M55 22h8M88 22h8M121 22h8" fill="none" stroke="#64748b" stroke-width="1.5" stroke-linecap="round"/>',
    is_system: true,
  },
  {
    id: 'printer',
    label: 'Принтер',
    asset_type: 'printer',
    palette_group: 'support',
    view_box: [0, 0, 90, 75],
    default_w: 90,
    default_h: 75,
    svg_markup: '<rect class="asset-fill" x="14" y="28" width="62" height="30" rx="6" fill="#f1f5f9"/><path class="asset-outline" d="M24 28V10h42v18M24 52v14h42V52M20 40h8" fill="none" stroke="#64748b" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><rect class="asset-outline" x="14" y="28" width="62" height="30" rx="6" fill="none" stroke="#64748b" stroke-width="1.5"/>',
    is_system: true,
  },
  {
    id: 'reception-desk',
    label: 'Ресепшен',
    asset_type: 'reception',
    palette_group: 'support',
    view_box: [0, 0, 180, 90],
    default_w: 180,
    default_h: 90,
    svg_markup: '<path class="asset-fill" d="M14 66c12-34 40-52 76-52s64 18 76 52v10H14V66z" fill="#fef3c7"/><path class="asset-outline" d="M14 66c12-34 40-52 76-52s64 18 76 52v10H14V66zM52 54h76" fill="none" stroke="#a16207" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
    is_system: true,
  },
  {
    id: 'column',
    label: 'Колонна',
    asset_type: 'column',
    palette_group: 'structure',
    view_box: [0, 0, 64, 64],
    default_w: 64,
    default_h: 64,
    svg_markup: '<rect x="8" y="8" width="48" height="48" rx="6" fill="#e2e8f0" stroke="#475569" stroke-width="1.8"/><path d="M16 48L48 16M18 18l28 28" fill="none" stroke="#64748b" stroke-width="1.2" stroke-linecap="round"/>',
    is_system: true,
  },
];

export function mergeComponentCatalog(customComponents = []) {
  const byId = new Map();
  for (const c of BUILTIN_COMPONENTS) byId.set(c.id, c);
  for (const raw of customComponents || []) {
    if (!raw?.id) continue;
    byId.set(raw.id, {
      ...raw,
      palette_group: raw.palette_group || 'custom',
      is_system: Boolean(raw.is_system),
    });
  }
  return Array.from(byId.values());
}

export function groupComponents(components = []) {
  const groups = COMPONENT_CATEGORIES.map((group) => ({ ...group, items: [] }));
  const fallback = groups[groups.length - 1];
  for (const component of components) {
    const group = groups.find((g) => g.id === component.palette_group) || fallback;
    group.items.push(component);
  }
  return groups.filter((group) => group.items.length);
}

export function viewBoxString(component) {
  const vb = Array.isArray(component?.view_box) ? component.view_box : [0, 0, component?.default_w || 100, component?.default_h || 60];
  return vb.join(' ');
}

export function componentMarkup(component) {
  return component?.svg_markup || '';
}

export function labelPrefixForComponent(component) {
  switch (component?.asset_type) {
    case 'workplace': return 'WP';
    case 'desk': return 'D';
    case 'meeting_table':
    case 'conference_set': return 'M';
    case 'call_room': return 'CR';
    case 'chair': return 'CH';
    default: return 'A';
  }
}

export function shouldShowObjectLabel(component, desk) {
  const assetType = desk?.asset_type || component?.asset_type;
  return ['workplace', 'desk', 'meeting_table', 'conference_set', 'call_room'].includes(assetType);
}
