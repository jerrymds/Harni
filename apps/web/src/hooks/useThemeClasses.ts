import { useEffect, useMemo } from 'react';
import { useAgentStore, useShallow } from '../store/useAgentStore.js';

export const THEME_CLASS_MAP: Record<string, string> = {
  lavender: 'theme-lavender',
  khaki: 'theme-khaki',
  grass: 'theme-grass',
  indigo: 'theme-indigo',
  dark: 'theme-dark',
  charcoal: 'theme-dark',
  slate: 'theme-slate',
  void: 'theme-eye-friendly',
  'eye-friendly': 'theme-eye-friendly',
};

export const FONT_SIZE_CLASS_MAP: Record<string, string> = {
  sm: 'font-size-sm',
  lg: 'font-size-lg',
  base: 'font-size-base',
};

export const CODE_FONT_CLASS_MAP: Record<string, string> = {
  jetbrains: 'font-code-jetbrains',
  consolas: 'font-code-consolas',
  system: 'font-code-system',
  fira: 'font-code-fira',
};

export function computeThemeClasses(
  theme: string,
  fontSize: string,
  codeFont: string,
  compactMode: boolean,
): string {
  const themeClass = THEME_CLASS_MAP[theme] || 'theme-eye-friendly';
  const fontClass = FONT_SIZE_CLASS_MAP[fontSize] || 'font-size-base';
  const codeFontClass = CODE_FONT_CLASS_MAP[codeFont] || 'font-code-fira';
  const compactClass = compactMode ? 'density-compact' : '';

  return [themeClass, fontClass, codeFontClass, compactClass]
    .filter(Boolean)
    .join(' ');
}

export function useThemeClasses(): string {
  const { theme, fontSize, codeFont, compactMode } = useAgentStore(
    useShallow((s) => ({
      theme: s.theme,
      fontSize: s.fontSize,
      codeFont: s.codeFont,
      compactMode: s.compactMode,
    }))
  );

  const combinedClasses = useMemo(
    () => computeThemeClasses(theme, fontSize, codeFont, compactMode),
    [theme, fontSize, codeFont, compactMode]
  );

  useEffect(() => {
    document.documentElement.className = combinedClasses;
    document.body.className = `antialiased overflow-hidden ${combinedClasses}`;
  }, [combinedClasses]);

  return combinedClasses;
}
