import { describe, expect, it } from "vitest";
import { isDevicePath } from "@/utils/path-safety";

describe("isDevicePath", () => {
  it("detects Win32 device paths with either separator", () => {
    for (const value of [
      "\\\\?\\C:\\dir",
      "//?/C:/dir",
      "\\\\.\\pipe\\name",
      "//./pipe/name",
    ]) {
      expect(isDevicePath(value)).toBe(true);
    }
  });

  it("allows network shares and regular paths", () => {
    for (const value of [
      "\\\\server\\share",
      "//server/share",
      "/tmp/articles",
      "C:\\Users\\me",
      "relative/path",
    ]) {
      expect(isDevicePath(value)).toBe(false);
    }
  });
});
