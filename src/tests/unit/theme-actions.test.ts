import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  setTheme,
  subscribeToTheme,
  syncTheme,
  toggleTheme,
} from "@/actions/theme";

const { getCurrentThemeMode, setThemeMode, toggleThemeMode } = vi.hoisted(
  () => ({
    getCurrentThemeMode: vi.fn(),
    setThemeMode: vi.fn(),
    toggleThemeMode: vi.fn(),
  })
);

// Importing the real manager opens a MessageChannel; jsdom has no bridge.
vi.mock("@/ipc/manager", () => ({
  ipc: {
    client: {
      theme: {
        getCurrentThemeMode,
        setThemeMode,
        toggleThemeMode,
      },
    },
  },
}));

type ChangeListener = (event: MediaQueryListEvent) => void;

// A single MediaQueryList object is shared by every test so the module-level
// subscription (created once by the action) stays valid across cases.
const changeListeners = new Set<ChangeListener>();

const mediaQuery = {
  addEventListener: (type: string, listener: ChangeListener) => {
    if (type === "change") {
      changeListeners.add(listener);
    }
  },
  addListener: () => undefined,
  dispatchEvent: () => true,
  matches: false,
  media: "(prefers-color-scheme: dark)",
  onchange: null,
  removeEventListener: (type: string, listener: ChangeListener) => {
    if (type === "change") {
      changeListeners.delete(listener);
    }
  },
  removeListener: () => undefined,
};

function emitSystemThemeChange(matches: boolean) {
  mediaQuery.matches = matches;

  for (const listener of changeListeners) {
    listener({ matches } as MediaQueryListEvent);
  }
}

function hasDarkClass() {
  return document.documentElement.classList.contains("dark");
}

beforeEach(() => {
  vi.clearAllMocks();
  document.documentElement.classList.remove("dark");
  mediaQuery.matches = false;
  getCurrentThemeMode.mockResolvedValue({ dark: false, source: "system" });
  window.matchMedia = vi.fn(
    () => mediaQuery
  ) as unknown as typeof window.matchMedia;
});

describe("syncTheme", () => {
  it("mirrors the system theme restored by the main process", async () => {
    mediaQuery.matches = true;
    getCurrentThemeMode.mockResolvedValue({ dark: true, source: "system" });

    await syncTheme();

    expect(getCurrentThemeMode).toHaveBeenCalledTimes(1);
    expect(setThemeMode).not.toHaveBeenCalled();
    expect(hasDarkClass()).toBe(true);
  });

  it("mirrors an explicit theme restored by the main process", async () => {
    getCurrentThemeMode.mockResolvedValue({ dark: true, source: "dark" });

    await syncTheme();

    expect(hasDarkClass()).toBe(true);
  });
});

describe("setTheme", () => {
  it("applies a dark explicit mode from the returned state", async () => {
    setThemeMode.mockResolvedValue({ dark: true, source: "dark" });

    await setTheme("dark");

    expect(setThemeMode).toHaveBeenCalledWith({ mode: "dark" });
    expect(hasDarkClass()).toBe(true);
  });

  it("uses the OS preference when switching to system on a dark OS", async () => {
    mediaQuery.matches = true;
    document.documentElement.classList.remove("dark");
    setThemeMode.mockResolvedValue({ dark: true, source: "system" });

    await setTheme("system");

    expect(setThemeMode).toHaveBeenCalledWith({ mode: "system" });
    expect(hasDarkClass()).toBe(true);
  });

  it("re-applies the dark class when the OS changes in system mode", async () => {
    setThemeMode.mockResolvedValue({ dark: false, source: "system" });

    await setTheme("system");
    expect(hasDarkClass()).toBe(false);

    emitSystemThemeChange(true);
    expect(hasDarkClass()).toBe(true);

    emitSystemThemeChange(false);
    expect(hasDarkClass()).toBe(false);
  });

  it("ignores OS changes while an explicit mode is selected", async () => {
    setThemeMode.mockResolvedValue({ dark: false, source: "light" });

    await setTheme("light");
    emitSystemThemeChange(true);

    expect(hasDarkClass()).toBe(false);
  });
});

describe("subscribeToTheme", () => {
  it("notifies subscribers until they unsubscribe", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToTheme(listener);
    setThemeMode.mockResolvedValue({ dark: true, source: "dark" });

    await setTheme("dark");

    expect(listener).toHaveBeenCalledWith({ dark: true, source: "dark" });

    unsubscribe();
    toggleThemeMode.mockResolvedValue({ dark: false, source: "light" });
    await toggleTheme();

    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("toggleTheme", () => {
  it("switches a dark system to light on the first click", async () => {
    document.documentElement.classList.add("dark");
    // The main process resolves the effective next state; a dark OS yields light.
    toggleThemeMode.mockResolvedValue({ dark: false, source: "light" });

    await toggleTheme();

    expect(toggleThemeMode).toHaveBeenCalledTimes(1);
    expect(hasDarkClass()).toBe(false);
  });

  it("applies the explicit source returned by the main process", async () => {
    toggleThemeMode.mockResolvedValue({ dark: true, source: "dark" });

    await toggleTheme();

    expect(hasDarkClass()).toBe(true);
  });
});
