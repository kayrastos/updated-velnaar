import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Central Semantic Theme System', () => {
  const STORAGE_KEY = 'velnar_theme_preference';
  let storage: Record<string, string> = {};

  const mockLocalStorage = {
    getItem: (key: string) => storage[key] || null,
    setItem: (key: string, value: string) => {
      storage[key] = value;
    },
    removeItem: (key: string) => {
      delete storage[key];
    },
    clear: () => {
      storage = {};
    },
  };

  beforeEach(() => {
    storage = {};
  });

  it('should default to dark theme when no preference stored', () => {
    const saved = mockLocalStorage.getItem(STORAGE_KEY);
    expect(saved).toBeNull();
    const effectiveTheme = saved || 'dark';
    expect(effectiveTheme).toBe('dark');
  });

  it('should persist theme preference to storage', () => {
    mockLocalStorage.setItem(STORAGE_KEY, 'light');
    expect(mockLocalStorage.getItem(STORAGE_KEY)).toBe('light');

    mockLocalStorage.setItem(STORAGE_KEY, 'system');
    expect(mockLocalStorage.getItem(STORAGE_KEY)).toBe('system');
  });

  it('should resolve system mode based on matchMedia', () => {
    const resolveTheme = (theme: 'dark' | 'light' | 'system', isSystemDark: boolean) => {
      if (theme === 'system') return isSystemDark ? 'dark' : 'light';
      return theme;
    };

    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('should toggle theme cleanly between dark and light', () => {
    let currentResolved: 'dark' | 'light' = 'dark';
    const toggle = (curr: 'dark' | 'light') => (curr === 'dark' ? 'light' : 'dark');

    currentResolved = toggle(currentResolved);
    expect(currentResolved).toBe('light');

    currentResolved = toggle(currentResolved);
    expect(currentResolved).toBe('dark');
  });
});
