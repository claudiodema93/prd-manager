import { describe, expect, it } from "vitest";
import {
  CUSTOMER_CONFIG_SCHEMA_VERSION,
  MAX_CUSTOMER_CONFIG_BYTES,
  parseCustomerConfig,
  parseCustomerConfigJson,
  parseCustomerSectionDefinition,
  serializeCustomerConfig,
} from "@/customers/config";
import { CustomerServiceError } from "@/customers/errors";
import type { CustomerConfig } from "@/customers/types";

interface TestParameter {
  default?: string;
  required: boolean;
  type: string;
}

interface TestSection {
  key: string;
  parameters: Record<string, TestParameter>;
  schemaVersion?: number;
}

interface TestConfig {
  article: TestSection;
  articleSchemaVersion?: number;
  customerName: string;
  revision: TestSection;
  revisionSchemaVersion?: number;
  schemaVersion?: number;
  [key: string]: unknown;
}

function createValidConfig(): TestConfig {
  return {
    article: {
      key: "{CODE}[_EVO{EVO:00}]",
      parameters: {
        CODE: { required: true, type: "text" },
        EVO: { default: "0", required: true, type: "number" },
      },
      schemaVersion: CUSTOMER_CONFIG_SCHEMA_VERSION,
    },
    customerName: "NOME_CLIENTE",
    revision: {
      key: "REV_{REV}",
      parameters: {
        MATERIAL: { required: false, type: "text" },
        REV: { default: "0", required: true, type: "number" },
      },
      schemaVersion: CUSTOMER_CONFIG_SCHEMA_VERSION,
    },
    schemaVersion: CUSTOMER_CONFIG_SCHEMA_VERSION,
  };
}

function withoutKey<T extends object>(value: T, key: string): T {
  return Object.fromEntries(
    Object.entries(value).filter(([entry]) => entry !== key)
  ) as T;
}

function captureError(run: () => unknown): CustomerServiceError {
  try {
    run();
  } catch (error) {
    return error as CustomerServiceError;
  }

  throw new Error("Expected the function to throw.");
}

function expectCode(run: () => unknown, code: string): CustomerServiceError {
  const error = captureError(run);

  expect(error).toBeInstanceOf(CustomerServiceError);
  expect(error).toMatchObject({ code });

  return error;
}

describe("parseCustomerConfig", () => {
  it("parses the clean v1 shape and maps customerName to name", () => {
    const config = parseCustomerConfig(createValidConfig());

    expect(config).toEqual({
      article: createValidConfig().article,
      name: "NOME_CLIENTE",
      revision: createValidConfig().revision,
      schemaVersion: CUSTOMER_CONFIG_SCHEMA_VERSION,
    });
  });

  it("trims the customer name", () => {
    const config = createValidConfig();
    config.customerName = "  NOME CLIENTE  ";

    expect(parseCustomerConfig(config).name).toBe("NOME CLIENTE");
  });

  it("rejects an empty customer name", () => {
    const config = createValidConfig();
    config.customerName = "";

    expectCode(() => parseCustomerConfig(config), "CONFIG_INVALID");
  });

  it("rejects a whitespace-only customer name", () => {
    const config = createValidConfig();
    config.customerName = "   ";

    expectCode(() => parseCustomerConfig(config), "CONFIG_INVALID");
  });

  it("accepts a 256 character customer name and rejects 257", () => {
    const accepted = createValidConfig();
    accepted.customerName = "A".repeat(256);

    expect(parseCustomerConfig(accepted).name).toHaveLength(256);

    const rejected = createValidConfig();
    rejected.customerName = "A".repeat(257);

    expectCode(() => parseCustomerConfig(rejected), "CONFIG_INVALID");
  });
});

