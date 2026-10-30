// Network shares are legitimate folder choices (`\\server\share` on Windows,
// and the equivalent `//server/share` form). The Win32 device namespace is not:
// `\\?\` and `\\.\` bypass normal path handling and must never be persisted as
// a folder preference.
const DEVICE_PATH_PREFIXES = ["\\\\?\\", "\\\\.\\", "//?/", "//./"] as const;

export function isDevicePath(value: string): boolean {
  return DEVICE_PATH_PREFIXES.some((prefix) => value.startsWith(prefix));
}
