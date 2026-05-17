export const ASSET_TYPE_LABELS = {
  workplace: 'Рабочее место',
  desk: 'Стол',
  chair: 'Стул',
  meeting_table: 'Стол переговоров',
  meeting_room: 'Переговорная',
  conference_set: 'Конференц-сет',
  call_room: 'Переговорная',
  open_space: 'Опенспейс',
  lounge: 'Лаунж-зона',
  sofa: 'Диван',
  plant: 'Растение',
  storage: 'Хранение',
  printer: 'Принтер',
  reception: 'Ресепшен',
  column: 'Колонна',
  asset: 'Объект',
};

export const STRUCTURE_LABELS = {
  wall: 'Стена',
  walls: 'Стены',
  boundary: 'Контур',
  boundaries: 'Контуры',
  partition: 'Перегородка',
  partitions: 'Перегородки',
  door: 'Дверь',
  doors: 'Двери',
  zone: 'Зона',
  zones: 'Зоны',
  uncertain: 'Не распознано',
  skipped: 'Пропущено',
  unknown: 'Неизвестно',
};

export const STATUS_LABELS = {
  draft: 'Черновик',
  published: 'Опубликовано',
};

export function assetTypeLabel(value) {
  return ASSET_TYPE_LABELS[value] || value || '—';
}

export function structureLabel(value) {
  return STRUCTURE_LABELS[value] || value || '—';
}

export function statusLabel(value) {
  return STATUS_LABELS[value] || value || 'Нет карты';
}

export function pluralRu(count, one, few, many) {
  const abs = Math.abs(Number(count));
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
