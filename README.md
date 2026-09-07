# file2md

Convert PDF, DOCX, XLSX, PPTX, HWP, and HWPX documents to Markdown in Node.js.
Returns Markdown, extracted image paths, chart data, and processing metadata.

**English** | [한국어](README.ko.md)

## Installation

Requires **Node.js 20.9 or later**.

```sh
npm install file2md
```

## Usage

```ts
import { convert } from 'file2md';

const result = await convert('./report.docx', {
  imageDir: './report-images',
  preserveLayout: true,
  extractImages: true,
  extractCharts: true,
});

console.log(result.markdown);
console.log(result.images);
console.log(result.metadata);
```

CommonJS is also supported:

```js
const { convert } = require('file2md');

async function main() {
  const result = await convert('./report.pdf', { maxPages: 10 });
  console.log(result.markdown);
}
main().catch(console.error);
```

`convert()` accepts a local file path or a Node.js `Buffer`. It detects the format
from the contents, not the extension. It does not download URLs or write a
Markdown file. Save `result.markdown` yourself if needed.

## Options

| Option | Default | Behavior |
| --- | --- | --- |
| `imageDir` | `images` | Directory for extracted images, relative to the working directory or absolute. |
| `outputDir` | `imageDir` | Overrides the image directory for every format. Does not generate slide screenshots. |
| `preserveLayout` | `true` | Enables supported text styling and PDF layout heuristics. Tables remain structured when false. |
| `extractImages` | `true` | Saves embedded images for DOCX, PPTX, HWP, and HWPX. |
| `extractCharts` | `true` | Extracts cached Office chart data; DOCX/XLSX append charts and PPTX places referenced charts on their slides. |
| `maxPages` | All pages | Limits both PDF text extraction and the returned page count. |
| `maxFileSize` | 100 MiB | Maximum input size, enforced before and during file reads. |
| `maxMemoryUsage` | 500 MiB | Process heap budget; external memory is limited to half this value and RSS to 1.5 times it. |
| `timeout` | 60,000 ms | Processing deadline. See resource limits below. |
| `maxExtractedFiles` | 1,000 | Maximum ZIP entries, including directories. |
| `maxExtractedSize` | 500 MiB | Maximum total uncompressed archive size. |
| `maxIndividualFileSize` | 50 MiB for ZIP; 10 MiB for XML | Overrides both limits when supplied. |
| `enablePathValidation` | `true` | Checks original ZIP entry names for traversal, absolute paths, and reserved names. |
| `enableXXEProtection` | `true` | Compatibility option. DTDs and external entities remain prohibited even when false. |

Numeric limits must be positive safe integers. PDF, HWP, and native image
processing load lazily, so importing the library does not initialize them.

## Result

```ts
interface ConversionResult {
  readonly markdown: string;
  readonly images: readonly ImageData[];
  readonly charts: readonly ChartData[];
  readonly metadata: DocumentMetadata;
}
```

Each image includes `originalPath`, `savedPath`, and, where available, its format
and byte size. Chart data includes its type, title, categories, and named numeric
series. Metadata includes `fileType`, `mimeType`, `pageCount`, `imageCount`,
`chartCount`, `processingTime`, and format-specific `additional` information.

`pageCount` means processed PDF pages, workbook sheets, or presentation slides.
For DOCX and HWP/HWPX it is `1`; the library does not paginate those formats.
HWP/HWPX section counts are available in `metadata.additional.sectionCount`.

## Format behavior

| Format | Implementation and limits |
| --- | --- |
| PDF | PDF.js through `unpdf`, with optional heading/list/table heuristics. No OCR or image extraction. |
| DOCX | Paragraph/table order, run formatting, headings, lists, hyperlinks, images, and cached charts. Does not reproduce Word page layout or every inherited style. |
| XLSX | Workbook relationship order, shared/inline strings, booleans, cached formula values, common dates/percentages, cell styling, and charts. Does not evaluate formulas or reproduce every Excel number format. Empty row gaps are compacted. |
| PPTX | Presentation relationship order, grouped text, tables, images, and charts. Produces document content, not screenshots or pixel-perfect slide layouts. |
| HWP | Uses the `hwp.js` data parser without a browser/DOM. Extracts text and embedded images from supported HWP 5 documents. Binary tables are flattened; encrypted/unsupported variants may fail. |
| HWPX | Ordered XML sections, paragraphs, tables, and manifest/relationship image references. Preserves short and numeric text. |

