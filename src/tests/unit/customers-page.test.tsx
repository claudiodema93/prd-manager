import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "i18next";
import type { ComponentProps, ReactNode } from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import "@/localization/i18n";
import CustomerDeleteDialog from "@/pages/customers/customer-delete-dialog";
import type { CustomerSummary } from "@/pages/customers/customer-types";
import CustomersPage from "@/pages/customers/customers-page";
import type { CustomerSectionDefinition } from "@/types/customers";
import type { FolderPreferences } from "@/types/preferences";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-router")>();

  return {
    ...actual,
    Link: ({
      to,
      children,
      ...props
    }: { to: string; children?: ReactNode } & Omit<
      ComponentProps<"a">,
      "href"
    >) => (
      <a href={to} {...props}>
        {children}
      </a>
    ),
  };
});

const {
  createCustomer,
  getCustomer,
  getFolderPreferences,
  listCustomers,
  removeCustomer,
  scanCustomers,
  updateCustomer,
} = vi.hoisted(() => ({
  createCustomer: vi.fn(),
  getCustomer: vi.fn(),
  getFolderPreferences: vi.fn(),
  listCustomers: vi.fn(),
  removeCustomer: vi.fn(),
  scanCustomers: vi.fn(),
  updateCustomer: vi.fn(),
}));

vi.mock("@/actions/customers", () => ({
  clearCustomers: vi.fn(),
  createCustomer,
  getCustomer,
  listCustomers,
  removeCustomer,
  scanCustomers,
  updateCustomer,
}));

vi.mock("@/actions/folders", () => ({
  getFolderPreferences,
  setFolderPreference: vi.fn(),
}));

const FOLDERS: FolderPreferences = {
  articlesDirectory: "/articles",
  issuesDirectory: "/issues",
  trashDirectory: "/trash",
};

const NO_ROOT: FolderPreferences = {
  ...FOLDERS,
  articlesDirectory: null,
};

const DELETE_DESCRIPTION_PATTERN = /verrà spostato/u;
const SCAN_SUMMARY_PATTERN = /Scansione completata/u;
const SCAN_INCOMPLETE_PATTERN = /Scansione incompleta/u;
const SCAN_ISSUES_TITLE_PATTERN = /Problemi durante la scansione/u;
const TRASH_MISSING_PATTERN = /La cartella cestino non è configurata/u;
const SUMMARY_TEXT =
  "Alcuni campi non sono validi. Controlla i campi evidenziati.";
const PARAMETER_NAME_ERROR =
  "Usa lettere maiuscole, cifre e underscore, con iniziale maiuscola (massimo 64 caratteri).";

const ARTICLE_DEFINITION: CustomerSectionDefinition = {
  key: "{CODE}[_EVO{EVO:00}]",
  parameters: {
    CODE: { required: true, type: "text" },
    EVO: { default: "0", required: true, type: "number" },
  },
  schemaVersion: 1,
};

const REVISION_DEFINITION: CustomerSectionDefinition = {
  key: "REV_{REV}",
  parameters: {
    REV: { default: "0", required: true, type: "number" },
  },
  schemaVersion: 1,
};

function makeCustomer(
  overrides: Partial<CustomerSummary> = {}
): CustomerSummary {
  return {
    articleCount: 0,
    articleSchemaVersion: 1,
    createdAt: Date.UTC(2026, 0, 1),
    customerCode: "0001",
    folderMtimeMs: 0,
    folderName: "acme",
    folderPath: "/articles/acme",
    name: "Acme",
    revisionSchemaVersion: 1,
    schemaVersion: 1,
    status: "ok",
    updatedAt: Date.UTC(2026, 0, 2, 10, 30),
    ...overrides,
  };
}

function makeDetail(customer: CustomerSummary = makeCustomer()) {
  return {
    ...customer,
    metadataJson: {
      article: ARTICLE_DEFINITION,
      articleCount: customer.articleCount,
      issues: [],
      revision: REVISION_DEFINITION,
    },
  };
}

