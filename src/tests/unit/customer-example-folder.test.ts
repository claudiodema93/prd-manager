// @vitest-environment node
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseCustomerConfig } from "@/customers/config";
import { renderKeyTemplate } from "@/customers/key-template";
import { scanCustomers } from "@/customers/scan";
import { type CustomerDatabase, getCustomerRow } from "@/customers/store";
import { customers } from "@/db/schema";

const schema = { customers };

type TestDatabase = ReturnType<typeof drizzle<typeof schema>>;

const CONFIG_FILE = "customer_data.json";
const ARTICLE_FILE = "article_data.json";
const exampleRoot = path.resolve(
  import.meta.dirname,
  "../../../docs/example-articles-folder"
);
const exampleCustomer = path.join(exampleRoot, "customer-0001");
// The sample lives under docs/, which is a product artefact rather than a
// build input. Skip instead of failing CI if it is not checked out.
const hasExampleFolder = existsSync(exampleRoot);

async function readJsonObject(
  filePath: string
): Promise<Record<string, unknown>> {
  const contents = await fs.readFile(filePath, "utf8");

  return JSON.parse(contents) as Record<string, unknown>;
}

function articleValues(data: Record<string, unknown>): Record<string, string> {
  return { CODE: String(data.CODE), EVO: String(data.EVO) };
}

let sqlite: Database.Database;
let database: TestDatabase;

beforeEach(() => {
  sqlite = new Database(":memory:");
  database = drizzle({ client: sqlite, schema });
  migrate(database, {
    migrationsFolder: path.resolve(import.meta.dirname, "../../../drizzle"),
  });
});

afterEach(() => {
  sqlite.close();
});

describe("example articles folder", () => {
  it.skipIf(!hasExampleFolder)(
    "scans the example customer with two valid articles and no issues",
    async () => {
      const result = await scanCustomers({
        db: database as CustomerDatabase,
        rootDirectory: exampleRoot,
      });

      expect(result).toMatchObject({
        created: 1,
        removed: 0,
        root: exampleRoot,
        scanned: 1,
        unchanged: 0,
        updated: 0,
      });
      expect(result.issues).toEqual([]);

      const row = getCustomerRow(database as CustomerDatabase, exampleCustomer);

      expect(row).toMatchObject({
        customerCode: "0001",
        folderName: "customer-0001",
        name: "NOME_CLIENTE",
        status: "ok",
      });
      expect(row?.metadataJson).toMatchObject({
        articleCount: 2,
        issues: [],
      });
    }
  );

  it.skipIf(!hasExampleFolder)(
    "renders the example article and revision keys",
    async () => {
      const config = parseCustomerConfig(
        await readJsonObject(path.join(exampleCustomer, CONFIG_FILE))
      );

      const first = await readJsonObject(
        path.join(exampleCustomer, "article-example-1", ARTICLE_FILE)
      );
      const second = await readJsonObject(
        path.join(exampleCustomer, "article-example-2_EVO01", ARTICLE_FILE)
      );

      expect(
        renderKeyTemplate(
          config.article.key,
          config.article.parameters,
          articleValues(first)
        )
      ).toBe("article-example-1");
      expect(
        renderKeyTemplate(
          config.article.key,
          config.article.parameters,
          articleValues(second)
        )
      ).toBe("article-example-2_EVO01");

      expect(
        renderKeyTemplate(config.revision.key, config.revision.parameters, {
          REV: 0,
        })
      ).toBe("REV_0");
      expect(
        renderKeyTemplate(config.revision.key, config.revision.parameters, {
          REV: 1,
        })
      ).toBe("REV_1");
    }
  );
});
