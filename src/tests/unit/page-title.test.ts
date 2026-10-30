import { describe, expect, it } from "vitest";
import { DEFAULT_PAGE_TITLE_KEY, getPageTitleKey } from "@/utils/page-title";

describe("getPageTitleKey", () => {
  it("maps the known routes to their title keys", () => {
    expect(getPageTitleKey("/")).toBe("titleHomePage");
    expect(getPageTitleKey("/second")).toBe("titleSecondPage");
  });

  it("falls back to the application name for unknown paths", () => {
    expect(getPageTitleKey("/does-not-exist")).toBe(DEFAULT_PAGE_TITLE_KEY);
    expect(getPageTitleKey("")).toBe(DEFAULT_PAGE_TITLE_KEY);
    // Inherited Object.prototype members must not leak through the lookup.
    expect(getPageTitleKey("constructor")).toBe(DEFAULT_PAGE_TITLE_KEY);
    expect(getPageTitleKey("toString")).toBe(DEFAULT_PAGE_TITLE_KEY);
  });
});
