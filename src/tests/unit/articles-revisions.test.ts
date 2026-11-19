// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArticleServiceError } from "@/articles/errors";
import {
  buildRevisionNamePattern,
  countValidRevisions,
} from "@/articles/revisions";
import type {
  CustomerSectionDefinition,
  ParameterDefinitions,
} from "@/customers/types";

const NUMBER_PARAMETERS: ParameterDefinitions = {
  REV: { required: true, type: "number" },
};

function section(
  key: string,
  parameters: ParameterDefinitions
): CustomerSectionDefinition {
  return { key, parameters, schemaVersion: 1 };
}

async function captureAsyncError(
  action: () => Promise<unknown>
): Promise<ArticleServiceError> {
  try {
    await action();
  } catch (error) {
    if (error instanceof ArticleServiceError) {
      return error;
    }

    throw error;
  }

  throw new Error("Expected the call to reject.");
}

function captureError(action: () => unknown): ArticleServiceError {
  try {
    action();
  } catch (error) {
    if (error instanceof ArticleServiceError) {
      return error;
    }

    throw error;
  }

  throw new Error("Expected the call to throw.");
}

describe("buildRevisionNamePattern", () => {
  it("matches canonical unpadded numbers", () => {
    const pattern = buildRevisionNamePattern(
      section("REV_{REV}", NUMBER_PARAMETERS)
    );

    expect(pattern.test("REV_0")).toBe(true);
    expect(pattern.test("REV_1")).toBe(true);
    expect(pattern.test("REV_10")).toBe(true);
    expect(pattern.test("REV_1234")).toBe(true);
    expect(pattern.test("REV_01")).toBe(false);
    expect(pattern.test("REV_001")).toBe(false);
    expect(pattern.test("REV_")).toBe(false);
    expect(pattern.test("REV_1.0")).toBe(false);
    expect(pattern.test("REV_-1")).toBe(false);
    expect(pattern.test("REV_1x")).toBe(false);
    expect(pattern.test("XREV_1")).toBe(false);
  });

  it("matches padded and outgrown numbers", () => {
    const pattern = buildRevisionNamePattern(
      section("REV-{REV:00}", NUMBER_PARAMETERS)
    );

    expect(pattern.test("REV-00")).toBe(true);
    expect(pattern.test("REV-01")).toBe(true);
    expect(pattern.test("REV-99")).toBe(true);
    expect(pattern.test("REV-100")).toBe(true);
    expect(pattern.test("REV-1234")).toBe(true);
    expect(pattern.test("REV-0")).toBe(false);
    expect(pattern.test("REV-1")).toBe(false);
    expect(pattern.test("REV-001")).toBe(false);
    expect(pattern.test("REV-000")).toBe(false);
  });

  it("matches booleans only in canonical lower case", () => {
    const pattern = buildRevisionNamePattern(
      section("{FLAG}", { FLAG: { required: true, type: "bool" } })
    );

    expect(pattern.test("true")).toBe(true);
    expect(pattern.test("false")).toBe(true);
    expect(pattern.test("TRUE")).toBe(false);
    expect(pattern.test("1")).toBe(false);
    expect(pattern.test("0")).toBe(false);
  });

  it("matches non-empty safe text", () => {
    const pattern = buildRevisionNamePattern(
      section("A-{CODE}", { CODE: { required: true, type: "text" } })
    );

    expect(pattern.test("A-x")).toBe(true);
    expect(pattern.test("A-hello world")).toBe(true);
    expect(pattern.test("A-")).toBe(false);
    expect(pattern.test("A-a/b")).toBe(false);
    expect(pattern.test("A-a\\b")).toBe(false);
    expect(pattern.test("A-a:b")).toBe(false);
    expect(pattern.test("A-a*b")).toBe(false);
    expect(pattern.test("A-a?b")).toBe(false);
    expect(pattern.test(`A-a${String.fromCharCode(1)}b`)).toBe(false);
  });

  it("lets a non-required text placeholder match zero characters", () => {
    const optional = buildRevisionNamePattern(
      section("REV{SUFFIX}", { SUFFIX: { required: false, type: "text" } })
    );

    expect(optional.test("REV")).toBe(true);
    expect(optional.test("REVx")).toBe(true);
    expect(optional.test("RE")).toBe(false);

    const required = buildRevisionNamePattern(
      section("REV{SUFFIX}", { SUFFIX: { required: true, type: "text" } })
    );

    expect(required.test("REV")).toBe(false);
    expect(required.test("REVx")).toBe(true);

    const middle = buildRevisionNamePattern(
      section("A-{X}-B", { X: { required: false, type: "text" } })
    );

    expect(middle.test("A--B")).toBe(true);
    expect(middle.test("A-x-B")).toBe(true);
  });

  it("handles optional groups", () => {
    const pattern = buildRevisionNamePattern(
      section("{N}[_{EVO}]", {
        EVO: { required: false, type: "number" },
        N: { required: true, type: "number" },
      })
    );

    expect(pattern.test("1")).toBe(true);
    expect(pattern.test("1_0")).toBe(true);
    expect(pattern.test("1_1")).toBe(true);
    expect(pattern.test("1_01")).toBe(false);
    expect(pattern.test("1_")).toBe(false);
  });

  it("escapes literal regex metacharacters", () => {
    const pattern = buildRevisionNamePattern(
      section("V1.{REV}", NUMBER_PARAMETERS)
    );

    expect(pattern.test("V1.1")).toBe(true);
    expect(pattern.test("V1x1")).toBe(false);
    expect(pattern.test("V1.10")).toBe(true);
  });

  it("is anchored at both ends", () => {
    const pattern = buildRevisionNamePattern(
      section("REV_{REV}", NUMBER_PARAMETERS)
    );

    expect(pattern.test("REV_1 ")).toBe(false);
    expect(pattern.test(" REV_1")).toBe(false);
  });

  it("accepts an optional group with a literal separator", () => {
    const pattern = buildRevisionNamePattern(
      section("{CODE}[_EVO{EVO:00}]", {
        CODE: { required: true, type: "text" },
        EVO: { default: "0", required: false, type: "number" },
      })
    );

    expect(pattern.test("article")).toBe(true);
    expect(pattern.test("article_EVO01")).toBe(true);
    expect(pattern.test("article_EVO00")).toBe(true);
  });

  it("rejects adjacent placeholders before compiling", () => {
    expect(
      captureError(() =>
        buildRevisionNamePattern(
          section("{A}{A}", { A: { required: true, type: "number" } })
        )
      )
    ).toMatchObject({ code: "ARTICLE_DATA_INVALID" });
  });

  it("rejects adjacency exposed only when an optional group is removed", () => {
    expect(
      captureError(() =>
        buildRevisionNamePattern(
          section("{A}[{B}x]{C}", {
            A: { required: true, type: "number" },
            B: { required: false, type: "number" },
            C: { required: true, type: "number" },
          })
        )
      )
    ).toMatchObject({ code: "ARTICLE_DATA_INVALID" });
  });

  it("rejects more than eight placeholders", () => {
    const key = Array.from({ length: 9 }, () => "{A}").join("_");

    expect(
      captureError(() =>
        buildRevisionNamePattern(
          section(key, { A: { required: true, type: "number" } })
        )
      )
    ).toMatchObject({ code: "ARTICLE_DATA_INVALID" });
  });

  it("rejects more than four optional groups", () => {
    const key = `{A}${"[_x{A}]".repeat(5)}`;

    expect(
      captureError(() =>
        buildRevisionNamePattern(
          section(key, { A: { required: true, type: "number" } })
        )
      )
    ).toMatchObject({ code: "ARTICLE_DATA_INVALID" });
  });

  it("rejects a pathological repeated key without compiling a regex", () => {
    const key = "{A}".repeat(120);
    const startedAt = Date.now();

    expect(
      captureError(() =>
        buildRevisionNamePattern(
          section(key, { A: { required: true, type: "number" } })
        )
      )
    ).toMatchObject({ code: "ARTICLE_DATA_INVALID" });
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });

  it("bounds separated text placeholders instead of backtracking", () => {
    const names = ["A", "B", "C", "D", "E", "F", "G", "H"];
    const parameters: Record<string, { required: boolean; type: "text" }> = {};

    for (const name of names) {
      parameters[name] = { required: true, type: "text" };
    }

    const matcher = buildRevisionNamePattern(
      section(names.map((name) => `{${name}}`).join("-"), parameters)
    );
    // A name matching every separator but ending in a character the text
    // class rejects made the previous regex backtrack for minutes.
    const hostile = `${"a-".repeat(127)}<`;
    const startedAt = Date.now();

    expect(matcher.test(hostile)).toBe(false);
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });

  it("shares a work budget across names and aborts a hostile template", () => {
    const names = ["A", "B", "C", "D", "E", "F", "G", "H"];
    const parameters: Record<string, { required: boolean; type: "text" }> = {};

    for (const name of names) {
      parameters[name] = { required: true, type: "text" };
    }

    const matcher = buildRevisionNamePattern(
      section(names.map((name) => `{${name}}`).join("-"), parameters),
      { budget: 20_000 }
    );
    const hostile = `${"a-".repeat(127)}<`;
    const startedAt = Date.now();
    let budgetErrors = 0;

    for (let call = 0; call < 10; call += 1) {
      try {
        matcher.test(hostile);
      } catch (error) {
        expect(error).toBeInstanceOf(ArticleServiceError);
        expect((error as ArticleServiceError).code).toBe("READ_FAILED");
        budgetErrors += 1;
      }
    }

    expect(budgetErrors).toBeGreaterThan(0);
    expect(Date.now() - startedAt).toBeLessThan(5000);
  });

  it("keeps the consumed budget after a failed match", () => {
    const matcher = buildRevisionNamePattern(
      section("{A}-{B}", {
        A: { required: true, type: "text" },
        B: { required: true, type: "text" },
      }),
      { budget: 10 }
    );
    const hostile = `${"a-".repeat(120)}<`;

    expect(() => matcher.test(hostile)).toThrow(ArticleServiceError);
    // The second call must not start again with a full budget.
    expect(() => matcher.test(hostile)).toThrow(ArticleServiceError);
  });

  it("matches thousands of names with a rich key under the default budget", () => {
    const names = ["A", "B", "C", "D", "E", "F", "G", "H"];
    const parameters: Record<string, { required: boolean; type: "text" }> = {};

    for (const name of names) {
      parameters[name] = { required: true, type: "text" };
    }

    const matcher = buildRevisionNamePattern(
      section(names.map((name) => `{${name}}`).join("-"), parameters)
    );

    // A valid multi-placeholder key used to exhaust the shared budget after a
    // few hundred revision folders, which deleted the article from the cache.
    for (let index = 0; index < 1000; index += 1) {
      const part = `a${String(index).padStart(29, "0")}`;
      const name = names.map(() => part).join("-");

      expect(matcher.test(name)).toBe(true);
    }
  });
});

