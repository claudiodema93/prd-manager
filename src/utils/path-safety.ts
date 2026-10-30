// Windows accepts UNC and device paths with either separator and they all
// begin with two leading slashes: `\\server\share`, `//server/share`,
// `\\?\C:\dir` and `\\.\pipe\name`. Electron's pickers never return them, so
// they are rejected everywhere a directory path crosses the IPC boundary.
const UNC_OR_DEVICE_PREFIX = /^[\\/]{2}/u;

export function isUncOrDevicePath(value: string): boolean {
  return UNC_OR_DEVICE_PREFIX.test(value);
}