function renderPage() {
  return render(
    <TooltipProvider>
      <CustomersPage />
    </TooltipProvider>
  );
}

class ResizeObserverStub {
  targets: Element[] = [];

  disconnect() {
    this.targets = [];
  }

  observe(target: Element) {
    this.targets.push(target);
  }

  unobserve(target: Element) {
    this.targets = this.targets.filter((item) => item !== target);
  }
}

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
  Element.prototype.setPointerCapture = () => undefined;
  globalThis.ResizeObserver =
    ResizeObserverStub as unknown as typeof ResizeObserver;
});

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage("it");

  getFolderPreferences.mockResolvedValue(FOLDERS);
  listCustomers.mockResolvedValue({ items: [], total: 0 });
  getCustomer.mockResolvedValue(makeDetail());
  createCustomer.mockResolvedValue(makeDetail());
  updateCustomer.mockResolvedValue(makeDetail());
  removeCustomer.mockResolvedValue("/articles/acme");
  scanCustomers.mockResolvedValue({
    created: 0,
    issues: [],
    removed: 0,
    root: "/articles",
    scanned: 0,
    unchanged: 0,
    updated: 0,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CustomersPage", () => {
  it("explains when the articles folder is not configured", async () => {
    getFolderPreferences.mockResolvedValue(NO_ROOT);

    renderPage();

    expect(
      await screen.findByText("Cartella articoli non configurata")
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Nuovo cliente" })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Apri impostazioni cartelle" })
    ).toHaveAttribute("href", "/settings/folders");
    expect(listCustomers).not.toHaveBeenCalled();
  });

  it("renders the table with status, article count and pagination", async () => {
    listCustomers.mockResolvedValue({
      items: [
        makeCustomer({ articleCount: 7, name: "Acme" }),
        makeCustomer({
          articleCount: 2,
          customerCode: "0002",
          folderName: "beta",
          folderPath: "/articles/beta",
          name: "Beta",
          status: "warning",
        }),
        makeCustomer({
          articleCount: 0,
          customerCode: "0003",
          folderName: "gamma",
          folderPath: "/articles/gamma",
          name: "Gamma",
          status: "error",
        }),
      ],
      total: 3,
    });

    renderPage();

    const table = await screen.findByRole("table");

    expect(within(table).getByText("Acme")).toBeInTheDocument();
    expect(within(table).getByText("Beta")).toBeInTheDocument();
    expect(within(table).getByText("Gamma")).toBeInTheDocument();
    expect(within(table).getByText("0002")).toBeInTheDocument();
    expect(within(table).getByText("Ok")).toBeInTheDocument();
    expect(within(table).getByText("Attenzione")).toBeInTheDocument();
    expect(within(table).getByText("Errore")).toBeInTheDocument();
    expect(within(table).getByText("7")).toBeInTheDocument();
    expect(screen.getByText("1–3 di 3")).toBeInTheDocument();
    expect(listCustomers).toHaveBeenCalledWith({ limit: 50, offset: 0 });
  });

  it("debounces the search and resets pagination", async () => {
    listCustomers.mockResolvedValue({
      items: [makeCustomer()],
      total: 1,
    });
    const user = userEvent.setup();

    renderPage();

    await screen.findByRole("table");
    await user.type(screen.getByRole("textbox", { name: "Cerca" }), "acme");

    await waitFor(
      () =>
        expect(listCustomers).toHaveBeenLastCalledWith({
          limit: 50,
          offset: 0,
          search: "acme",
        }),
      { timeout: 2000 }
    );
  });

  it("filters by status and resets pagination", async () => {
    listCustomers.mockResolvedValue({
      items: [makeCustomer()],
      total: 1,
    });
    const user = userEvent.setup();

    renderPage();

    await screen.findByRole("table");
    await user.click(screen.getByRole("combobox", { name: "Stato" }));
    await user.click(await screen.findByRole("option", { name: "Errore" }));

    await waitFor(() =>
      expect(listCustomers).toHaveBeenLastCalledWith({
        limit: 50,
        offset: 0,
        status: "error",
      })
    );
  });

  it("shows the filtered empty state and clears the filters", async () => {
    listCustomers
      .mockResolvedValueOnce({ items: [makeCustomer()], total: 1 })
      .mockResolvedValueOnce({ items: [], total: 0 })
      .mockResolvedValue({ items: [makeCustomer()], total: 1 });
    const user = userEvent.setup();

    renderPage();

    await screen.findByRole("table");
    await user.type(screen.getByRole("textbox", { name: "Cerca" }), "zzz");

    expect(
      await screen.findByText("Nessun cliente corrisponde ai filtri")
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Azzera filtri" }));

    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Cerca" })).toHaveValue("")
    );
    await waitFor(() =>
      expect(listCustomers).toHaveBeenLastCalledWith({
        limit: 50,
        offset: 0,
      })
    );
  });

  it("creates a customer with the prefilled section defaults", async () => {
    const user = userEvent.setup();

    renderPage();

    await screen.findByText("Nessun cliente");
    await user.click(
      screen.getAllByRole("button", { name: "Nuovo cliente" })[0]
    );

    expect(
      await screen.findByRole("dialog", { name: "Nuovo cliente" })
    ).toBeInTheDocument();

    await user.type(
      screen.getByRole("textbox", { name: "Nome cliente" }),
      "Acme"
    );
    await user.click(screen.getByRole("button", { name: "Salva" }));

    await waitFor(() => expect(createCustomer).toHaveBeenCalledTimes(1));

    const [[input]] = createCustomer.mock.calls;

    expect(input).toMatchObject({
      article: ARTICLE_DEFINITION,
      name: "Acme",
      revision: REVISION_DEFINITION,
    });
    expect(input).not.toHaveProperty("customerCode");
    expect(await screen.findByText("Cliente creato.")).toBeInTheDocument();
  });

  it("shows a focused validation summary instead of creating an invalid customer", async () => {
    const user = userEvent.setup();

    renderPage();

    await screen.findByText("Nessun cliente");
    await user.click(
      screen.getAllByRole("button", { name: "Nuovo cliente" })[0]
    );
    await screen.findByRole("dialog", { name: "Nuovo cliente" });

    await user.click(screen.getByRole("button", { name: "Salva" }));

    const summary = await screen.findByTestId("customer-form-error-summary");

    expect(summary).toHaveTextContent(SUMMARY_TEXT);
    expect(summary).toHaveFocus();
    expect(createCustomer).not.toHaveBeenCalled();
  });

  it("marks the required fields and shows section errors only after a submit", async () => {
    const user = userEvent.setup();

    renderPage();

    await screen.findByText("Nessun cliente");
    await user.click(
      screen.getAllByRole("button", { name: "Nuovo cliente" })[0]
    );
    await screen.findByRole("dialog", { name: "Nuovo cliente" });

    expect(
      screen.getByRole("textbox", { name: "Nome cliente" })
    ).toHaveAttribute("aria-required", "true");
    expect(
      screen.getByRole("textbox", { name: "Articoli: Modello chiave" })
    ).toHaveAttribute("aria-required", "true");

    await user.click(
      screen.getAllByRole("button", { name: "Aggiungi parametro" })[0]
    );

    expect(screen.queryByText(PARAMETER_NAME_ERROR)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Salva" }));

    expect(
      (await screen.findAllByText(PARAMETER_NAME_ERROR)).length
    ).toBeGreaterThan(0);
  });

  it("locks the section keys when the customer has articles", async () => {
    const customer = makeCustomer({ articleCount: 2, name: "Beta" });

    listCustomers.mockResolvedValue({ items: [customer], total: 1 });
    getCustomer.mockResolvedValue(makeDetail(customer));
    const user = userEvent.setup();

    renderPage();

    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "Modifica Beta" }));

    await screen.findByRole("dialog", { name: "Modifica cliente" });

    const articleKey = screen.getByRole("textbox", {
      name: "Articoli: Modello chiave",
    });
    const revisionKey = screen.getByRole("textbox", {
      name: "Revisioni: Modello chiave",
    });

    expect(articleKey).toHaveAttribute("readonly");
    expect(articleKey).not.toBeDisabled();
    expect(revisionKey).toHaveAttribute("readonly");
    expect(revisionKey).not.toBeDisabled();

    articleKey.focus();
    expect(articleKey).toHaveFocus();

    expect(articleKey.getAttribute("aria-describedby")).toContain(
      "customer-article-key-lock"
    );
    expect(
      screen.getAllByText("Non modificabile: il cliente ha 2 articoli.")
    ).toHaveLength(2);
    expect(
      screen.getAllByText(
        "I nomi usati nel modello chiave non sono modificabili finché il cliente ha articoli."
      )
    ).toHaveLength(2);
    expect(screen.getByRole("textbox", { name: "Nome cliente" })).toHaveValue(
      "Beta"
    );
  });

  it("keeps the summary article count when the detail is out of date", async () => {
    const customer = makeCustomer({ articleCount: 2, name: "Beta" });

    listCustomers.mockResolvedValue({ items: [customer], total: 1 });
    getCustomer.mockResolvedValue({
      ...makeDetail(customer),
      articleCount: 0,
      metadataJson: {
        article: ARTICLE_DEFINITION,
        articleCount: 0,
        issues: [],
        revision: REVISION_DEFINITION,
      },
    });
    const user = userEvent.setup();

    renderPage();

    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "Modifica Beta" }));
    await screen.findByRole("dialog", { name: "Modifica cliente" });

    expect(
      screen.getByRole("textbox", { name: "Articoli: Modello chiave" })
    ).toHaveAttribute("readonly");
    expect(screen.getByDisplayValue("CODE")).toBeDisabled();
    expect(screen.getByDisplayValue("EVO")).toBeDisabled();
  });

  it("blocks saving when the metadata is incomplete and articles exist", async () => {
    const customer = makeCustomer({ articleCount: 2, name: "Beta" });

    listCustomers.mockResolvedValue({ items: [customer], total: 1 });
    getCustomer.mockResolvedValue({
      ...customer,
      metadataJson: {
        article: null,
        articleCount: 2,
        issues: [],
        revision: null,
      },
    });
    const user = userEvent.setup();

    renderPage();

    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "Modifica Beta" }));
    await screen.findByRole("dialog", { name: "Modifica cliente" });

    expect(
      await screen.findByText(
        "Il cliente contiene articoli e la configurazione non può essere riparata da qui. Correggi i file del cliente manualmente."
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salva" })).toBeDisabled();
  });

  it("locks the parameter names referenced by the key but not their defaults", async () => {
    const customer = makeCustomer({ articleCount: 2, name: "Beta" });

    listCustomers.mockResolvedValue({ items: [customer], total: 1 });
    getCustomer.mockResolvedValue(makeDetail(customer));
    const user = userEvent.setup();

    renderPage();

    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "Modifica Beta" }));
    await screen.findByRole("dialog", { name: "Modifica cliente" });

    expect(screen.getByDisplayValue("CODE")).toBeDisabled();
    expect(screen.getByDisplayValue("EVO")).toBeDisabled();
    expect(screen.getByDisplayValue("REV")).toBeDisabled();
    expect(
      screen.getAllByRole("button", { name: "Rimuovi parametro 1" })[0]
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Rimuovi parametro 2" })
    ).toBeDisabled();

    const defaults = screen.getAllByLabelText("Predefinito (opzionale)");

    await user.clear(defaults[1]);
    await user.type(defaults[1], "3");
    await user.click(screen.getByRole("button", { name: "Salva" }));

    await waitFor(() =>
      expect(updateCustomer).toHaveBeenCalledWith(
        expect.objectContaining({
          article: expect.objectContaining({
            parameters: expect.objectContaining({
              EVO: expect.objectContaining({ default: "3" }),
            }),
          }),
        })
      )
    );
  });

  it("saves name changes from the edit sheet", async () => {
    const customer = makeCustomer({ name: "Beta" });

    listCustomers.mockResolvedValue({ items: [customer], total: 1 });
    getCustomer.mockResolvedValue(makeDetail(customer));
    const user = userEvent.setup();

    renderPage();

    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "Modifica Beta" }));
    await screen.findByRole("dialog", { name: "Modifica cliente" });

    const nameInput = screen.getByRole("textbox", { name: "Nome cliente" });

    await user.clear(nameInput);
    await user.type(nameInput, "Beta Due");
    await user.click(screen.getByRole("button", { name: "Salva" }));

    await waitFor(() =>
      expect(updateCustomer).toHaveBeenCalledWith(
        expect.objectContaining({
          folderPath: "/articles/acme",
          name: "Beta Due",
        })
      )
    );
    expect(await screen.findByText("Cliente aggiornato.")).toBeInTheDocument();
  });

  it("keeps the sheet open and maps a save failure", async () => {
    createCustomer.mockRejectedValueOnce(new Error("write failed"));
    const user = userEvent.setup();

    renderPage();

    await screen.findByText("Nessun cliente");
    await user.click(
      screen.getAllByRole("button", { name: "Nuovo cliente" })[0]
    );
    await screen.findByRole("dialog", { name: "Nuovo cliente" });
    await user.type(
      screen.getByRole("textbox", { name: "Nome cliente" }),
      "Acme"
    );
    await user.click(screen.getByRole("button", { name: "Salva" }));

    expect(
      await screen.findByText("Si è verificato un errore imprevisto. Riprova.")
    ).toBeInTheDocument();
    const summary = screen.getByTestId("customer-form-error-summary");

    await waitFor(() => expect(summary).toHaveFocus());
    expect(summary).toHaveTextContent(SUMMARY_TEXT);
    expect(
      screen.getByRole("dialog", { name: "Nuovo cliente" })
    ).toBeInTheDocument();
  });

  it("asks before discarding unsaved changes", async () => {
    const user = userEvent.setup();

    renderPage();

    await screen.findByText("Nessun cliente");
    await user.click(
      screen.getAllByRole("button", { name: "Nuovo cliente" })[0]
    );
    await user.type(
      await screen.findByRole("textbox", { name: "Nome cliente" }),
      "Bozza"
    );
    await user.click(screen.getByRole("button", { name: "Annulla" }));

    const confirm = await screen.findByRole("alertdialog", {
      name: "Modifiche non salvate",
    });

    await user.click(
      within(confirm).getByRole("button", { name: "Continua a modificare" })
    );

    expect(
      screen.getByRole("dialog", { name: "Nuovo cliente" })
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Annulla" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Esci senza salvare",
      })
    );

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Nuovo cliente" })
      ).not.toBeInTheDocument()
    );
  });

  it("deletes a customer with no articles after confirmation", async () => {
    listCustomers.mockResolvedValue({
      items: [makeCustomer()],
      total: 1,
    });
    const user = userEvent.setup();

    renderPage();

    await screen.findByRole("table");
    await user.click(
      screen.getByRole("button", { name: "Sposta Acme nel cestino" })
    );

    const dialog = await screen.findByRole("alertdialog");

    expect(
      within(dialog).getByText("Spostare il cliente nel cestino?")
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(DELETE_DESCRIPTION_PATTERN)
    ).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("button", { name: "Sposta nel cestino" })
    );

    await waitFor(() =>
      expect(removeCustomer).toHaveBeenCalledWith("/articles/acme")
    );
    expect(
      await screen.findByText("Cliente spostato nel cestino.")
    ).toBeInTheDocument();
  });

  it("rescans the folder and reports the result", async () => {
    listCustomers.mockResolvedValue({
      items: [makeCustomer()],
      total: 1,
    });
    scanCustomers.mockResolvedValue({
      created: 1,
      issues: [
        {
          code: "CONFIG_INVALID",
          message: "Broken config",
          path: "/articles/broken",
          severity: "warning",
        },
      ],
      removed: 0,
      root: "/articles",
      scanned: 2,
      unchanged: 1,
      updated: 1,
    });
    const user = userEvent.setup();

    renderPage();

    await screen.findByRole("table");
    await user.click(
      screen.getByRole("button", { name: "Scansiona cartella" })
    );

    await waitFor(() => expect(scanCustomers).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(SCAN_SUMMARY_PATTERN)).toBeInTheDocument();
    expect(screen.getByText(SCAN_ISSUES_TITLE_PATTERN)).toBeInTheDocument();
    expect(
      screen.getByText("La configurazione del cliente non è valida.")
    ).toBeInTheDocument();
    expect(screen.getByText("Broken config")).toBeInTheDocument();
    await waitFor(() => expect(listCustomers).toHaveBeenCalledTimes(2));
  });

  it("reports an incomplete scan instead of a success", async () => {
    listCustomers.mockResolvedValue({
      items: [makeCustomer()],
      total: 1,
    });
    scanCustomers.mockResolvedValue({
      created: 0,
      issues: [
        {
          code: "ROOT_MISSING",
          message: "Cartella non trovata",
          severity: "error",
        },
      ],
      removed: 0,
      root: null,
      scanned: 0,
      unchanged: 0,
      updated: 0,
    });
    const user = userEvent.setup();

    renderPage();

    await screen.findByRole("table");
    await user.click(
      screen.getByRole("button", { name: "Scansiona cartella" })
    );

    expect(
      await screen.findByText(SCAN_INCOMPLETE_PATTERN)
    ).toBeInTheDocument();
    expect(screen.queryByText(SCAN_SUMMARY_PATTERN)).not.toBeInTheDocument();
    expect(
      screen.getByText("La cartella articoli non esiste.")
    ).toBeInTheDocument();
    expect(screen.getByText("Cartella non trovata")).toBeInTheDocument();
  });

  it("keeps a blocked delete action focusable but inert", async () => {
    const customer = makeCustomer({ articleCount: 2, name: "Beta" });

    listCustomers.mockResolvedValue({ items: [customer], total: 1 });
    const user = userEvent.setup();

    renderPage();

    await screen.findByRole("table");

    const button = screen.getByRole("button", {
      name: "Spostamento non disponibile: il cliente ha 2 articoli.",
    });

    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();

    act(() => {
      button.focus();
    });
    expect(button).toHaveFocus();

    await user.click(button);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("shows an error and retries the list", async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    listCustomers.mockRejectedValueOnce(new Error("boom"));
    const user = userEvent.setup();

    renderPage();

    expect(
      await screen.findByText("Impossibile caricare i clienti.")
    ).toBeInTheDocument();

    listCustomers.mockResolvedValue({
      items: [makeCustomer()],
      total: 1,
    });
    await user.click(screen.getByRole("button", { name: "Riprova" }));

    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(error).toHaveBeenCalled();
  });
});

