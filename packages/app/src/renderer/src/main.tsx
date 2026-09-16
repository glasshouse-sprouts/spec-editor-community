import React from "react";
import { createRoot } from "react-dom/client";

// Open Sans web fonts (FONT slice 2026-05-12). Each import drops a
// @font-face declaration into the document so styles.css can use
// `font-family: "Open Sans"` everywhere. We load only the four
// weights the app actually uses (regular + bold + their italics);
// adding more weights here would balloon the bundle. The same font
// family is registered with pdfmake (TTF flavour) in renderPdf.ts so
// editor and exported PDFs match exactly.
import "@fontsource/open-sans/latin-400.css";
import "@fontsource/open-sans/latin-400-italic.css";
import "@fontsource/open-sans/latin-700.css";
import "@fontsource/open-sans/latin-700-italic.css";

import { App } from "./App.js";
import "./styles.css";

// Community edition: the Glasshouse-only providers (reference content,
// version compare, custom cover) are not mounted, so each seam uses its
// Community no-op default.
const container = document.getElementById("root");
if (!container) throw new Error("#root not found");
createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
