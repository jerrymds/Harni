import { describe, it, expect } from 'vitest';
import { computeThemeClasses, THEME_CLASS_MAP, FONT_SIZE_CLASS_MAP, CODE_FONT_CLASS_MAP } from './useThemeClasses.js';

describe('computeThemeClasses', () => {
  it('correctly maps known themes', () => {
    expect(computeThemeClasses('lavender', 'base', 'fira', false)).toContain('theme-lavender');
    expect(computeThemeClasses('khaki', 'base', 'fira', false)).toContain('theme-khaki');
    expect(computeThemeClasses('grass', 'base', 'fira', false)).toContain('theme-grass');
    expect(computeThemeClasses('indigo', 'base', 'fira', false)).toContain('theme-indigo');
    expect(computeThemeClasses('dark', 'base', 'fira', false)).toContain('theme-dark');
    expect(computeThemeClasses('charcoal', 'base', 'fira', false)).toContain('theme-dark');
    expect(computeThemeClasses('slate', 'base', 'fira', false)).toContain('theme-slate');
    expect(computeThemeClasses('void', 'base', 'fira', false)).toContain('theme-eye-friendly');
    expect(computeThemeClasses('eye-friendly', 'base', 'fira', false)).toContain('theme-eye-friendly');
  });

  it('falls back to default theme for unknown themes', () => {
    expect(computeThemeClasses('unknown-theme', 'base', 'fira', false)).toContain('theme-eye-friendly');
  });

  it('correctly maps font size classes', () => {
    expect(computeThemeClasses('dark', 'sm', 'fira', false)).toContain('font-size-sm');
    expect(computeThemeClasses('dark', 'lg', 'fira', false)).toContain('font-size-lg');
    expect(computeThemeClasses('dark', 'base', 'fira', false)).toContain('font-size-base');
    expect(computeThemeClasses('dark', 'custom', 'fira', false)).toContain('font-size-base');
  });

  it('correctly maps code font classes', () => {
    expect(computeThemeClasses('dark', 'base', 'jetbrains', false)).toContain('font-code-jetbrains');
    expect(computeThemeClasses('dark', 'base', 'consolas', false)).toContain('font-code-consolas');
    expect(computeThemeClasses('dark', 'base', 'system', false)).toContain('font-code-system');
    expect(computeThemeClasses('dark', 'base', 'fira', false)).toContain('font-code-fira');
    expect(computeThemeClasses('dark', 'base', 'unknown', false)).toContain('font-code-fira');
  });

  it('handles compactMode boolean correctly', () => {
    expect(computeThemeClasses('dark', 'base', 'fira', true)).toContain('density-compact');
    expect(computeThemeClasses('dark', 'base', 'fira', false)).not.toContain('density-compact');
  });

  it('combines classes separated by spaces without extra blanks', () => {
    const res = computeThemeClasses('lavender', 'sm', 'consolas', true);
    expect(res).toBe('theme-lavender font-size-sm font-code-consolas density-compact');
  });
});
