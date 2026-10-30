import {
  DEFAULT_WINDOW_STATE,
  WINDOW_MIN_HEIGHT,
  WINDOW_MIN_WIDTH,
  type WindowState,
  windowStateSchema,
} from "./schema";

export interface Rectangle {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface DisplayLike {
  workArea: Rectangle;
}

/** At least this much of each axis must stay inside a display. */
const MIN_VISIBLE_PIXELS = 64;

/**
 * Whether enough of `bounds` lies inside `workArea` for the window to be
 * reachable. `Display.workArea` excludes the taskbar/dock.
 * Source: https://www.electronjs.org/docs/latest/api/screen#display-object
 */
export function hasMinimumVisibleArea(
  bounds: Rectangle,
  workArea: Rectangle
): boolean {
  const overlapWidth =
    Math.min(bounds.x + bounds.width, workArea.x + workArea.width) -
    Math.max(bounds.x, workArea.x);
  const overlapHeight =
    Math.min(bounds.y + bounds.height, workArea.y + workArea.height) -
    Math.max(bounds.y, workArea.y);

  return (
    overlapWidth >= Math.min(MIN_VISIBLE_PIXELS, bounds.width) &&
    overlapHeight >= Math.min(MIN_VISIBLE_PIXELS, bounds.height)
  );
}

/**
 * Resolves a persisted window state into one Electron can create on the
 * current display layout. Off-screen positions are dropped so the window is
 * centred; dimensions are capped to the target work area.
 *
 * `win.getNormalBounds()` always returns the normal-state rectangle, even when
 * the window is maximized, minimized or fullscreen.
 * Source: https://www.electronjs.org/docs/latest/api/browser-window#wingetnormalbounds
 */
export function resolveWindowState(
  saved: WindowState | undefined,
  displays: readonly DisplayLike[],
  primary: DisplayLike
): WindowState {
  const parsed = windowStateSchema.safeParse(saved);
  const candidate = parsed.success ? parsed.data : DEFAULT_WINDOW_STATE;

  if (candidate.x === undefined || candidate.y === undefined) {
    return clampToWorkArea(candidate, primary.workArea, false);
  }

  const bounds: Rectangle = {
    height: candidate.height,
    width: candidate.width,
    x: candidate.x,
    y: candidate.y,
  };
  const display = displays.find((entry) =>
    hasMinimumVisibleArea(bounds, entry.workArea)
  );

  if (!display) {
    return clampToWorkArea(candidate, primary.workArea, false);
  }

  return clampToWorkArea(candidate, display.workArea, true);
}

export interface WindowLifecycle {
  isDestroyed: () => boolean;
  maximize: () => void;
  show: () => void;
}

/**
 * Restores the maximized state after the first paint. `maximize()` also shows
 * the window, so calling it before `ready-to-show` would bypass the
 * `show: false` guard.
 */
export function showRestoredWindow(
  window: WindowLifecycle,
  isMaximized: boolean
): void {
  if (window.isDestroyed()) {
    return;
  }

  if (isMaximized) {
    window.maximize();
  }

  window.show();
}

function clampToWorkArea(
  state: WindowState,
  workArea: Rectangle,
  keepPosition: boolean
): WindowState {
  const width = Math.max(
    WINDOW_MIN_WIDTH,
    Math.min(state.width, workArea.width)
  );
  const height = Math.max(
    WINDOW_MIN_HEIGHT,
    Math.min(state.height, workArea.height)
  );

  if (!keepPosition || state.x === undefined || state.y === undefined) {
    return { height, isMaximized: state.isMaximized, width };
  }

  // Keep the whole window inside the chosen work area, including when the
  // saved size was larger than the display and had to be capped.
  const maxX = workArea.x + workArea.width - width;
  const maxY = workArea.y + workArea.height - height;

  return {
    height,
    isMaximized: state.isMaximized,
    width,
    x: Math.min(Math.max(state.x, workArea.x), maxX),
    y: Math.min(Math.max(state.y, workArea.y), maxY),
  };
}