describe("parseCustomerConfig legacy versions", () => {
  it("accepts a top-level revisionSchemaVersion when the nested one is absent", () => {
    const config = createValidConfig();
    config.revision = withoutKey(config.revision, "schemaVersion");
    config.revisionSchemaVersion = CUSTOMER_CONFIG_SCHEMA_VERSION;

    const parsed = parseCustomerConfig(config);

    expect(parsed.revision.schemaVersion).toBe(CUSTOMER_CONFIG_SCHEMA_VERSION);
  });

  it("accepts a top-level articleSchemaVersion when the nested one is absent", () => {
    const config = createValidConfig();
    config.article = withoutKey(config.article, "schemaVersion");
    config.articleSchemaVersion = CUSTOMER_CONFIG_SCHEMA_VERSION;

    const parsed = parseCustomerConfig(config);

    expect(parsed.article.schemaVersion).toBe(CUSTOMER_CONFIG_SCHEMA_VERSION);
  });

  it("accepts equal nested and top-level versions", () => {
    const config = createValidConfig();
    config.revisionSchemaVersion = CUSTOMER_CONFIG_SCHEMA_VERSION;

    expect(() => parseCustomerConfig(config)).not.toThrow();
  });

  it("rejects conflicting nested and top-level versions", () => {
    const config = createValidConfig();
    config.revisionSchemaVersion = 2;

    expectCode(() => parseCustomerConfig(config), "CONFIG_VERSION_CONFLICT");
  });

  it("does not emit the legacy fields in the result", () => {
    const config = createValidConfig();
    config.revisionSchemaVersion = CUSTOMER_CONFIG_SCHEMA_VERSION;

    const parsed = parseCustomerConfig(config) as unknown as TestConfig;

    expect(parsed).not.toHaveProperty("revisionSchemaVersion");
    expect(parsed).not.toHaveProperty("articleSchemaVersion");
  });
});

describe("parseCustomerConfig versions", () => {
  it("rejects an unsupported root schemaVersion", () => {
    const config = createValidConfig();
    config.schemaVersion = 2;

    expectCode(() => parseCustomerConfig(config), "CONFIG_UNSUPPORTED_VERSION");
  });

  it("rejects an unsupported section schemaVersion", () => {
    const config = createValidConfig();
    config.revision.schemaVersion = 2;

    expectCode(() => parseCustomerConfig(config), "CONFIG_UNSUPPORTED_VERSION");
  });

  it("rejects a non-integer schemaVersion as invalid", () => {
    const config = createValidConfig();
    config.schemaVersion = 1.5;

    expectCode(() => parseCustomerConfig(config), "CONFIG_INVALID");
  });

  it("rejects an unsupported legacy revisionSchemaVersion", () => {
    const config = createValidConfig();
    config.revision = withoutKey(config.revision, "schemaVersion");
    config.revisionSchemaVersion = 3;

    expectCode(() => parseCustomerConfig(config), "CONFIG_UNSUPPORTED_VERSION");
  });
});

describe("parseCustomerConfigJson", () => {
  it("parses valid JSON", () => {
    const config = parseCustomerConfigJson(JSON.stringify(createValidConfig()));

    expect(config.name).toBe("NOME_CLIENTE");
  });

  it("reports malformed JSON as CONFIG_INVALID_JSON", () => {
    expectCode(
      () => parseCustomerConfigJson("{ not json"),
      "CONFIG_INVALID_JSON"
    );
  });

  it("reports schema failures inside valid JSON as CONFIG_INVALID", () => {
    const config = withoutKey(createValidConfig(), "customerName");

    expectCode(
      () => parseCustomerConfigJson(JSON.stringify(config)),
      "CONFIG_INVALID"
    );
  });

  it("rejects text larger than the configured byte limit", () => {
    const oversized = "x".repeat(MAX_CUSTOMER_CONFIG_BYTES + 1);

    expectCode(() => parseCustomerConfigJson(oversized), "CONFIG_INVALID");
  });
});

describe("parseCustomerConfig strictness", () => {
  it("rejects unknown root keys", () => {
    const config = createValidConfig();
    config.extra = true;

    expectCode(() => parseCustomerConfig(config), "CONFIG_INVALID");
  });

  it("rejects unknown section keys", () => {
    const config = createValidConfig();
    (config.revision as unknown as Record<string, unknown>).extra = true;

    expectCode(() => parseCustomerConfig(config), "CONFIG_INVALID");
  });

  it("rejects unknown parameter definition keys", () => {
    const config = createValidConfig();
    (
      config.article.parameters.CODE as unknown as Record<string, unknown>
    ).extra = true;

    expectCode(() => parseCustomerConfig(config), "CONFIG_INVALID");
  });
});