describe("CustomerDeleteDialog", () => {
  it("blocks deletion when the customer has articles", async () => {
    render(
      <CustomerDeleteDialog
        customer={makeCustomer({ articleCount: 3 })}
        onClose={vi.fn()}
        onDeleted={vi.fn()}
        trashDirectory="/trash"
      />
    );

    const dialog = await screen.findByRole("alertdialog");

    expect(
      within(dialog).getByText("Spostare il cliente nel cestino?")
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Il cliente contiene 3 articoli. Rimuovili prima di spostarlo nel cestino."
      )
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Sposta nel cestino" })
    ).toBeDisabled();
  });

  it("explains when the trash folder is missing and links to settings", async () => {
    render(
      <CustomerDeleteDialog
        customer={makeCustomer()}
        onClose={vi.fn()}
        onDeleted={vi.fn()}
        trashDirectory={null}
      />
    );

    const dialog = await screen.findByRole("alertdialog");

    expect(within(dialog).getByText(TRASH_MISSING_PATTERN)).toBeInTheDocument();

    const link = within(dialog).getByRole("link", {
      name: "Apri impostazioni cartelle",
    });

    expect(link).toHaveAttribute("href", "/settings/folders");
    expect(
      within(dialog).getByRole("button", { name: "Sposta nel cestino" })
    ).toBeDisabled();
  });
});
