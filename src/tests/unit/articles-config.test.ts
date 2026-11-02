// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  articleConfigDocument,
  isValidArticleData,
  MAX_ARTICLE_CUSTOM_PARAMETERS,
  MAX_ARTICLE_CUSTOM_VALUE_LENGTH,
  parseArticleConfig,
  parseArticleConfigJson,
  serializeArticleConfig,
} from "@/articles/config";
import { ArticleServiceError } from "@/articles/errors";
import { MAX_ARTICLE_DATA_BYTES } from "@/customers/folder";
import type { CustomerSectionDefinition } from "@/customers/types";

const articleSection: CustomerSectionDefinition = {
  key: "{CODE}[_EVO{EVO:00}]",
  parameters: {
    CODE: { required: true, type: "text" },
    EVO: { default: "0", required: false, type: "number" },
  },
  schemaVersion: 1,
};

function captureError(action: () => unknown): ArticleServiceError {
  try {
    action();
  } catch (error) {
    if (error instanceof ArticleServiceError) {
      return error;
    }

    throw error;
  }

  throw new Error("Expected the callback to throw.");
}

describe("isValidArticleData", () => {
  it("accepts a plain object with a positive schema version and matching customer", () => {
    expect(isValidArticleData({ customer: 1, schemaVersion: 1 }, "0001")).toBe(
      true
    );
    expect(
      isValidArticleData({ customer: "0001", schemaVersion: 2 }, "0001")
    ).toBe(true);
  });

  it("rejects non-objects, invalid versions and mismatched customers", () => {
    expect(isValidArticleData(null, "0001")).toBe(false);
    expect(isValidArticleData([], "0001")).toBe(false);
    expect(isValidArticleData("x", "0001")).toBe(false);
    expect(isValidArticleData({ customer: 1, schemaVersion: 0 }, "0001")).toBe(
      false
    );
    expect(
      isValidArticleData({ customer: 1, schemaVersion: 1.5 }, "0001")
    ).toBe(false);
    expect(
      isValidArticleData({ customer: "0002", schemaVersion: 1 }, "0001")
    ).toBe(false);
    expect(
      isValidArticleData({ customer: true, schemaVersion: 1 }, "0001")
    ).toBe(false);
  });
});

