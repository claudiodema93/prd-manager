import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/localization/i18n";
import DisplaySettingPage from "@/pages/settings/display-setting-page";
import FolderSettingPage from "@/pages/settings/folder-setting-page";
import GeneralSettingPage from "@/pages/settings/general-setting-page";
import type { FolderPreferences } from "@/types/preferences";

const {
  getFolderPreferences,
  getThemeState,
  openDirectoryDialog,
  setAppLanguage,
  setFolderPreference,
  setTheme,
} = vi.hoisted(() => ({
  getFolderPreferences: vi.fn(),
  getThemeState: vi.fn(),
  openDirectoryDialog: vi.fn(),
  setAppLanguage: vi.fn(),
  setFolderPreference: vi.fn(),
  setTheme: vi.fn(),
}));

vi.mock("@/actions/theme", () => ({ getThemeState, setTheme }));
vi.mock("@/actions/language", () => ({ setAppLanguage }));
vi.mock("@/actions/folders", () => ({
  getFolderPreferences,
  setFolderPreference,
}));
vi.mock("@/actions/dialog", () => ({ openDirectoryDialog }));

const EMPTY_FOLDERS: FolderPreferences = {
  articlesDirectory: null,
  issuesDirectory: null,
  trashDirectory: null,
};

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage("it");
});

describe("GeneralSettingPage", () => {
  it("renders nothing", () => {
    const { container } = render(<GeneralSettingPage />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe("DisplaySettingPage", () => {
  beforeEach(() => {
    getThemeState.mockResolvedValue({ dark: false, source: "system" });
    setTheme.mockResolvedValue({ dark: true, source: "dark" });
    setAppLanguage.mockResolvedValue(undefined);
  });

  it("renders the theme and language options", async () => {
    render(<DisplaySettingPage />);

    expect(
      await screen.findByRole("radio", { name: "Chiaro" })
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Scuro" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Sistema" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Italiano" })).toBeInTheDocument();
  });

  it("applies the selected theme", async () => {
    const user = userEvent.setup();
    render(<DisplaySettingPage />);

    await user.click(await screen.findByRole("radio", { name: "Scuro" }));

    await waitFor(() => expect(setTheme).toHaveBeenCalledWith("dark"));
  });

  it("applies the selected language", async () => {
    // The selector reflects i18n.language, and Radix emits "" when the active
    // item is clicked. Start from a different language so selecting Italian
    // exercises the real activation path.
    await i18n.changeLanguage("en");

    const user = userEvent.setup();
    render(<DisplaySettingPage />);

    await user.click(await screen.findByRole("radio", { name: "Italiano" }));

    await waitFor(() =>
      expect(setAppLanguage).toHaveBeenCalledWith("it", expect.anything())
    );
  });
});

describe("FolderSettingPage", () => {
  beforeEach(() => {
    getFolderPreferences.mockResolvedValue(EMPTY_FOLDERS);
    setFolderPreference.mockResolvedValue(EMPTY_FOLDERS);
    openDirectoryDialog.mockResolvedValue({ canceled: true, filePaths: [] });
  });

  it("saves the directory chosen in the native dialog", async () => {
    const user = userEvent.setup();
    const selected = { ...EMPTY_FOLDERS, articlesDirectory: "/tmp/articles" };
    openDirectoryDialog.mockResolvedValue({
      canceled: false,
      filePaths: ["/tmp/articles"],
    });
    setFolderPreference.mockResolvedValue(selected);

    render(<FolderSettingPage />);

    await waitFor(() => expect(getFolderPreferences).toHaveBeenCalledTimes(1));

    await user.click(
      screen.getByRole("button", { name: "Sfoglia Cartella articoli" })
    );

    await waitFor(() =>
      expect(setFolderPreference).toHaveBeenCalledWith(
        "articlesDirectory",
        "/tmp/articles"
      )
    );
  });

  it("clears the stored directory", async () => {
    const user = userEvent.setup();
    getFolderPreferences.mockResolvedValue({
      ...EMPTY_FOLDERS,
      articlesDirectory: "/tmp/articles",
    });

    render(<FolderSettingPage />);

    await user.click(
      await screen.findByRole("button", {
        name: "Rimuovi Cartella articoli",
      })
    );

    await waitFor(() =>
      expect(setFolderPreference).toHaveBeenCalledWith(
        "articlesDirectory",
        null
      )
    );
  });
});
