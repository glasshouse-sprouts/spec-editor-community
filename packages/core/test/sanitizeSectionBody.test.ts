/**
 * Task 105 - the DOM-free sanitizer core runs on every body write.
 *
 * Three things are tested: what an attacker might write is gone, what
 * a user writes survives untouched, and running it twice changes
 * nothing. The renderer runs DOMPurify with the same allowlist; the
 * parity test in `packages/app/test/sectionBodyAllowlistParity.test.ts`
 * compares the two directly.
 */
import { describe, expect, it } from "vitest";

import { sanitizeSectionBody as clean } from "../src/sanitizeSectionBody.js";

const PNG = "data:image/png;base64,iVBORw0KGgo=";

describe("sanitizeSectionBody - hostile input is removed", () => {
  it.each([
    [
      "script with content",
      "<p>a</p><script>alert(1)</script><p>b</p>",
      "<p>a</p><p>b</p>",
    ],
    ["script, upper case", "<SCRIPT>alert(1)</SCRIPT>x", "x"],
    ["script with '<' inside", "<script>if (a<b) x()</script>ok", "ok"],
    ["unclosed script eats the rest", "ok<script>alert(1)", "ok"],
    ["style", "<style>p{color:red}</style><p>x</p>", "<p>x</p>"],
    ["iframe", '<iframe src="https://evil"></iframe>x', "x"],
    ["svg with onload", '<svg onload="alert(1)"><circle/></svg>x', "x"],
    ["svg with script inside", "<svg><script>alert(1)</script></svg>x", "x"],
    ["math", "<math><mi>x</mi></math>y", "y"],
    ["template", "<template><img src=x onerror=alert(1)></template>y", "y"],
    ["comment", "<p>a<!-- <script>alert(1)</script> --></p>", "<p>a</p>"],
    [
      "onerror on img",
      `<img src="${PNG}" onerror="alert(1)">`,
      `<img src="${PNG}">`,
    ],
    ["onclick on p", '<p onclick="alert(1)">x</p>', "<p>x</p>"],
    ["slash as separator", "<img/src=x/onerror=alert(1)>", "<img>"],
    ["javascript: href", '<a href="javascript:alert(1)">x</a>', "<a>x</a>"],
    [
      "javascript: with leading space",
      '<a href=" javascript:alert(1)">x</a>',
      "<a>x</a>",
    ],
    [
      "javascript: entity-encoded",
      '<a href="&#106;avascript:alert(1)">x</a>',
      "<a>x</a>",
    ],
    [
      "javascript: hex entity",
      '<a href="&#x6A;avascript:alert(1)">x</a>',
      "<a>x</a>",
    ],
    [
      "javascript&colon;",
      '<a href="javascript&colon;alert(1)">x</a>',
      "<a>x</a>",
    ],
    [
      "tab inside the scheme",
      '<a href="java\tscript:alert(1)">x</a>',
      "<a>x</a>",
    ],
    [
      "data:text/html href",
      '<a href="data:text/html,<script>">x</a>',
      "<a>x</a>",
    ],
    [
      "svg data URL in img",
      '<img src="data:image/svg+xml;base64,PHN2Zz4=">',
      "<img>",
    ],
    ["http img", '<img src="http://evil/x.png">', "<img>"],
    [
      "style attribute",
      '<p style="background:url(javascript:x)">x</p>',
      "<p>x</p>",
    ],
    ["unknown class", '<span class="evil">x</span>', "<span>x</span>"],
    ["class on wrong tag", '<p class="tc-red">x</p>', "<p>x</p>"],
    ["data-width on p", '<p data-width="10">x</p>', "<p>x</p>"],
    ["broken tag name", "<scr<script>ipt>alert(1)</script>", "ipt&gt;alert(1)"],
    ["stray <", "a < b", "a &lt; b"],
    ["object/embed", '<object data="x"></object><embed src="x">y', "y"],
    ["form and input", '<form action="x"><input value="y"></form>z', "z"],
    ["unknown wrapper keeps text", "<div><p>x</p></div>", "<p>x</p>"],
    [
      "textarea keeps text, as text",
      "<textarea><b>x</b></textarea>",
      "&lt;b&gt;x&lt;/b&gt;",
    ],
    ["EOF inside a tag", '<p>x</p><img src="a', "<p>x</p>"],
    ["doctype and PI", "<!DOCTYPE html><?xml x?><p>x</p>", "<p>x</p>"],
  ])("%s", (_name, input, expected) => {
    expect(clean(input)).toBe(expected);
  });

  it("writes a quote inside an unquoted value as &quot;", () => {
    expect(clean('<img alt=a"b>')).toBe('<img alt="a&quot;b">');
  });
});

describe("sanitizeSectionBody - user formatting survives unchanged", () => {
  it.each([
    "<p>Almindelig tekst med æ, ø og å &amp; et &lt;tegn&gt;.</p>",
    "<p><strong>fed</strong> <em>kursiv</em> <u>under</u> <s>gennem</s></p>",
    "<ul><li>en</li><li>to<ol><li>a</li></ol></li></ul>",
    "<ol><li>første</li></ol>",
    '<table><thead><tr><th data-width="120">H</th></tr></thead><tbody><tr><td data-width="80">c</td></tr></tbody></table>',
    '<p><mark class="bg-yellow">gul</mark> <span class="tc-red">rød</span></p>',
    '<p><a href="https://molio.dk/a?b=1&amp;c=2">link</a> <a href="mailto:x@y.dk">mail</a></p>',
    `<p><img src="${PNG}" width="320" alt="Detalje &aelig;"></p>`,
    "<p>linje<br>linje</p>",
    "<h2>Overskrift</h2><blockquote><p>citat</p></blockquote><pre>a\n  b</pre>",
    "<p><b>b</b> <i>i</i> H<sub>2</sub>O m<sup>2</sup></p>",
    "",
  ])("%j", (html) => {
    expect(clean(html)).toBe(html);
  });

  it("is idempotent on hostile input", () => {
    const nasty =
      '<p onclick="x">a<script>b</script><a href="javascript:c">d</a>' +
      "<svg><p>e</p></svg>f<!--g--><img src=x onerror=h> < i</p>";
    const once = clean(nasty);
    expect(clean(once)).toBe(once);
  });
});
