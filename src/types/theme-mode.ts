export const THEME_SOURCES = ["light", "dark", "system"] as const;

export type ThemeSource = (typeof THEME_SOURCES)[number];

export function isThemeSource(value: string): value is ThemeSource {
  return (THEME_SOURCES as readonly string[]).includes(value);
}

/**
 * Backwards-compatible alias for {@link ThemeSource}; the two names describe
 * the same three-state value.
 */
export type ThemeMode = ThemeSource;