describe("countValidRevisions", () => {
  let tempDir: string;
  let articleFolder: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "articles-revisions-"));
    articleFolder = path.join(tempDir, "customer-0001", "article-1");

    await fs.mkdir(articleFolder, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { force: true, recursive: true });
  });

  it("counts only real directories with canonical names", async () => {
    await Promise.all([
      fs.mkdir(path.join(articleFolder, "REV_0")),
      fs.mkdir(path.join(articleFolder, "REV_1")),
      fs.mkdir(path.join(articleFolder, "REV_01")),
      fs.mkdir(path.join(articleFolder, "REV_02")),
      fs.mkdir(path.join(articleFolder, "nope")),
      fs.mkdir(path.join(articleFolder, ".REV_9")),
      fs.writeFile(path.join(articleFolder, "REV_2"), "not a directory"),
    ]);

    await expect(
      countValidRevisions(
        articleFolder,
        section("REV_{REV}", NUMBER_PARAMETERS)
      )
    ).resolves.toBe(2);
  });

  it.skipIf(process.platform === "win32")(
    "ignores symlinked revision folders",
    async () => {
      const target = path.join(tempDir, "real-revision");

      await fs.mkdir(target);
      await fs.mkdir(path.join(articleFolder, "REV_0"));
      await fs.symlink(target, path.join(articleFolder, "REV_1"), "dir");

      await expect(
        countValidRevisions(
          articleFolder,
          section("REV_{REV}", NUMBER_PARAMETERS)
        )
      ).resolves.toBe(1);
    }
  );

  it("counts padded and outgrown canonical names", async () => {
    await Promise.all([
      fs.mkdir(path.join(articleFolder, "REV-00")),
      fs.mkdir(path.join(articleFolder, "REV-01")),
      fs.mkdir(path.join(articleFolder, "REV-100")),
      fs.mkdir(path.join(articleFolder, "REV-001")),
      fs.mkdir(path.join(articleFolder, "REV-1")),
    ]);

    await expect(
      countValidRevisions(
        articleFolder,
        section("REV-{REV:00}", NUMBER_PARAMETERS)
      )
    ).resolves.toBe(3);
  });

  it("throws instead of returning a partial count above the entry cap", async () => {
    await Promise.all([
      fs.mkdir(path.join(articleFolder, "REV_0")),
      fs.mkdir(path.join(articleFolder, "REV_1")),
      fs.mkdir(path.join(articleFolder, "REV_2")),
    ]);

    expect(
      await captureAsyncError(() =>
        countValidRevisions(
          articleFolder,
          section("REV_{REV}", NUMBER_PARAMETERS),
          {
            maxEntries: 2,
          }
        )
      )
    ).toMatchObject({ code: "READ_FAILED" });
  });

  it("reports an unreadable article folder", async () => {
    expect(
      await captureAsyncError(() =>
        countValidRevisions(
          path.join(tempDir, "missing"),
          section("REV_{REV}", NUMBER_PARAMETERS)
        )
      )
    ).toMatchObject({ code: "READ_FAILED" });
  });

  it("rejects a NUL-containing path", async () => {
    expect(
      await captureAsyncError(() =>
        countValidRevisions(
          `${articleFolder}\0`,
          section("REV_{REV}", NUMBER_PARAMETERS)
        )
      )
    ).toMatchObject({ code: "ARTICLE_PATH_INVALID" });
  });
});
