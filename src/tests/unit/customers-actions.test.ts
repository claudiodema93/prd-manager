import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearCustomers,
  createCustomer,
  getCustomer,
  listCustomers,
  removeCustomer,
  scanCustomers,
  updateCustomer,
} from "@/actions/customers";
import type {
  CreateCustomerInput,
  ListCustomersInput,
  UpdateCustomerInput,
} from "@/types/customers";

const {
  clearCustomersMock,
  createCustomerMock,
  getCustomerMock,
  listCustomersMock,
  removeCustomerMock,
  scanCustomersMock,
  updateCustomerMock,
} = vi.hoisted(() => ({
  clearCustomersMock: vi.fn(),
  createCustomerMock: vi.fn(),
  getCustomerMock: vi.fn(),
  listCustomersMock: vi.fn(),
  removeCustomerMock: vi.fn(),
  scanCustomersMock: vi.fn(),
  updateCustomerMock: vi.fn(),
}));

vi.mock("@/ipc/manager", () => ({
  ipc: {
    client: {
      customers: {
        clearCustomers: clearCustomersMock,
        createCustomer: createCustomerMock,
        getCustomer: getCustomerMock,
        listCustomers: listCustomersMock,
        removeCustomer: removeCustomerMock,
        scanCustomers: scanCustomersMock,
        updateCustomer: updateCustomerMock,
      },
    },
  },
}));

const ARTICLE_SECTION: CreateCustomerInput["article"] = {
  key: "ART-{NUM:0000}",
  parameters: {
    NUM: { required: true, type: "number" },
  },
  schemaVersion: 1,
};

const CREATE_INPUT: CreateCustomerInput = {
  article: ARTICLE_SECTION,
  name: "Acme",
  revision: {
    key: "REV-{NUM:0000}",
    parameters: {
      NUM: { required: true, type: "number" },
    },
    schemaVersion: 1,
  },
};

const UPDATE_INPUT: UpdateCustomerInput = {
  folderPath: "/p",
  name: "Beta",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("customer actions", () => {
  it("forwards the default list input", async () => {
    const page = { items: [], total: 0 };

    listCustomersMock.mockResolvedValue(page);

    await expect(listCustomers()).resolves.toBe(page);
    expect(listCustomersMock).toHaveBeenCalledWith({});
  });

  it("forwards a search filter as-is", async () => {
    const input: ListCustomersInput = { search: "x" };
    const page = { items: [], total: 0 };

    listCustomersMock.mockResolvedValue(page);

    await expect(listCustomers(input)).resolves.toBe(page);
    expect(listCustomersMock).toHaveBeenCalledWith(input);
  });

  it("wraps the folder path for getCustomer", async () => {
    const customer = { folderPath: "/p" };

    getCustomerMock.mockResolvedValue(customer);

    await expect(getCustomer("/p")).resolves.toBe(customer);
    expect(getCustomerMock).toHaveBeenCalledWith({ folderPath: "/p" });
  });

  it("forwards the createCustomer input", async () => {
    const created = { folderPath: "/p" };

    createCustomerMock.mockResolvedValue(created);

    await expect(createCustomer(CREATE_INPUT)).resolves.toBe(created);
    expect(createCustomerMock).toHaveBeenCalledWith(CREATE_INPUT);
  });

  it("forwards the updateCustomer input", async () => {
    const updated = { folderPath: "/p" };

    updateCustomerMock.mockResolvedValue(updated);

    await expect(updateCustomer(UPDATE_INPUT)).resolves.toBe(updated);
    expect(updateCustomerMock).toHaveBeenCalledWith(UPDATE_INPUT);
  });

  it("wraps the folder path for removeCustomer", async () => {
    removeCustomerMock.mockResolvedValue("/p");

    await expect(removeCustomer("/p")).resolves.toBe("/p");
    expect(removeCustomerMock).toHaveBeenCalledWith({ folderPath: "/p" });
  });

  it("forwards the empty scan input", async () => {
    const result = { created: 0 };

    scanCustomersMock.mockResolvedValue(result);

    await expect(scanCustomers()).resolves.toBe(result);
    expect(scanCustomersMock).toHaveBeenCalledWith({});
  });

  it("calls clearCustomers without arguments", async () => {
    clearCustomersMock.mockResolvedValue(3);

    await expect(clearCustomers()).resolves.toBe(3);
    expect(clearCustomersMock).toHaveBeenCalledWith();
  });
});
