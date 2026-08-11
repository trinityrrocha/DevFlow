import { describe, expect, it } from 'vitest';
import {
  THEME_STORAGE_KEY,
  applyTheme,
  oppositeTheme,
  persistTheme,
  readStoredTheme,
  resolvePreferredTheme
} from './theme';

const storage = (value = null) => ({
  value,
  getItem(key) { return key === THEME_STORAGE_KEY ? this.value : null; },
  setItem(key, next) { if (key === THEME_STORAGE_KEY) this.value = next; }
});
const media = (matches) => () => ({ matches });
const root = () => {
  const classes = new Set();
  return {
    classes,
    classList: { toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); } },
    dataset: {},
    style: {}
  };
};

describe('preferencia de tema', () => {
  it('01 usa light sem preferencia quando o sistema esta em light', () => {
    expect(resolvePreferredTheme({ storage: storage(), matchMedia: media(false) })).toBe('light');
  });

  it('02 usa dark sem preferencia quando o sistema esta em dark', () => {
    expect(resolvePreferredTheme({ storage: storage(), matchMedia: media(true) })).toBe('dark');
  });

  it('03 respeita light salvo no localStorage', () => {
    expect(resolvePreferredTheme({ storage: storage('light'), matchMedia: media(true) })).toBe('light');
  });

  it('04 respeita dark salvo no localStorage', () => {
    expect(resolvePreferredTheme({ storage: storage('dark'), matchMedia: media(false) })).toBe('dark');
  });

  it('05 preferencia salva prevalece sobre o sistema', () => {
    expect(resolvePreferredTheme({ storage: storage('light'), matchMedia: media(true) })).toBe('light');
    expect(resolvePreferredTheme({ storage: storage('dark'), matchMedia: media(false) })).toBe('dark');
  });

  it('06 alterna light para dark', () => {
    expect(oppositeTheme('light')).toBe('dark');
  });

  it('07 alterna dark para light', () => {
    expect(oppositeTheme('dark')).toBe('light');
  });

  it('08 ignora valor armazenado invalido', () => {
    const target = storage('sepia');
    expect(readStoredTheme(target)).toBeNull();
    expect(resolvePreferredTheme({ storage: target, matchMedia: media(true) })).toBe('dark');
  });

  it('09 aplica e remove a classe dark no elemento raiz', () => {
    const target = root();
    applyTheme('dark', target);
    expect(target.classes.has('dark')).toBe(true);
    expect(target.dataset.theme).toBe('dark');
    applyTheme('light', target);
    expect(target.classes.has('dark')).toBe(false);
  });

  it('10 persiste apenas valores permitidos no localStorage', () => {
    const target = storage();
    expect(persistTheme('dark', target)).toBe(true);
    expect(target.value).toBe('dark');
    expect(persistTheme('sepia', target)).toBe(false);
    expect(target.value).toBe('dark');
  });
});
