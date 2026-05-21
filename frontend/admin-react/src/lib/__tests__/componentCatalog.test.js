import { describe, it, expect } from 'vitest';
import {
  BUILTIN_COMPONENTS,
  mergeComponentCatalog,
  groupComponents,
  viewBoxString,
  labelPrefixForComponent,
} from '../componentCatalog.js';

describe('mergeComponentCatalog', () => {
  it('with empty array returns all builtin components', () => {
    const result = mergeComponentCatalog([]);
    expect(result.length).toBe(BUILTIN_COMPONENTS.length);
    expect(result.map((c) => c.id)).toEqual(BUILTIN_COMPONENTS.map((c) => c.id));
  });

  it('custom component with existing id overrides builtin', () => {
    const override = { id: 'desk-short', label: 'Кастомный стол', svg_markup: '<rect/>', palette_group: 'workstations' };
    const result = mergeComponentCatalog([override]);
    const found = result.find((c) => c.id === 'desk-short');
    expect(found.label).toBe('Кастомный стол');
    expect(result.length).toBe(BUILTIN_COMPONENTS.length); // count unchanged
  });

  it('new custom component is appended after builtins', () => {
    const custom = { id: 'my-custom', label: 'Мой компонент', svg_markup: '<circle/>', palette_group: 'custom' };
    const result = mergeComponentCatalog([custom]);
    expect(result.length).toBe(BUILTIN_COMPONENTS.length + 1);
    expect(result.find((c) => c.id === 'my-custom')).toBeDefined();
  });

  it('component without palette_group gets "custom"', () => {
    const custom = { id: 'no-group', label: 'Без группы', svg_markup: '<rect/>' };
    const result = mergeComponentCatalog([custom]);
    const found = result.find((c) => c.id === 'no-group');
    expect(found.palette_group).toBe('custom');
  });

  it('is_system is coerced to boolean', () => {
    const custom = { id: 'my-thing', svg_markup: '', is_system: 1 };
    const result = mergeComponentCatalog([custom]);
    expect(result.find((c) => c.id === 'my-thing').is_system).toBe(true);
  });

  it('skips items without id', () => {
    const result = mergeComponentCatalog([{ label: 'no id' }, null, undefined]);
    expect(result.length).toBe(BUILTIN_COMPONENTS.length);
  });

  it('handles null / undefined input gracefully', () => {
    expect(mergeComponentCatalog(null).length).toBe(BUILTIN_COMPONENTS.length);
    expect(mergeComponentCatalog(undefined).length).toBe(BUILTIN_COMPONENTS.length);
  });
});

describe('groupComponents', () => {
  it('filters out groups with no items', () => {
    const components = [
      { id: 'c1', palette_group: 'workstations' },
      { id: 'c2', palette_group: 'workstations' },
    ];
    const groups = groupComponents(components);
    expect(groups.every((g) => g.items.length > 0)).toBe(true);
    expect(groups.find((g) => g.id === 'workstations')).toBeDefined();
    expect(groups.find((g) => g.id === 'meeting')).toBeUndefined();
  });

  it('component with unknown palette_group falls into "custom" group', () => {
    const components = [{ id: 'c1', palette_group: 'nonexistent' }];
    const groups = groupComponents(components);
    const customGroup = groups.find((g) => g.id === 'custom');
    expect(customGroup).toBeDefined();
    expect(customGroup.items[0].id).toBe('c1');
  });

  it('returns empty array for empty input', () => {
    expect(groupComponents([])).toEqual([]);
  });

  it('groups all BUILTIN_COMPONENTS without error', () => {
    const groups = groupComponents(BUILTIN_COMPONENTS);
    const total = groups.reduce((sum, g) => sum + g.items.length, 0);
    expect(total).toBe(BUILTIN_COMPONENTS.length);
  });
});

describe('viewBoxString', () => {
  it('returns space-joined view_box array', () => {
    expect(viewBoxString({ view_box: [0, 0, 100, 60] })).toBe('0 0 100 60');
  });

  it('falls back to default_w/default_h when view_box absent', () => {
    expect(viewBoxString({ default_w: 80, default_h: 40 })).toBe('0 0 80 40');
  });

  it('handles null component', () => {
    expect(viewBoxString(null)).toBe('0 0 100 60');
  });
});

describe('labelPrefixForComponent', () => {
  it('returns WP for workplace', () => {
    expect(labelPrefixForComponent({ asset_type: 'workplace' })).toBe('WP');
  });
  it('returns D for desk', () => {
    expect(labelPrefixForComponent({ asset_type: 'desk' })).toBe('D');
  });
  it('returns M for meeting_table and conference_set', () => {
    expect(labelPrefixForComponent({ asset_type: 'meeting_table' })).toBe('M');
    expect(labelPrefixForComponent({ asset_type: 'conference_set' })).toBe('M');
  });
  it('returns A for unknown type', () => {
    expect(labelPrefixForComponent({ asset_type: 'unknown' })).toBe('A');
    expect(labelPrefixForComponent(null)).toBe('A');
  });
});
