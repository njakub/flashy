import { describe, it, expect } from "vitest";
import { stripHtml, extractSource } from "./extractText";

describe("stripHtml", () => {
  it("strips tags but keeps their text", () => {
    expect(stripHtml("<p>Closures <em>capture</em> scope.</p>")).toBe(
      "Closures capture scope.",
    );
  });

  it("drops script/style/noscript content entirely", () => {
    const html = `
      <style>body { color: red; }</style>
      <script type="module">console.log("evil");</script>
      <noscript>Enable JS</noscript>
      <p>Real content</p>`;
    expect(stripHtml(html)).toBe("Real content");
  });

  it("drops HTML comments", () => {
    expect(stripHtml("<p>before<!-- hidden -->after</p>")).toBe("beforeafter");
  });

  it("turns block boundaries into newlines", () => {
    const html =
      "<h1>Title</h1><p>First para</p><ul><li>one</li><li>two</li></ul>";
    expect(stripHtml(html)).toBe("Title\nFirst para\none\ntwo");
  });

  it("treats <br> as a newline", () => {
    expect(stripHtml("line one<br>line two<br />line three")).toBe(
      "line one\nline two\nline three",
    );
  });

  it("decodes named and numeric entities", () => {
    expect(stripHtml("a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39; &#x41;")).toBe(
      "a & b <c> \"d\" 'e' A",
    );
  });

  it("collapses nbsp and whitespace runs", () => {
    expect(stripHtml("<p>a&nbsp;&nbsp;b    c</p>\n\n\n\n<p>d</p>")).toBe(
      "a b c\n\nd",
    );
  });

  it("leaves unknown entities untouched", () => {
    expect(stripHtml("&bogus; stays")).toBe("&bogus; stays");
  });
});

describe("extractSource", () => {
  it("strips .html and .htm files", () => {
    expect(extractSource("doc.html", "<p>hi</p>")).toBe("hi");
    expect(extractSource("DOC.HTM", "<p>hi</p>")).toBe("hi");
  });

  it("passes .txt and .md through trimmed", () => {
    expect(extractSource("notes.txt", "  plain text \n")).toBe("plain text");
    expect(extractSource("readme.md", "# Heading\n\nBody <p>not html</p>")).toBe(
      "# Heading\n\nBody <p>not html</p>",
    );
  });
});
