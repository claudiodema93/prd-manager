import { describe, expect, it } from "vitest";
import { parseKeyTemplate, renderKeyTemplate } from "@/customers/key-template";
import type { ParameterDefinitions } from "@/customers/types";

function getThrownError(callback: () => unknown): unknown {
  try {
    callback();
  } catch (error) {
    return error;
  }

  throw new Error("Expected the callback to throw.");
}

const articleParameters: ParameterDefinitions = {
  CODE: { required: true, type: "text" },
  EVO: { required: true, type: "number" },
};

const revisionParameters: ParameterDefinitions = {
  REV: { required: true, type: "number" },
};

const optionalParameters: ParameterDefinitions = {
  CODE: { required: true, type: "text" },
  EVO: { required: true, type: "number" },
  FLAG: { required: false, type: "bool" },
  TAG: { required: false, type: "text" },
};

const textParameters: ParameterDefinitions = {
  A: { required: true, type: "text" },
  B: { required: true, type: "text" },
  T: { required: true, type: "text" },
};

const numberParameters: ParameterDefinitions = {
  N: { required: true, type: "number" },
};

const boolParameters: ParameterDefinitions = {
  B: { required: true, type: "bool" },
  FLAG: { required: false, type: "bool" },
};

const optionalValueParameters: ParameterDefinitions = {
  FLAG: { required: false, type: "bool" },
  N: { required: false, type: "number" },
  TAG: { required: false, type: "text" },
};

describe("parseKeyTemplate", () => {
  it("parses the official article template and its references", () => {
    const parsed = parseKeyTemplate("{CODE}[_EVO{EVO:00}]", articleParameters);

    expect(parsed.hasPlaceholders).toBe(true);
    expect(parsed.referencedParameters).toEqual(["CODE", "EVO"]);
    expect(parsed.source).toBe("{CODE}[_EVO{EVO:00}]");
    expect(parsed.tokens).toHaveLength(2);
    expect(parsed.tokens[0]).toMatchObject({
      kind: "placeholder",
      name: "CODE",
      width: null,
    });
    expect(parsed.tokens[1]).toMatchObject({ kind: "optional" });
  });

  it("keeps first-appearance order for references inside optional groups", () => {
    const parsed = parseKeyTemplate("{A}[_{B}{A}]", textParameters);

    expect(parsed.referencedParameters).toEqual(["A", "B"]);
  });

  it("rejects an empty template", () => {
    expect(
      getThrownError(() => parseKeyTemplate("", textParameters))
    ).toMatchObject({ code: "KEY_TEMPLATE_INVALID" });
  });

  it("rejects templates longer than 512 characters", () => {
    const template = `${"x".repeat(512)}{T}`;

    expect(
      getThrownError(() => parseKeyTemplate(template, textParameters))
    ).toMatchObject({ code: "KEY_TEMPLATE_INVALID" });
  });

  it("rejects a template without any placeholder", () => {
    expect(
      getThrownError(() => parseKeyTemplate("ABC", textParameters))
    ).toMatchObject({ code: "KEY_TEMPLATE_INVALID" });
  });

  it("rejects an undeclared placeholder", () => {
    expect(
      getThrownError(() => parseKeyTemplate("{MISSING}", textParameters))
    ).toMatchObject({ code: "KEY_TEMPLATE_INVALID" });
  });

  it("rejects malformed placeholder names", () => {
    for (const template of ["{lower}", "{1ABC}", "{}"]) {
      expect(
        getThrownError(() => parseKeyTemplate(template, textParameters))
      ).toMatchObject({ code: "KEY_TEMPLATE_INVALID" });
    }
  });

  it("rejects zero padding on non-number parameters", () => {
    expect(
      getThrownError(() => parseKeyTemplate("{T:00}", textParameters))
    ).toMatchObject({ code: "KEY_TEMPLATE_INVALID" });

    expect(
      getThrownError(() => parseKeyTemplate("{B:00}", boolParameters))
    ).toMatchObject({ code: "KEY_TEMPLATE_INVALID" });
  });

  it("rejects unbalanced brackets and braces", () => {
    for (const template of ["A[B{T}", "A]", "{T", "A[T}}", "[{T}"]) {
      expect(
        getThrownError(() => parseKeyTemplate(template, textParameters))
      ).toMatchObject({ code: "KEY_TEMPLATE_INVALID" });
    }
  });

  it("rejects nested optional groups", () => {
    expect(
      getThrownError(() => parseKeyTemplate("[_{A}[_{B}]]", textParameters))
    ).toMatchObject({ code: "KEY_TEMPLATE_INVALID" });
  });

  it("rejects an empty optional group", () => {
    expect(
      getThrownError(() => parseKeyTemplate("A[]{T}", textParameters))
    ).toMatchObject({ code: "KEY_TEMPLATE_INVALID" });
  });

  it("rejects an optional group without a placeholder", () => {
    expect(
      getThrownError(() => parseKeyTemplate("A[abc]{T}", textParameters))
    ).toMatchObject({ code: "KEY_TEMPLATE_INVALID" });
  });

  it("rejects forbidden literal characters such as a colon", () => {
    for (const template of ["A:B{T}", "A/B{T}", "A\\B{T}", 'A"B{T}']) {
      expect(
        getThrownError(() => parseKeyTemplate(template, textParameters))
      ).toMatchObject({ code: "KEY_TEMPLATE_INVALID" });
    }
  });
});

