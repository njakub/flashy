import { describe, expect, it } from "vitest";
import {
  hasCodeFence,
  isCodeOnly,
  normalizeCode,
  previewText,
  speakableText,
  splitFences,
} from "./markdown";

describe("hasCodeFence", () => {
  it("is false for plain prose", () => {
    expect(hasCodeFence("just some text")).toBe(false);
  });

  it("is true when a fenced block is present", () => {
    expect(hasCodeFence("before\n```js\nconst x = 1;\n```\nafter")).toBe(true);
  });

  it("is false for a single stray backtick or inline code", () => {
    expect(hasCodeFence("use `foo()` here")).toBe(false);
  });
});

describe("splitFences", () => {
  it("returns a single prose segment for plain text", () => {
    expect(splitFences("hello world")).toEqual([
      { kind: "prose", text: "hello world" },
    ]);
  });

  it("splits prose/code/prose in source order", () => {
    const segments = splitFences("before\n```js\nconst x = 1;\n```\nafter");
    expect(segments).toEqual([
      { kind: "prose", text: "before\n" },
      { kind: "code", text: "const x = 1;", lang: "js" },
      { kind: "prose", text: "\nafter" },
    ]);
  });

  it("lowercases the language and omits lang when the fence has none", () => {
    const segments = splitFences("```PYTHON\nx = 1\n```\n```\nplain\n```");
    expect(segments[0]).toEqual({ kind: "code", text: "x = 1", lang: "python" });
    expect(segments[2]).toEqual({ kind: "code", text: "plain", lang: undefined });
  });

  it("handles multiple fenced blocks with no prose between them", () => {
    const segments = splitFences("```js\na\n```\n```py\nb\n```");
    expect(segments.map((s) => s.kind)).toEqual(["code", "prose", "code"]);
  });

  it("a card that is only a code block yields a single code segment", () => {
    expect(splitFences("```js\nconst x = 1;\n```")).toEqual([
      { kind: "code", text: "const x = 1;", lang: "js" },
    ]);
  });
});

describe("speakableText", () => {
  it("passes prose through unchanged apart from backtick stripping", () => {
    expect(speakableText("hello world")).toBe("hello world");
  });

  it("replaces a fenced code block with a spoken placeholder", () => {
    expect(speakableText("before\n```js\nconst x = 1;\n```\nafter")).toBe(
      "before code block omitted after",
    );
  });

  it("strips inline backticks from prose", () => {
    expect(speakableText("call `foo()` to start")).toBe("call foo() to start");
  });
});

describe("isCodeOnly", () => {
  it("is false for plain prose", () => {
    expect(isCodeOnly("just some text")).toBe(false);
  });

  it("is true when the entire card is a single code fence", () => {
    expect(isCodeOnly("```js\nconst x = 1;\n```")).toBe(true);
  });

  it("is true when only whitespace surrounds the fence", () => {
    expect(isCodeOnly("  \n```js\nconst x = 1;\n```\n  ")).toBe(true);
  });

  it("is false when real prose accompanies the fence", () => {
    expect(isCodeOnly("Explain:\n```js\nconst x = 1;\n```")).toBe(false);
  });
});

describe("previewText", () => {
  it("passes plain prose through unchanged", () => {
    expect(previewText("just some text")).toBe("just some text");
  });

  it("collapses a fenced code block to a [code] marker", () => {
    expect(previewText("before\n```js\nconst x = 1;\n```\nafter")).toBe(
      "before [code] after",
    );
  });

  it("a card that is only code previews as just [code]", () => {
    expect(previewText("```py\nprint(1)\n```")).toBe("[code]");
  });
});

describe("normalizeCode", () => {
  it("collapses whitespace and trims", () => {
    expect(normalizeCode("  const   x   =   1;  ")).toBe("const x = 1;");
  });

  it("strips // line comments", () => {
    expect(normalizeCode("const x = 1; // set x\nconst y = 2;")).toBe(
      "const x = 1; const y = 2;",
    );
  });

  it("strips /* */ block comments", () => {
    expect(normalizeCode("const x = 1; /* note */ const y = 2;")).toBe(
      "const x = 1; const y = 2;",
    );
  });

  it("treats a for-loop and a while-loop as different after normalization (no semantic equivalence)", () => {
    expect(normalizeCode("for (;;) {}")).not.toBe(normalizeCode("while (true) {}"));
  });

  it("treats whitespace-only variants as equal", () => {
    const a = normalizeCode("def f():\n    return 1");
    const b = normalizeCode("def f(): return 1");
    expect(a).toBe(b);
  });
});