describe("parseCustomerConfig parameters", () => {
  it("rejects an invalid parameter name", () => {
    const config = createValidConfig();
    config.article.parameters.lower = { required: true, type: "text" };

    expectCode(() => parseCustomerConfig(config), "CONFIG_INVALID");
  });

  it("rejects a parameter name starting with a digit", () => {
    const config = createValidConfig();
    config.article.parameters["1CODE"] = { required: true, type: "text" };

    expectCode(() => parseCustomerConfig(config), "CONFIG_INVALID");
  });

  it("rejects empty parameters", () => {
    const config = createValidConfig();
    config.article.parameters = {};

    expectCode(() => parseCustomerConfig(config), "CONFIG_INVALID");
  });

  it("rejects more than 64 parameters", () => {
    const config = createValidConfig();
    const parameters: Record<string, TestParameter> = {};

    for (let index = 0; index <= 64; index += 1) {
      parameters[`PARAM${index}`] = { required: false, type: "text" };
    }

    config.article.parameters = parameters;

    expectCode(() => parseCustomerConfig(config), "CONFIG_INVALID");
  });

  it("rejects an invalid parameter type", () => {
    const config = createValidConfig();
    config.article.parameters.CODE = {
      required: true,
      type: "date",
    };

    expectCode(() => parseCustomerConfig(config), "CONFIG_INVALID");
  });

  it("rejects a non-numeric default for a number parameter", () => {
    const config = createValidConfig();
    config.article.parameters.EVO = {
      default: "abc",
      required: true,
      type: "number",
    };

    expectCode(() => parseCustomerConfig(config), "CONFIG_INVALID");
  });

  it("rejects a negative default for a number parameter", () => {
    const config = createValidConfig();
    config.article.parameters.EVO = {
      default: "-1",
      required: true,
      type: "number",
    };

    expectCode(() => parseCustomerConfig(config), "CONFIG_INVALID");
  });

  it("rejects an invalid default for a bool parameter", () => {
    const config = createValidConfig();
    config.article.parameters.FLAG = {
      default: "yes",
      required: false,
      type: "bool",
    };

    expectCode(() => parseCustomerConfig(config), "CONFIG_INVALID");
  });

  it("accepts the supported bool defaults case-insensitively", () => {
    for (const value of ["true", "FALSE", "1", "0"]) {
      const config = createValidConfig();
      config.article.parameters.FLAG = {
        default: value,
        required: false,
        type: "bool",
      };

      expect(() => parseCustomerConfig(config)).not.toThrow();
    }
  });

  it("rejects a missing required field", () => {
    const config = createValidConfig();
    config.article.parameters.CODE = {
      type: "text",
    } as unknown as TestParameter;

    expectCode(() => parseCustomerConfig(config), "CONFIG_INVALID");
  });

  it("rejects a missing type field", () => {
    const config = createValidConfig();
    config.article.parameters.CODE = {
      required: true,
    } as unknown as TestParameter;

    expectCode(() => parseCustomerConfig(config), "CONFIG_INVALID");
  });
});

describe("parseCustomerConfig sections", () => {
  it("rejects a missing key", () => {
    const config = createValidConfig();
    (config.article as unknown as Record<string, unknown>).key = undefined;

    expectCode(() => parseCustomerConfig(config), "CONFIG_INVALID");
  });

  it("rejects a key longer than 512 characters", () => {
    const config = createValidConfig();
    config.article.key = "A".repeat(513);

    expectCode(() => parseCustomerConfig(config), "CONFIG_INVALID");
  });

  it("rejects a missing parameters record", () => {
    const config = createValidConfig();
    (config.article as unknown as Record<string, unknown>).parameters =
      undefined;

    expectCode(() => parseCustomerConfig(config), "CONFIG_INVALID");
  });

  it("rejects an invalid article key template", () => {
    const config = createValidConfig();
    config.article.key = "{UNKNOWN}";

    const error = expectCode(
      () => parseCustomerConfig(config),
      "CONFIG_INVALID"
    );

    expect(error.message).toContain("article");
  });

  it("rejects an unbalanced article key template", () => {
    const config = createValidConfig();
    config.article.key = "{CODE";

    const error = expectCode(
      () => parseCustomerConfig(config),
      "CONFIG_INVALID"
    );

    expect(error.message).toContain("article");
  });

  it("rejects an invalid revision key template", () => {
    const config = createValidConfig();
    config.revision.key = "{NOPE}";

    const error = expectCode(
      () => parseCustomerConfig(config),
      "CONFIG_INVALID"
    );

    expect(error.message).toContain("revision");
  });
});