describe("parseArticleConfig", () => {
  it("canonicalises declared parameters and preserves custom values", () => {
    const config = parseArticleConfig(
      {
        activeRevision: "REV_1",
        CODE: "  article-example-2  ",
        CUSTOM: "  preserved  ",
        customer: "0001",
        EVO: "007",
        NUM: 3,
        SWITCH: true,
        schemaVersion: 1,
      },
      articleSection,
      "0001"
    );

    expect(config).toEqual({
      activeRevision: "REV_1",
      customer: 1,
      customParameters: {
        CUSTOM: "  preserved  ",
        NUM: 3,
        SWITCH: true,
      },
      parameters: {
        CODE: "article-example-2",
        EVO: "7",
      },
      schemaVersion: 1,
    });
  });

  it("falls back to the declared parameter defaults", () => {
    const config = parseArticleConfig(
      { CODE: "a", customer: 1, schemaVersion: 1 },
      articleSection,
      "0001"
    );

    expect(config.parameters).toEqual({ CODE: "a", EVO: "0" });
  });

  it("treats null activeRevision as absent", () => {
    const config = parseArticleConfig(
      { activeRevision: null, CODE: "a", customer: 1, schemaVersion: 1 },
      articleSection,
      "0001"
    );

    expect(config.activeRevision).toBeNull();
  });

  it("rejects a missing required parameter", () => {
    expect(
      captureError(() =>
        parseArticleConfig(
          { customer: 1, schemaVersion: 1 },
          articleSection,
          "0001"
        )
      )
    ).toMatchObject({ code: "ARTICLE_DATA_INVALID" });
  });

  it("rejects invalid declared parameter values", () => {
    for (const evo of [
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      true,
      {},
    ]) {
      expect(
        captureError(() =>
          parseArticleConfig(
            { CODE: "a", customer: 1, EVO: evo, schemaVersion: 1 },
            articleSection,
            "0001"
          )
        )
      ).toMatchObject({ code: "ARTICLE_DATA_INVALID" });
    }
  });

  it("rejects reserved keys with invalid values", () => {
    for (const value of [
      { customer: 2, schemaVersion: 1 },
      { customer: 1, schemaVersion: 0 },
      { customer: 1, schemaVersion: 1.5 },
      { customer: 1, schemaVersion: "1" },
      { activeRevision: 7, customer: 1, schemaVersion: 1 },
      { activeRevision: "", customer: 1, schemaVersion: 1 },
    ]) {
      expect(
        captureError(() =>
          parseArticleConfig({ CODE: "a", ...value }, articleSection, "0001")
        )
      ).toMatchObject({ code: "ARTICLE_DATA_INVALID" });
    }
  });

  it("rejects an invalid custom parameter name", () => {
    expect(
      captureError(() =>
        parseArticleConfig(
          { CODE: "a", customer: 1, lower: "x", schemaVersion: 1 },
          articleSection,
          "0001"
        )
      )
    ).toMatchObject({ code: "ARTICLE_DATA_INVALID" });
  });

  it("rejects custom values that are not scalar", () => {
    for (const value of [null, [], {}, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        captureError(() =>
          parseArticleConfig(
            { CODE: "a", CUSTOM: value, customer: 1, schemaVersion: 1 },
            articleSection,
            "0001"
          )
        )
      ).toMatchObject({ code: "ARTICLE_DATA_INVALID" });
    }
  });

  it("rejects oversized custom strings", () => {
    expect(
      captureError(() =>
        parseArticleConfig(
          {
            CODE: "a",
            CUSTOM: "x".repeat(MAX_ARTICLE_CUSTOM_VALUE_LENGTH + 1),
            customer: 1,
            schemaVersion: 1,
          },
          articleSection,
          "0001"
        )
      )
    ).toMatchObject({ code: "ARTICLE_DATA_INVALID" });
  });

  it("rejects a non-object document", () => {
    for (const value of [null, [], "text", 1]) {
      expect(
        captureError(() => parseArticleConfig(value, articleSection, "0001"))
      ).toMatchObject({ code: "ARTICLE_DATA_INVALID" });
    }
  });

  it("accepts a safe activeRevision component", () => {
    expect(
      parseArticleConfig(
        {
          activeRevision: "REV_1",
          CODE: "a",
          customer: 1,
          schemaVersion: 1,
        },
        articleSection,
        "0001"
      ).activeRevision
    ).toBe("REV_1");
  });

  it("rejects activeRevision values that are not a safe path component", () => {
    for (const activeRevision of [
      ".",
      "..",
      "REV/1",
      "REV\\1",
      "REV\u0001",
      "REV_1 ",
      "REV_1.",
    ]) {
      expect(
        captureError(() =>
          parseArticleConfig(
            { activeRevision, CODE: "a", customer: 1, schemaVersion: 1 },
            articleSection,
            "0001"
          )
        )
      ).toMatchObject({ code: "ARTICLE_DATA_INVALID" });
    }
  });

  it("rejects more than the maximum number of custom parameters", () => {
    const document: Record<string, unknown> = {
      CODE: "a",
      customer: 1,
      schemaVersion: 1,
    };

    for (let index = 0; index <= MAX_ARTICLE_CUSTOM_PARAMETERS; index += 1) {
      document[`CUSTOM_${index}`] = "x";
    }

    expect(
      captureError(() => parseArticleConfig(document, articleSection, "0001"))
    ).toMatchObject({ code: "ARTICLE_DATA_INVALID" });
  });
});

describe("parseArticleConfigJson", () => {
  it("parses valid JSON", () => {
    const text = JSON.stringify({
      CODE: "a",
      customer: 1,
      schemaVersion: 1,
    });

    expect(parseArticleConfigJson(text, articleSection, "0001")).toMatchObject({
      customer: 1,
      parameters: { CODE: "a", EVO: "0" },
    });
  });

  it("reports malformed JSON with ARTICLE_DATA_INVALID_JSON", () => {
    expect(
      captureError(() =>
        parseArticleConfigJson("{ broken", articleSection, "0001")
      )
    ).toMatchObject({ code: "ARTICLE_DATA_INVALID_JSON" });
  });

  it("reports an oversized document with ARTICLE_DATA_INVALID", () => {
    const text = `{"padding":"${"x".repeat(MAX_ARTICLE_DATA_BYTES)}"}`;

    expect(
      captureError(() => parseArticleConfigJson(text, articleSection, "0001"))
    ).toMatchObject({ code: "ARTICLE_DATA_INVALID" });
  });
});

describe("serializeArticleConfig", () => {
  it("writes the clean shape with two-space indentation and a newline", () => {
    const config = {
      activeRevision: "REV_1",
      customer: 1,
      customParameters: { CUSTOM: "value", FLAG: true, NUM: 3 },
      parameters: { CODE: "a", EVO: "0" },
      schemaVersion: 1,
    };
    const text = serializeArticleConfig(config);
    const parsed = JSON.parse(text) as Record<string, unknown>;

    expect(text.endsWith("\n")).toBe(true);
    expect(parsed).toEqual({
      activeRevision: "REV_1",
      CODE: "a",
      CUSTOM: "value",
      customer: 1,
      EVO: "0",
      FLAG: true,
      NUM: 3,
      schemaVersion: 1,
    });
    expect(text).toContain('\n  "schemaVersion"');
  });

  it("omits a null active revision", () => {
    const document = articleConfigDocument({
      activeRevision: null,
      customer: 1,
      customParameters: {},
      parameters: { CODE: "a", EVO: "0" },
      schemaVersion: 1,
    });

    expect(document).not.toHaveProperty("activeRevision");
  });
});
