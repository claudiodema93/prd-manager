import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ToggleTheme from "@/components/toggle-theme";

const { toggleThemeMode } = vi.hoisted(() => ({
  toggleThemeMode: vi.fn(),
}));

// Mocking the manager is required: importing the real module creates a
// MessageChannel and posts to the main-process bridge, which does not exist
// under jsdom.
vi.mock("@/ipc/manager", () => ({
  ipc: {
    client: {
      theme: {
        toggleThemeMode,
      },
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});

describe("ToggleTheme", () => {
  it("renders a button with the moon icon", () => {
    render(<ToggleTheme />);

    const button = screen.getByRole("button");

    expect(button).toBeInTheDocument();
    expect(button.querySelector("svg")?.classList).toContain("lucide-moon");
  });

  it("calls the toggle action and applies the returned dark state", async () => {
    toggleThemeMode.mockResolvedValue({ dark: true, source: "dark" });

    render(<ToggleTheme />);
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(toggleThemeMode).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(document.documentElement.classList.contains("dark")).toBe(true)
    );
  });

  it("removes the dark class when the toggle resolves light", async () => {
    document.documentElement.classList.add("dark");
    toggleThemeMode.mockResolvedValue({ dark: false, source: "light" });

    render(<ToggleTheme />);
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() =>
      expect(document.documentElement.classList.contains("dark")).toBe(false)
    );
  });

  it("handles a rejected toggle without an unhandled rejection", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    toggleThemeMode.mockRejectedValue(new Error("ipc unavailable"));

    render(<ToggleTheme />);
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(consoleError).toHaveBeenCalled());
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    consoleError.mockRestore();
  });
});