Markdown cannot represent all merged-cell, positioning, font, and drawing
features. Table spans are approximated with empty grid cells. Scanned PDFs need
an OCR tool before conversion.

## Images and output paths

Image directories are created only when an image is actually saved. Filenames
include a content hash to prevent collisions across documents and concurrent
conversions. Existing output files are never silently overwritten.

PNG, JPEG, GIF, SVG, WebP, and other supported embedded formats keep their bytes.
TIFF and AVIF are converted to PNG using Sharp. BMP, WMF, and EMF retain their
original extensions and may require another tool for browser display. Images are
never falsely relabeled as PNG.

Markdown references use the configured output directory. If you save the Markdown
elsewhere, choose a directory/reference scheme appropriate to its final location.
Embedded SVG files are extracted as supplied; they are not sanitized for inline
HTML use. Treat document content and extracted assets as untrusted when serving
or rendering them.

## Errors and resource limits

```ts
import { convert, ConversionError, SecurityError } from 'file2md';

try {
  await convert('./report.docx');
} catch (error) {
  if (error instanceof SecurityError) {
    console.error(error.securityCode);
  } else if (error instanceof ConversionError) {
    console.error(error.code, error.message);
  } else {
    throw error;
  }
}
```

All error classes are available as runtime exports, including `ParseError`,
`InvalidFileError`, `UnsupportedFormatError`, `FileNotFoundError`, and
`ResourceLimitError`. Internal failures are retained in `originalError`; do not
expose that field directly in public error responses.

Archives are checked before extraction, with bounded streaming during reads.
The default maximum ZIP compression ratio is 100:1. XML parsing accepts ordinary
namespaces and escaped characters, rejects DTDs/external entities, and limits
nesting to 128 levels. Table/spreadsheet grids and chart point expansion are also
bounded to prevent tiny inputs from creating enormous outputs. No document
relationship is fetched over the network.

Memory checks observe the whole Node.js process, not an isolated conversion.
Deadlines reject asynchronous work and are checked throughout parsing; JavaScript
cannot interrupt a synchronous parser or native operation already executing.
For a hard CPU/memory boundary around hostile files, run conversion in a separate
worker or process with operating-system limits. A failed conversion may leave
images already written before the error; use a per-document output directory.

## Changes from the previous implementation

- Minimum Node version is now 20.9, required by the patched Sharp dependency.
- ESM and CommonJS entry points share one implementation and TypeScript declarations.
- PDF extraction uses `unpdf` instead of `pdf-parse` and respects page limits.
- One ordered SAX-based XML reader replaces overlapping XML parsers.
- Removed JSDOM, browser polyfills, fixed render delays, and unused visual parsing.
- Corrected ZIP/XML validation that rejected normal Office documents.
- Image paths honor custom directories and filenames no longer collide.
- `preserveLayout: false` disables supported style enhancements.

These changes affect the Node support range, Markdown formatting, and generated
image filenames. Consumers relying on the previous output should review those
changes before upgrading.

## Development and publishing

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

The build generates an ESM entry point in `dist/` and a shared CommonJS implementation
in `dist/cjs/`. Both entry points share error/class identity. Runtime dependencies
are external; source files, test fixtures, and source maps are not shipped.

`npm run release:dry` validates and previews the package contents locally without changing the
version. `npm run release` validates, checks npm authentication, increments the
patch version in both manifests, and publishes. `npm run release:retry` skips
incrementing the version. Select an appropriate major/minor version manually
before publishing breaking changes; the scripts only increment patches.

The `main` workflow publishes after validation and records the published version
and tag. Pull requests and other branches run CI without publishing. Publishing
requires repository npm/GitHub credentials; those workflows do not run merely
from installing or building the package locally.

MIT license.
