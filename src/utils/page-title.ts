const PAGE_TITLE_KEYS: Record<string, string> = {
  "/": "titleHomePage",
  "/second": "titleSecondPage",
};

export const DEFAULT_PAGE_TITLE_KEY = "appName";

/**
 * Maps a router pathname to its i18n title key. Unknown paths (and the
 * in-memory router's initial paint) fall back to the application name.
 */
export function getPageTitleKey(pathname: string): string {
  // `Object.hasOwn` keeps the lookup off the prototype chain, so a pathname
  // such as "constructor" cannot return a function instead of the fallback.
  return Object.hasOwn(PAGE_TITLE_KEYS, pathname)
    ? PAGE_TITLE_KEYS[pathname]
    : DEFAULT_PAGE_TITLE_KEY;
}
