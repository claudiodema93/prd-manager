import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThemeState } from "@/actions/theme";
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
  subscribeToTheme,
} = vi.hoisted(() => ({
  getFolderPreferences: vi.fn(),
  getThemeState: vi.fn(),
  openDirectoryDialog: vi.fn(),
  setAppLanguage: vi.fn(),
  setFolderPreference: vi.fn(),
  setTheme: vi.fn(),
  subscribeToTheme: vi.fn(),
}));

vi.mock("@/actions/theme", () => ({
  getThemeState,
  setTheme,
  subscribeToTheme,
}));
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

afterEach(() => {
  vi.restoreAllMocks();
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
    subscribeToTheme.mockReturnValue(() => undefined);
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

  it("follows theme changes made outside the page", async () => {
    let listener: ((state: ThemeState) => void) | null = null;
    subscribeToTheme.mockImplementation((next: (state: ThemeState) => void) => {
      listener = next;

      return () => undefined;
    });

    render(<DisplaySettingPage />);

    await screen.findByRole("radio", { name: "Sistema" });

    act(() => {
      listener?.({ dark: true, source: "dark" });
    });

    await waitFor(() =>
      expect(screen.getByRole("radio", { name: "Scuro" })).toBeChecked()
    );
  });

  it("ignores an initial read that arrives after an external change", async () => {
    let resolveRead!: (state: ThemeState) => void;
    let listener: ((state: ThemeState) => void) | null = null;
    getThemeState.mockReturnValue(
      new Promise<ThemeState>((resolve) => {
        resolveRead = resolve;
      })
    );
    subscribeToTheme.mockImplementation((next: (state: ThemeState) => void) => {
      listener = next;

      return () => undefined;
    });

    render(<DisplaySettingPage />);

    await screen.findByRole("radio", { name: "Sistema" });

    act(() => {
      listener?.({ dark: true, source: "dark" });
    });

    await waitFor(() =>
      expect(screen.getByRole("radio", { name: "Scuro" })).toBeChecked()
    );

    await act(async () => {
      resolveRead({ dark: false, source: "system" });
      await Promise.resolve();
    });

    expect(screen.getByRole("radio", { name: "Scuro" })).toBeChecked();
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

    const articlesInput = await screen.findByRole("textbox", {
      name: "Cartella articoli",
    });

    expect(articlesInput).toHaveValue("");

    await user.click(
      screen.getByRole("button", { name: "Sfoglia Cartella articoli" })
    );

    await waitFor(() =>
      expect(setFolderPreference).toHaveBeenCalledWith(
        "articlesDirectory",
        "/tmp/articles"
      )
    );
    await waitFor(() => expect(articlesInput).toHaveValue("/tmp/articles"));
    expect(
      screen.getByRole("button", { name: "Rimuovi Cartella articoli" })
    ).toBeInTheDocument();
    expect(openDirectoryDialog).toHaveBeenCalledWith({
      buttonLabel: "Scegli cartella",
      defaultPath: undefined,
      title: "Seleziona una cartella",
    });
  });

  it("does nothing when the dialog is cancelled", async () => {
    const user = userEvent.setup();

    render(<FolderSettingPage />);

    await user.click(
      await screen.findByRole("button", {
        name: "Sfoglia Cartella articoli",
      })
    );

    await waitFor(() => expect(openDirectoryDialog).toHaveBeenCalledTimes(1));
    expect(setFolderPreference).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("clears the stored directory", async () => {
    const user = userEvent.setup();
    getFolderPreferences.mockResolvedValue({
      ...EMPTY_FOLDERS,
      articlesDirectory: "/tmp/articles",
    });

    render(<FolderSettingPage />);

    const articlesInput = await screen.findByRole("textbox", {
      name: "Cartella articoli",
    });

    expect(articlesInput).toHaveValue("/tmp/articles");

    await user.click(
      screen.getByRole("button", { name: "Rimuovi Cartella articoli" })
    );

    await waitFor(() =>
      expect(setFolderPreference).toHaveBeenCalledWith(
        "articlesDirectory",
        null
      )
    );
    await waitFor(() => expect(articlesInput).toHaveValue(""));
    expect(
      screen.queryByRole("button", { name: "Rimuovi Cartella articoli" })
    ).not.toBeInTheDocument();
  });

  it("shows a load error and still renders the rows", async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    getFolderPreferences.mockRejectedValueOnce(new Error("load failed"));

    render(<FolderSettingPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Impossibile caricare le cartelle."
    );
    expect(
      screen.getByRole("textbox", { name: "Cartella articoli" })
    ).toBeInTheDocument();
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("shows a save error and keeps the previous value", async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    openDirectoryDialog.mockResolvedValue({
      canceled: false,
      filePaths: ["/tmp/articles"],
    });
    setFolderPreference.mockRejectedValueOnce(new Error("write failed"));

    const user = userEvent.setup();

    render(<FolderSettingPage />);

    const articlesInput = await screen.findByRole("textbox", {
      name: "Cartella articoli",
    });

    await user.click(
      screen.getByRole("button", { name: "Sfoglia Cartella articoli" })
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Impossibile salvare la cartella selezionata."
    );
    expect(articlesInput).toHaveValue("");
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("shows a save error when clearing fails", async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    getFolderPreferences.mockResolvedValue({
      ...EMPTY_FOLDERS,
      articlesDirectory: "/tmp/articles",
    });
    setFolderPreference.mockRejectedValueOnce(new Error("write failed"));

    const user = userEvent.setup();

    render(<FolderSettingPage />);

    await user.click(
      await screen.findByRole("button", {
        name: "Rimuovi Cartella articoli",
      })
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Impossibile salvare la cartella selezionata."
    );
    expect(
      screen.getByRole("textbox", { name: "Cartella articoli" })
    ).toHaveValue("/tmp/articles");
    expect(error).toHaveBeenCalledTimes(1);
  });
});
