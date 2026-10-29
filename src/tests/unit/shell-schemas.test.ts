import { describe, expect, it } from "vitest";
import { openExternalLinkInputSchema } from "@/ipc/shell/schemas";

describe("openExternalLinkInputSchema", () => {
  it.each(["https://example.com", "http://localhost:3000/path?x=1#y"])(
    "accepts %s",
    (url) => {
      expect(openExternalLinkInputSchema.parse({ url })).toEqual({ url });
    }
  );

  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "smb://server/share",
    "myapp://callback",
    "mailto:test@example.com",
    "//example.com",
    "not-a-url",
    "",
    "   ",
  ])("rejects %j", (url) => {
    expect(() => openExternalLinkInputSchema.parse({ url })).toThrow();
  });

  it("trims surrounding whitespace", () => {
    expect(
      openExternalLinkInputSchema.parse({ url: "  https://example.com  " })
    ).toEqual({ url: "https://example.com" });
  });

  it("rejects an over-long URL", () => {
    const url = `https://example.com/${"a".repeat(4096)}`;

    expect(() => openExternalLinkInputSchema.parse({ url })).toThrow();
  });

  it("reports the offending scheme", () => {
    const result = openExternalLinkInputSchema.safeParse({
      url: "javascript:alert(1)",
    });

    expect(result.success).toBe(false);

    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("javascript:");
    }
  });
});