describe("renderKeyTemplate", () => {
  it("renders the official article examples", () => {
    expect(
      renderKeyTemplate("{CODE}[_EVO{EVO:00}]", articleParameters, {
        CODE: "article-example-1",
        EVO: 0,
      })
    ).toBe("article-example-1");

    expect(
      renderKeyTemplate("{CODE}[_EVO{EVO:00}]", articleParameters, {
        CODE: "article-example-2",
        EVO: 1,
      })
    ).toBe("article-example-2_EVO01");
  });

  it("renders the official revision examples", () => {
    expect(renderKeyTemplate("REV_{REV}", revisionParameters, { REV: 0 })).toBe(
      "REV_0"
    );

    expect(renderKeyTemplate("REV_{REV}", revisionParameters, { REV: 1 })).toBe(
      "REV_1"
    );
  });

  it("applies zero padding widths of 1, 2 and 3", () => {
    expect(renderKeyTemplate("{N:0}", numberParameters, { N: 7 })).toBe("7");
    expect(renderKeyTemplate("{N:00}", numberParameters, { N: 7 })).toBe("07");
    expect(renderKeyTemplate("{N:000}", numberParameters, { N: 7 })).toBe(
      "007"
    );
  });

  it("does not truncate a value wider than its padding width", () => {
    expect(renderKeyTemplate("{N:00}", numberParameters, { N: 12_345 })).toBe(
      "12345"
    );
  });

  it("omits the optional group when its values are insignificant", () => {
    expect(
      renderKeyTemplate("{CODE}[_EVO{EVO:00}]", articleParameters, {
        CODE: "a",
        EVO: 0,
      })
    ).toBe("a");

    expect(
      renderKeyTemplate("A[_{TAG}]", optionalParameters, { TAG: "" })
    ).toBe("A");

    expect(
      renderKeyTemplate("A[_{TAG}]", optionalParameters, { TAG: "   " })
    ).toBe("A");

    expect(
      renderKeyTemplate("A[_{FLAG}]", optionalParameters, { FLAG: false })
    ).toBe("A");
  });

  it("includes the optional group when any value is significant", () => {
    expect(
      renderKeyTemplate("A[_{TAG}]", optionalParameters, { TAG: "x" })
    ).toBe("A_x");

    expect(
      renderKeyTemplate("A[_{FLAG}]", optionalParameters, { FLAG: true })
    ).toBe("A_true");

    expect(
      renderKeyTemplate("A[_{TAG}{FLAG}]", optionalParameters, {
        FLAG: true,
        TAG: "",
      })
    ).toBe("A_true");
  });

  it("renders multiple placeholders and literal text", () => {
    expect(
      renderKeyTemplate(
        "{A}-{N:000}",
        { A: textParameters.A, N: numberParameters.N },
        {
          A: "x",
          N: 2,
        }
      )
    ).toBe("x-002");
  });

  it("rejects a missing required parameter", () => {
    expect(
      getThrownError(() => renderKeyTemplate("{T}", textParameters, {}))
    ).toMatchObject({ code: "KEY_RENDER_INVALID" });

    expect(
      getThrownError(() =>
        renderKeyTemplate("{T}", textParameters, { T: "   " })
      )
    ).toMatchObject({ code: "KEY_RENDER_INVALID" });
  });

  it("accepts zero and false for required values", () => {
    expect(renderKeyTemplate("N{N}", numberParameters, { N: 0 })).toBe("N0");
    expect(renderKeyTemplate("{B}", boolParameters, { B: false })).toBe(
      "false"
    );
  });

  it("applies a default for undefined and null but not for an empty string", () => {
    const defaulted: ParameterDefinitions = {
      T: { default: "fallback", required: false, type: "text" },
    };

    expect(renderKeyTemplate("X{T}", defaulted, {})).toBe("Xfallback");
    expect(renderKeyTemplate("X{T}", defaulted, { T: null })).toBe("Xfallback");
    expect(renderKeyTemplate("X{T}", defaulted, { T: "" })).toBe("X");
  });

  it("applies a numeric default and canonicalises it", () => {
    const defaulted: ParameterDefinitions = {
      N: { default: "007", required: true, type: "number" },
    };

    expect(renderKeyTemplate("N{N}", defaulted, {})).toBe("N7");
  });

  it("rejects invalid numbers", () => {
    for (const value of [
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      "abc",
      "-1",
      "1.5",
      " 7",
    ]) {
      expect(
        getThrownError(() =>
          renderKeyTemplate("{N}", numberParameters, { N: value })
        )
      ).toMatchObject({ code: "KEY_RENDER_INVALID" });
    }
  });

  it("trims text values", () => {
    expect(renderKeyTemplate("{T}", textParameters, { T: "  hello  " })).toBe(
      "hello"
    );
  });

  it("rejects text values longer than 256 characters", () => {
    expect(
      getThrownError(() =>
        renderKeyTemplate("{T}", textParameters, { T: "a".repeat(257) })
      )
    ).toMatchObject({ code: "KEY_RENDER_INVALID" });
  });

  it("rejects a rendered key containing a path separator", () => {
    expect(
      getThrownError(() =>
        renderKeyTemplate("{T}", textParameters, { T: "a/b" })
      )
    ).toMatchObject({ code: "KEY_RENDER_INVALID" });
  });

  it('rejects a rendered key of "." or ".."', () => {
    for (const value of [".", ".."]) {
      expect(
        getThrownError(() =>
          renderKeyTemplate("{T}", textParameters, { T: value })
        )
      ).toMatchObject({ code: "KEY_RENDER_INVALID" });
    }
  });

  it("rejects a rendered key ending with a dot or a space", () => {
    expect(
      getThrownError(() =>
        renderKeyTemplate("{T}.", textParameters, { T: "x" })
      )
    ).toMatchObject({ code: "KEY_RENDER_INVALID" });

    expect(
      getThrownError(() =>
        renderKeyTemplate("{T} ", textParameters, { T: "x" })
      )
    ).toMatchObject({ code: "KEY_RENDER_INVALID" });
  });

  it("rejects Windows reserved device names", () => {
    for (const value of ["CON", "nul.txt", "COM1"]) {
      expect(
        getThrownError(() =>
          renderKeyTemplate("{T}", textParameters, { T: value })
        )
      ).toMatchObject({ code: "KEY_RENDER_INVALID" });
    }
  });

  it("rejects a rendered key longer than 255 UTF-8 bytes", () => {
    expect(
      getThrownError(() =>
        renderKeyTemplate("{A}{B}", textParameters, {
          A: "a".repeat(200),
          B: "b".repeat(200),
        })
      )
    ).toMatchObject({ code: "KEY_RENDER_INVALID" });
  });

  it("rejects a rendered key containing a control character", () => {
    expect(
      getThrownError(() =>
        renderKeyTemplate("{T}", textParameters, { T: "a\nb" })
      )
    ).toMatchObject({ code: "KEY_RENDER_INVALID" });
  });

  it("rejects reserved characters supplied as values", () => {
    for (const character of [":", "*", "?", '"', "<", ">", "|"]) {
      expect(
        getThrownError(() =>
          renderKeyTemplate("{T}", textParameters, { T: `a${character}b` })
        )
      ).toMatchObject({ code: "KEY_RENDER_INVALID" });
    }
  });

  it("rejects an optional-only template whose value is blank", () => {
    expect(
      getThrownError(() =>
        renderKeyTemplate("[{TAG}]", optionalValueParameters, { TAG: "" })
      )
    ).toMatchObject({ code: "KEY_RENDER_INVALID" });
  });

  it("accepts the string forms of a boolean value", () => {
    expect(renderKeyTemplate("{B}", boolParameters, { B: "TRUE" })).toBe(
      "true"
    );
    expect(renderKeyTemplate("{B}", boolParameters, { B: "1" })).toBe("true");
    expect(renderKeyTemplate("{B}", boolParameters, { B: "FALSE" })).toBe(
      "false"
    );
    expect(renderKeyTemplate("{B}", boolParameters, { B: "0" })).toBe("false");
  });

  it("renders blank optional number and bool values inside a significant group", () => {
    expect(
      renderKeyTemplate("[{TAG}{N}]", optionalValueParameters, { TAG: "x" })
    ).toBe("x0");
    expect(
      renderKeyTemplate("[{TAG}{FLAG}]", optionalValueParameters, { TAG: "x" })
    ).toBe("xfalse");
  });

  it("rejects literal control characters in the template", () => {
    for (const character of ["\u0001", "\u007f"]) {
      expect(
        getThrownError(() =>
          parseKeyTemplate(`A${character}{T}`, textParameters)
        )
      ).toMatchObject({ code: "KEY_TEMPLATE_INVALID" });
    }
  });

  it("accepts an exact 512-character template", () => {
    const template = `${"x".repeat(512 - "{T}".length)}{T}`;

    expect(template).toHaveLength(512);
    expect(parseKeyTemplate(template, textParameters).source).toHaveLength(512);
  });

  it("rejects malformed zero padding", () => {
    for (const template of ["{N:0a}", "{N:}"]) {
      expect(
        getThrownError(() => parseKeyTemplate(template, numberParameters))
      ).toMatchObject({ code: "KEY_TEMPLATE_INVALID" });
    }
  });
});
