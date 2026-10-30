import { describe, expect, it } from "vitest";
import { DEFAULT_PAGE_TITLE_KEY, getPageTitleKey } from "@/utils/page-title";

describe("getPageTitleKey", () => {
  it("maps every application route to its title key", () => {
    expect(getPageTitleKey("/")).toBe("titleHomePage");
    expect(getPageTitleKey("/second")).toBe("titleSecondPage");
  });

  it("falls back to the application name for unknown paths", () => {
    expect(getPageTitleKey("/does-not-exist")).toBe(DEFAULT_PAGE_TITLE_KEY);
    expect(getPageTitleKey("")).toBe(DEFAULT_PAGE_TITLE_KEY);
  });
});
