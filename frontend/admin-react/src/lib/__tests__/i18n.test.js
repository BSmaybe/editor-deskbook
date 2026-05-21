import { describe, it, expect } from 'vitest';
import { assetTypeLabel, structureLabel, statusLabel, pluralRu } from '../i18n.js';

describe('assetTypeLabel', () => {
  it('returns Russian label for known type', () => {
    expect(assetTypeLabel('workplace')).toBe('Рабочее место');
    expect(assetTypeLabel('chair')).toBe('Стул');
    expect(assetTypeLabel('printer')).toBe('Принтер');
  });
  it('returns the value itself for unknown type', () => {
    expect(assetTypeLabel('unknown_type')).toBe('unknown_type');
  });
  it('returns em-dash for empty/null', () => {
    expect(assetTypeLabel('')).toBe('—');
    expect(assetTypeLabel(null)).toBe('—');
  });
});

describe('structureLabel', () => {
  it('returns Russian label for known type', () => {
    expect(structureLabel('wall')).toBe('Стена');
    expect(structureLabel('door')).toBe('Дверь');
    expect(structureLabel('zone')).toBe('Зона');
  });
  it('returns value itself for unknown type', () => {
    expect(structureLabel('stairs')).toBe('stairs');
  });
});

describe('statusLabel', () => {
  it('returns correct labels', () => {
    expect(statusLabel('draft')).toBe('Черновик');
    expect(statusLabel('published')).toBe('Опубликовано');
  });
  it('returns default for unknown', () => {
    expect(statusLabel('archived')).toBe('archived');
  });
  it('returns "Нет карты" for null/empty', () => {
    expect(statusLabel(null)).toBe('Нет карты');
    expect(statusLabel('')).toBe('Нет карты');
  });
});

describe('pluralRu', () => {
  const forms = ['стол', 'стола', 'столов'];

  it('uses "one" form for 1, 21, 31', () => {
    expect(pluralRu(1, ...forms)).toBe('стол');
    expect(pluralRu(21, ...forms)).toBe('стол');
    expect(pluralRu(101, ...forms)).toBe('стол');
  });
  it('uses "few" form for 2–4, 22–24', () => {
    expect(pluralRu(2, ...forms)).toBe('стола');
    expect(pluralRu(3, ...forms)).toBe('стола');
    expect(pluralRu(4, ...forms)).toBe('стола');
    expect(pluralRu(22, ...forms)).toBe('стола');
  });
  it('uses "many" form for 5–20 and teens', () => {
    expect(pluralRu(5, ...forms)).toBe('столов');
    expect(pluralRu(11, ...forms)).toBe('столов');
    expect(pluralRu(12, ...forms)).toBe('столов');
    expect(pluralRu(14, ...forms)).toBe('столов');
    expect(pluralRu(20, ...forms)).toBe('столов');
    expect(pluralRu(100, ...forms)).toBe('столов');
  });
  it('works with 0', () => {
    expect(pluralRu(0, ...forms)).toBe('столов');
  });
});
