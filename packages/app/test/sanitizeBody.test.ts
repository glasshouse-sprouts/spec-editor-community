/** @vitest-environment jsdom */

/**
 * Tests for the Molio HTML whitelist sanitizer.
 *
 * Uses jsdom (top-level pragma) so DOMPurify has a real `window`.
 */

import { describe, expect, it } from "vitest";

import {
  MOLIO_ALLOWED_TAGS,
  sanitizeBody,
} from "../src/renderer/src/sanitizeBody.js";

describe("sanitizeBody", () => {
  it("preserves empty input untouched", () => {
    expect(sanitizeBody("")).toBe("");
  });

  it("keeps every allowed tag", () => {
    // Browsers (and so jsdom + DOMPurify) enforce HTML parsing rules for
    // table-related tags: <thead>, <tbody>, <tfoot>, <tr>, <td>, <th> are
    // only valid inside a <table>. So we test table parts inside a table
    // wrapper, not as standalone fragments.
    const tableParts = new Set(["thead", "tbody", "tfoot", "tr", "td", "th"]);
    for (const tag of MOLIO_ALLOWED_TAGS) {
      let html: string;
      if (tag === "img") {
        // 6L.5a: src must be a whitelisted image data URL.
        html = '<img src="data:image/png;base64,iVBORw0KGgo=">';
      } else if (tag === "br") {
        html = "<br>";
      } else if (tag === "table") {
        html = "<table><tbody><tr><td>x</td></tr></tbody></table>";
      } else if (tableParts.has(tag)) {
        html = `<table><${tag === "tr" ? "tbody" : tag}><${tag === "tbody" || tag === "thead" || tag === "tfoot" ? "tr" : tag}>x</${tag === "tbody" || tag === "thead" || tag === "tfoot" ? "tr" : tag}></${tag === "tr" ? "tbody" : tag}></table>`;
        // Simpler path for the inner parts we need to check below:
        if (tag === "tr")
          html = "<table><tbody><tr><td>x</td></tr></tbody></table>";
        if (tag === "td")
          html = "<table><tbody><tr><td>x</td></tr></tbody></table>";
        if (tag === "th")
          html = "<table><thead><tr><th>x</th></tr></thead></table>";
        if (tag === "thead")
          html = "<table><thead><tr><th>x</th></tr></thead></table>";
        if (tag === "tbody")
          html = "<table><tbody><tr><td>x</td></tr></tbody></table>";
        if (tag === "tfoot")
          html = "<table><tfoot><tr><td>x</td></tr></tfoot></table>";
      } else {
        html = `<${tag}>x</${tag}>`;
      }
      const cleaned = sanitizeBody(html);
      expect(cleaned.toLowerCase()).toContain(`<${tag}`);
    }
  });

  it("strips <script> but keeps surrounding text", () => {
    const dirty = "<p>hello<script>alert(1)</script>world</p>";
    const cleaned = sanitizeBody(dirty);
    expect(cleaned).not.toContain("script");
    expect(cleaned).toContain("hello");
    expect(cleaned).toContain("world");
  });

  it("strips <div> but keeps inner text (KEEP_CONTENT)", () => {
    const cleaned = sanitizeBody("<div>Hello</div>");
    expect(cleaned).not.toContain("<div");
    expect(cleaned).toContain("Hello");
  });

  it("keeps <a href> for https links (6L.2)", () => {
    const cleaned = sanitizeBody('<a href="https://example.com">link</a>');
    expect(cleaned).toContain("<a");
    expect(cleaned).toContain('href="https://example.com"');
    expect(cleaned).toContain("link");
  });

  it("keeps <img> but strips event-handler attributes and non-data src", () => {
    // 6L.5a changed the src rule: plain http/https/file paths are now
    // rejected along with event handlers. `alt` is now allowed on <img>
    // (for accessibility + PDF export fallback), but `onerror` is still
    // stripped by DOMPurify's default rules.
    const cleaned = sanitizeBody(
      '<img src="photo.png" onerror="alert(1)" alt="x">',
    );
    expect(cleaned).toContain("<img");
    expect(cleaned).not.toContain('src="photo.png"'); // non-data src rejected
    expect(cleaned).not.toContain("onerror");
    expect(cleaned).toContain('alt="x"'); // alt now allowed
  });

  it("strips inline style attribute and disallowed class values", () => {
    // `style` is never allowed. `class="x"` on a <p> is also dropped
    // because class is only meaningful on <mark>/<span> with one of our
    // 8 whitelisted values.
    const cleaned = sanitizeBody('<p style="color:red" class="x">hi</p>');
    expect(cleaned).toContain("<p");
    expect(cleaned).not.toContain("style");
    expect(cleaned).not.toContain("class");
    expect(cleaned).toContain("hi");
  });

  it("drops <font> but keeps plain <span> (6L.1 allowed)", () => {
    const cleaned = sanitizeBody("<p><span>a</span><font>b</font></p>");
    // <span> is allowed since 6L.1 — colored-text marker. A span with
    // no class is visually a no-op and passes through unchanged.
    expect(cleaned).toContain("<span");
    expect(cleaned).not.toContain("<font");
    expect(cleaned).toContain("a");
    expect(cleaned).toContain("b");
  });

  describe("6L.1 highlight / text color / strikethrough extensions", () => {
    it('keeps <mark class="bg-yellow">', () => {
      const cleaned = sanitizeBody('<p><mark class="bg-yellow">x</mark></p>');
      expect(cleaned).toContain('<mark class="bg-yellow">');
      expect(cleaned).toContain("x");
    });

    it("accepts all four highlight classes", () => {
      for (const c of ["bg-yellow", "bg-blue", "bg-red", "bg-green"]) {
        const cleaned = sanitizeBody(`<mark class="${c}">x</mark>`);
        expect(cleaned).toContain(`class="${c}"`);
      }
    });

    it('keeps <span class="tc-red">', () => {
      const cleaned = sanitizeBody('<p><span class="tc-red">x</span></p>');
      expect(cleaned).toContain('<span class="tc-red">');
      expect(cleaned).toContain("x");
    });

    it("accepts all four text-color classes", () => {
      for (const c of ["tc-yellow", "tc-blue", "tc-red", "tc-green"]) {
        const cleaned = sanitizeBody(`<span class="${c}">x</span>`);
        expect(cleaned).toContain(`class="${c}"`);
      }
    });

    it("keeps <s> tag", () => {
      const cleaned = sanitizeBody("<p><s>deprecated</s></p>");
      expect(cleaned).toContain("<s>");
      expect(cleaned).toContain("deprecated");
    });

    it("keeps <u> tag (UL slice)", () => {
      // Underline survives sanitization end-to-end. Mirrors the <s>
      // test above; html-to-pdfmake handles <u> natively in PDF.
      const cleaned = sanitizeBody("<p><u>note</u></p>");
      expect(cleaned).toContain("<u>");
      expect(cleaned).toContain("note");
    });

    it("strips unknown class values on <mark>", () => {
      // Attacker tries to inject a CSS class that might collide with
      // something downstream — stripped.
      const cleaned = sanitizeBody('<mark class="evil-class">x</mark>');
      expect(cleaned).toContain("<mark");
      expect(cleaned).not.toContain("class");
      expect(cleaned).not.toContain("evil");
      expect(cleaned).toContain("x");
    });

    it("strips class on a tag that isn't <mark>/<span>", () => {
      // Even a whitelisted-looking value like "bg-yellow" on a <p>
      // is dropped — the value is only meaningful on <mark>.
      const cleaned = sanitizeBody('<p class="bg-yellow">x</p>');
      expect(cleaned).toContain("<p");
      expect(cleaned).not.toContain("class");
      expect(cleaned).toContain("x");
    });

    it("mixes text color inside strong — marks stack", () => {
      const cleaned = sanitizeBody(
        '<p><strong><span class="tc-red">HOT</span></strong></p>',
      );
      expect(cleaned).toContain("<strong>");
      expect(cleaned).toContain('<span class="tc-red">');
      expect(cleaned).toContain("HOT");
    });
  });

  describe("6L.4 table column-width persistence (data-width)", () => {
    it("keeps data-width on a <td>", () => {
      const cleaned = sanitizeBody(
        '<table><tbody><tr><td data-width="120">x</td></tr></tbody></table>',
      );
      expect(cleaned).toContain('data-width="120"');
      expect(cleaned).toContain("x");
    });

    it("keeps data-width on a <th>", () => {
      const cleaned = sanitizeBody(
        '<table><thead><tr><th data-width="80">h</th></tr></thead></table>',
      );
      expect(cleaned).toContain('data-width="80"');
    });

    it("strips data-width on non-cell tags", () => {
      const cleaned = sanitizeBody('<p data-width="120">x</p>');
      expect(cleaned).not.toContain("data-width");
      expect(cleaned).toContain("x");
    });

    it("strips malformed data-width values (non-digits)", () => {
      const cleaned = sanitizeBody(
        '<table><tbody><tr><td data-width="100px">x</td></tr></tbody></table>',
      );
      // "100px" isn't digits-only → stripped.
      expect(cleaned).not.toContain("data-width");
      expect(cleaned).toContain("x");
    });

    it("strips attempt to smuggle javascript: via data-width", () => {
      const cleaned = sanitizeBody(
        '<table><tbody><tr><td data-width="javascript:alert(1)">x</td></tr></tbody></table>',
      );
      expect(cleaned).not.toContain("data-width");
      expect(cleaned).not.toContain("javascript");
    });

    it("rejects arbitrary data-* attributes (data-foo)", () => {
      const cleaned = sanitizeBody(
        '<table><tbody><tr><td data-foo="bar">x</td></tr></tbody></table>',
      );
      expect(cleaned).not.toContain("data-foo");
      expect(cleaned).toContain("x");
    });
  });

  it("keeps a full table structure", () => {
    const dirty =
      "<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>D</td></tr></tbody></table>";
    const cleaned = sanitizeBody(dirty);
    expect(cleaned).toContain("<table");
    expect(cleaned).toContain("<thead");
    expect(cleaned).toContain("<tbody");
    expect(cleaned).toContain("<th");
    expect(cleaned).toContain("<td");
    expect(cleaned).toContain("H");
    expect(cleaned).toContain("D");
  });

  it("keeps bold/italic markup inside a paragraph", () => {
    const cleaned = sanitizeBody(
      "<p>Molio <em>S340.02.01</em> <strong>basis</strong></p>",
    );
    expect(cleaned).toContain("<em>S340.02.01</em>");
    expect(cleaned).toContain("<strong>basis</strong>");
  });

  it("is idempotent", () => {
    const dirty = '<p style="color:red"><span>x</span></p>';
    const a = sanitizeBody(dirty);
    const b = sanitizeBody(a);
    expect(a).toBe(b);
  });

  describe("6L.5a inline image rules", () => {
    const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgo=";

    it("keeps <img> with a data:image/png URL", () => {
      const cleaned = sanitizeBody(`<img src="${PNG_DATA_URL}">`);
      expect(cleaned).toContain("<img");
      expect(cleaned).toContain(`src="${PNG_DATA_URL}"`);
    });

    it("accepts all four whitelisted image data-URL types", () => {
      for (const mime of [
        "image/png",
        "image/jpeg",
        "image/gif",
        "image/webp",
      ]) {
        const url = `data:${mime};base64,AAAA`;
        const cleaned = sanitizeBody(`<img src="${url}">`);
        expect(cleaned).toContain(`src="${url}"`);
      }
    });

    it("strips src when it's http(s)://", () => {
      const cleaned = sanitizeBody('<img src="https://example.com/a.png">');
      expect(cleaned).toContain("<img"); // tag survives (empty)
      expect(cleaned).not.toContain("src=");
      expect(cleaned).not.toContain("example.com");
    });

    it("strips src when it's file://", () => {
      const cleaned = sanitizeBody('<img src="file:///etc/passwd">');
      expect(cleaned).not.toContain("src=");
      expect(cleaned).not.toContain("passwd");
    });

    it("strips src when it's javascript:", () => {
      const cleaned = sanitizeBody('<img src="javascript:alert(1)">');
      expect(cleaned).not.toContain("src=");
      expect(cleaned).not.toContain("javascript");
    });

    it("strips src when it's data:image/svg+xml (XSS risk)", () => {
      // SVG is scriptable XML. Must never pass through.
      const cleaned = sanitizeBody(
        '<img src="data:image/svg+xml;base64,AAAA">',
      );
      expect(cleaned).not.toContain("src=");
      expect(cleaned).not.toContain("svg");
    });

    it("strips src when it's a non-image data URL", () => {
      const cleaned = sanitizeBody('<img src="data:text/html;base64,AAAA">');
      expect(cleaned).not.toContain("src=");
      expect(cleaned).not.toContain("text/html");
    });

    it("keeps alt text on <img>", () => {
      const cleaned = sanitizeBody(
        `<img src="${PNG_DATA_URL}" alt="floor plan">`,
      );
      expect(cleaned).toContain('alt="floor plan"');
    });

    it("keeps empty alt (alt='')", () => {
      // Screen readers treat empty alt as decorative — valid and meaningful.
      const cleaned = sanitizeBody(`<img src="${PNG_DATA_URL}" alt="">`);
      expect(cleaned).toContain("alt=");
    });

    it("strips alt on non-img tags", () => {
      const cleaned = sanitizeBody('<p alt="floor plan">text</p>');
      expect(cleaned).not.toContain("alt=");
      expect(cleaned).toContain("text");
    });

    it("keeps width (integer) on <img>", () => {
      const cleaned = sanitizeBody(`<img src="${PNG_DATA_URL}" width="480">`);
      expect(cleaned).toContain('width="480"');
    });

    it("strips width with non-digit values (100px, auto, 50%)", () => {
      for (const bad of ["100px", "auto", "50%", "-100", "0.5"]) {
        const cleaned = sanitizeBody(
          `<img src="${PNG_DATA_URL}" width="${bad}">`,
        );
        expect(cleaned).not.toContain('width="');
      }
    });

    it("strips width on non-img tags", () => {
      const cleaned = sanitizeBody('<p width="100">x</p>');
      expect(cleaned).not.toContain("width=");
      expect(cleaned).toContain("x");
    });

    it("rejects height — aspect is reconstructed at render time", () => {
      const cleaned = sanitizeBody(
        `<img src="${PNG_DATA_URL}" width="400" height="300">`,
      );
      expect(cleaned).toContain('width="400"');
      expect(cleaned).not.toContain("height=");
    });

    it("keeps src + width + alt together on a valid <img>", () => {
      const cleaned = sanitizeBody(
        `<img src="${PNG_DATA_URL}" width="480" alt="diagram">`,
      );
      expect(cleaned).toContain('src="');
      expect(cleaned).toContain('width="480"');
      expect(cleaned).toContain('alt="diagram"');
    });

    it("still strips event-handler attributes on <img>", () => {
      const cleaned = sanitizeBody(
        `<img src="${PNG_DATA_URL}" onerror="alert(1)" onload="x()">`,
      );
      expect(cleaned).toContain("<img");
      expect(cleaned).not.toContain("onerror");
      expect(cleaned).not.toContain("onload");
    });

    it("is idempotent with an inline image", () => {
      const dirty = `<p>before <img src="${PNG_DATA_URL}" width="480" alt="x"> after</p>`;
      const a = sanitizeBody(dirty);
      const b = sanitizeBody(a);
      expect(a).toBe(b);
    });
  });

  describe("6L.2 external URL link extension (<a href>)", () => {
    it("keeps http:// href", () => {
      const cleaned = sanitizeBody('<a href="http://example.com">x</a>');
      expect(cleaned).toContain('href="http://example.com"');
    });

    it("keeps https:// href", () => {
      const cleaned = sanitizeBody(
        '<a href="https://example.com/path?q=1">x</a>',
      );
      expect(cleaned).toContain('href="https://example.com/path?q=1"');
    });

    it("keeps mailto: href", () => {
      const cleaned = sanitizeBody('<a href="mailto:foo@bar.dk">mail</a>');
      expect(cleaned).toContain('href="mailto:foo@bar.dk"');
      expect(cleaned).toContain("mail");
    });

    it("strips javascript: href but keeps the <a> tag and text", () => {
      const cleaned = sanitizeBody('<a href="javascript:alert(1)">click</a>');
      expect(cleaned).toContain("<a");
      expect(cleaned).not.toContain("href");
      expect(cleaned).not.toContain("javascript");
      expect(cleaned).toContain("click");
    });

    it("strips data: href (avoids smuggling HTML documents)", () => {
      const cleaned = sanitizeBody(
        '<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>',
      );
      expect(cleaned).not.toContain("href");
      expect(cleaned).not.toContain("data:");
    });

    it("strips file: href", () => {
      const cleaned = sanitizeBody('<a href="file:///etc/passwd">x</a>');
      expect(cleaned).not.toContain("href");
    });

    it("strips vbscript: href", () => {
      const cleaned = sanitizeBody('<a href="vbscript:msgbox">x</a>');
      expect(cleaned).not.toContain("href");
    });

    it("strips relative href (no scheme)", () => {
      // We require an absolute scheme — relative paths make no sense in
      // a construction spec anyway, and allowing them would make the
      // whitelist semantics fuzzier.
      const cleaned = sanitizeBody('<a href="/page">x</a>');
      expect(cleaned).not.toContain("href");
    });

    it("strips href on a tag that isn't <a>", () => {
      // Defense in depth — <p> wouldn't normally carry href, but if it
      // did, we'd drop it.
      const cleaned = sanitizeBody('<p href="https://example.com">x</p>');
      expect(cleaned).toContain("<p");
      expect(cleaned).not.toContain("href");
    });

    it("strips leading-whitespace obfuscation of scheme", () => {
      // Classic XSS trick: prepend tabs/newlines/nulls to sneak past
      // naive regexes. Browsers ignore leading whitespace in href.
      const cleaned = sanitizeBody('<a href="  javascript:alert(1)">click</a>');
      expect(cleaned).not.toContain("href");
      expect(cleaned).not.toContain("javascript");
    });

    it("strips tab-and-newline obfuscation of scheme", () => {
      const cleaned = sanitizeBody(
        '<a href="\t\n javascript:alert(1)">click</a>',
      );
      expect(cleaned).not.toContain("href");
    });

    it("is case-insensitive on scheme name", () => {
      const cleaned = sanitizeBody('<a href="HTTPS://example.com">x</a>');
      expect(cleaned).toContain("href");
    });

    it("rejects HTTPS-lookalike without colon", () => {
      // 'https' as a plain string (no colon) is not a scheme and must
      // be rejected. The regex anchors on the literal colon.
      const cleaned = sanitizeBody('<a href="https-not-a-url">x</a>');
      expect(cleaned).not.toContain("href");
    });

    it("strips target, rel, onclick and other <a> attributes", () => {
      // Only href passes the attribute whitelist.
      const cleaned = sanitizeBody(
        '<a href="https://example.com" target="_blank" rel="noopener" onclick="alert(1)">x</a>',
      );
      expect(cleaned).toContain('href="https://example.com"');
      expect(cleaned).not.toContain("target");
      expect(cleaned).not.toContain("rel=");
      expect(cleaned).not.toContain("onclick");
    });

    it("keeps link text intact when href is stripped", () => {
      // If the user pastes a link with a bad scheme, we want them to
      // still see the text — not lose data silently.
      const cleaned = sanitizeBody(
        '<p>see <a href="javascript:bad()">here</a></p>',
      );
      expect(cleaned).toContain("<p");
      expect(cleaned).toContain("see");
      expect(cleaned).toContain("here");
      expect(cleaned).not.toContain("javascript");
    });

    it("is idempotent with links", () => {
      const dirty =
        '<p>See <a href="https://example.com">here</a> or mail <a href="mailto:x@y.dk">us</a>.</p>';
      const a = sanitizeBody(dirty);
      const b = sanitizeBody(a);
      expect(a).toBe(b);
    });
  });
});
