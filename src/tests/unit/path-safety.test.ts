import { describe, expect, it } from "vitest";
import { isUncOrDevicePath } from "@/utils/path-safety";

describe("isUncOrDevicePath", () => {
  it("detects UNC and device paths with either separator", () => {
    for (const value of [
      "\\\\server\\share",
      "//server/share",
      "\\\\?\\C:\\dir",
      "//?/C:/dir",
      "\\\\.\\pipe\\name",
      "//./pipe/name",
    ]) {
      expect(isUncOrDevicePath(value)).toBe(true);
    }
  });

  it("accepts POSIX and drive-letter paths", () => {
    for (const value of ["/tmp/articles", "C:\\Users\\me", "relative/path"]) {
      expect(isUncOrDevicePath(value)).toBe(false);
    }
  });
});
