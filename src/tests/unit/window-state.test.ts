import { describe, expect, it } from "vitest";
import { DEFAULT_WINDOW_STATE } from "@/preferences/schema";
import {
  hasMinimumVisibleArea,
  resolveWindowState,
  showRestoredWindow,
} from "@/preferences/window-state";

const primary = {
  workArea: { height: 1080, width: 1920, x: 0, y: 0 },
};
const secondary = {
  workArea: { height: 1080, width: 1920, x: 1920, y: 0 },
};

describe("hasMinimumVisibleArea", () => {
  it("accepts a window fully inside the work area", () => {
    expect(
      hasMinimumVisibleArea(
        { height: 600, width: 800, x: 100, y: 100 },
        primary.workArea
      )
    ).toBe(true);
  });

  it("rejects a window that is almost entirely off-screen", () => {
    expect(
      hasMinimumVisibleArea(
        { height: 600, width: 800, x: 1900, y: 100 },
        primary.workArea
      )
    ).toBe(false);
  });

  it("accepts a partially visible window above the minimum", () => {
    expect(
      hasMinimumVisibleArea(
        { height: 600, width: 800, x: 1850, y: 100 },
        primary.workArea
      )
    ).toBe(true);
  });
});

describe("resolveWindowState", () => {
  it("uses the defaults when nothing was saved", () => {
    expect(resolveWindowState(undefined, [primary], primary)).toEqual(
      DEFAULT_WINDOW_STATE
    );
  });

  it("uses the defaults when the saved value is invalid", () => {
    const invalid = {
      ...DEFAULT_WINDOW_STATE,
      width: 1,
    };

    expect(resolveWindowState(invalid, [primary], primary)).toEqual(
      DEFAULT_WINDOW_STATE
    );
  });

  it("keeps a position that is visible on a connected display", () => {
    const saved = {
      height: 700,
      isMaximized: false,
      width: 900,
      x: 2000,
      y: 100,
    };

    expect(resolveWindowState(saved, [primary, secondary], primary)).toEqual(
      saved
    );
  });

  it("drops an off-screen position so the window is centred", () => {
    const saved = {
      height: 700,
      isMaximized: true,
      width: 900,
      x: 5000,
      y: 100,
    };

    expect(resolveWindowState(saved, [primary], primary)).toEqual({
      height: 700,
      isMaximized: true,
      width: 900,
    });
  });

  it("caps oversized dimensions to the target work area", () => {
    const saved = {
      height: 5000,
      isMaximized: false,
      width: 5000,
      x: 0,
      y: 0,
    };

    expect(resolveWindowState(saved, [primary], primary)).toEqual({
      height: 1080,
      isMaximized: false,
      width: 1920,
      x: 0,
      y: 0,
    });
  });

  it("clamps an oversized window back inside the work area", () => {
    const saved = {
      height: 700,
      isMaximized: false,
      width: 5000,
      x: 1000,
      y: 100,
    };

    expect(resolveWindowState(saved, [primary], primary)).toEqual({
      height: 700,
      isMaximized: false,
      width: 1920,
      x: 0,
      y: 100,
    });
  });

  it("drops the position when only one coordinate is present", () => {
    const saved = {
      height: 700,
      isMaximized: false,
      width: 900,
      x: 100,
    };

    expect(resolveWindowState(saved, [primary], primary)).toEqual({
      height: 700,
      isMaximized: false,
      width: 900,
    });
  });
});

describe("showRestoredWindow", () => {
  function makeWindow(destroyed = false) {
    const calls: string[] = [];

    return {
      calls,
      window: {
        isDestroyed: () => destroyed,
        maximize: () => {
          calls.push("maximize");
        },
        show: () => {
          calls.push("show");
        },
      },
    };
  }

  it("maximizes after the first paint, then shows", () => {
    const { calls, window } = makeWindow();

    showRestoredWindow(window, true);

    expect(calls).toEqual(["maximize", "show"]);
  });

  it("only shows when the window was not maximized", () => {
    const { calls, window } = makeWindow();

    showRestoredWindow(window, false);

    expect(calls).toEqual(["show"]);
  });

  it("does nothing for a destroyed window", () => {
    const { calls, window } = makeWindow(true);

    showRestoredWindow(window, true);

    expect(calls).toEqual([]);
  });
});