describe("parseCustomerSectionDefinition", () => {
  it("returns a valid section unchanged", () => {
    const config = createValidConfig();

    const section = parseCustomerSectionDefinition(config.article);

    expect(section).toEqual(config.article);
  });

  it("rejects an unsupported section schemaVersion", () => {
    const config = createValidConfig();
    config.article.schemaVersion = 2;

    expectCode(
      () => parseCustomerSectionDefinition(config.article),
      "CONFIG_UNSUPPORTED_VERSION"
    );
  });

  it("rejects unknown section keys", () => {
    const config = createValidConfig();
    (config.article as unknown as Record<string, unknown>).extra = true;

    expectCode(
      () => parseCustomerSectionDefinition(config.article),
      "CONFIG_INVALID"
    );
  });

  it("rejects an invalid default", () => {
    const config = createValidConfig();
    config.article.parameters.EVO = {
      default: "nope",
      required: true,
      type: "number",
    };

    expectCode(
      () => parseCustomerSectionDefinition(config.article),
      "CONFIG_INVALID"
    );
  });

  it("rejects an invalid key template", () => {
    const config = createValidConfig();
    config.article.key = "{MISSING}";

    expectCode(
      () => parseCustomerSectionDefinition(config.article),
      "CONFIG_INVALID"
    );
  });
});

describe("serializeCustomerConfig", () => {
  it("round-trips a valid config through JSON", () => {
    const config = parseCustomerConfig(createValidConfig());

    const serialized = serializeCustomerConfig(config);
    const reparsed = parseCustomerConfigJson(serialized);

    expect(reparsed).toEqual(config);
  });

  it("emits the clean shape with a trailing newline", () => {
    const config = createValidConfig();
    config.revision = withoutKey(config.revision, "schemaVersion");
    config.revisionSchemaVersion = CUSTOMER_CONFIG_SCHEMA_VERSION;

    const legacy = parseCustomerConfig(config);
    const serialized = serializeCustomerConfig(legacy);

    expect(serialized.endsWith("\n")).toBe(true);

    const written = JSON.parse(serialized) as Record<string, unknown>;

    expect(written).not.toHaveProperty("revisionSchemaVersion");
    expect(written).not.toHaveProperty("articleSchemaVersion");
    expect(written).not.toHaveProperty("name");
    expect(written.customerName).toBe("NOME_CLIENTE");
    expect(written.article).toMatchObject({
      schemaVersion: CUSTOMER_CONFIG_SCHEMA_VERSION,
    });
    expect(written.revision).toMatchObject({
      schemaVersion: CUSTOMER_CONFIG_SCHEMA_VERSION,
    });
  });

  it("drops legacy fields present on the given object", () => {
    const clean = parseCustomerConfig(createValidConfig());
    const config = {
      ...clean,
      revisionSchemaVersion: CUSTOMER_CONFIG_SCHEMA_VERSION,
    };

    const written = JSON.parse(
      serializeCustomerConfig(config as unknown as CustomerConfig)
    ) as Record<string, unknown>;

    expect(written).not.toHaveProperty("revisionSchemaVersion");
  });

  it("validates before serialising", () => {
    const clean = parseCustomerConfig(createValidConfig());
    const config = { ...clean, schemaVersion: 2 };

    expectCode(
      () => serializeCustomerConfig(config as unknown as CustomerConfig),
      "CONFIG_UNSUPPORTED_VERSION"
    );
  });

  it("validates the key templates before serialising", () => {
    const clean = parseCustomerConfig(createValidConfig());
    const config = {
      ...clean,
      article: { ...clean.article, key: "{UNKNOWN}" },
    };

    expectCode(
      () => serializeCustomerConfig(config as unknown as CustomerConfig),
      "CONFIG_INVALID"
    );
  });
});
