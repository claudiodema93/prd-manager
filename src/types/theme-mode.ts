export const THEME_SOURCES = ["light", "dark", "system"] as const;

export type ThemeSource = (typeof THEME_SOURCES)[number];

/**
 * Backwards-compatible alias for {@link ThemeSource}; the two names describe
 * the same three-state value.
 */
export type ThemeMode = ThemeSource;
