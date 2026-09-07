# file2md

Convert PDF, DOCX, XLSX, PPTX, HWP, and HWPX documents to Markdown in Node.js.
Use it to prepare documents for search, knowledge bases, or content pipelines.
One API returns Markdown, extracted image paths, cached chart data, and metadata.

**English** | [한국어](README.ko.md)

[npm](https://www.npmjs.com/package/file2md) · [Source](https://github.com/ricky-clevi/file2md) · [Report an issue](https://github.com/ricky-clevi/file2md/issues)

[Quick start](#quick-start) · [Examples](#examples) · [Supported formats](#supported-formats) · [Options](#options) · [Result](#result) · [Errors and resource limits](#errors-and-resource-limits)

## Installation

Requires **Node.js 20.9 or later**. Supports JavaScript and TypeScript through
ESM and CommonJS, with bundled type declarations. This is a Node.js library;
it does not include a CLI or browser build.

```sh
npm install file2md
```

## Quick start

Create `convert.mjs` beside a document named `report.docx`:

```js
import { writeFile } from 'node:fs/promises';
import { convert } from 'file2md';

const result = await convert('./report.docx', {
  imageDir: './images/report',
});

await writeFile('./report.md', result.markdown, 'utf8');
console.log(result.metadata);
```

Run it with `node convert.mjs`. This writes `report.md` in the current working
directory and saves supported embedded images under `images/report/`. Keep that
folder alongside the Markdown file so its image references continue to resolve.
Layout preservation, image extraction, and chart extraction are enabled by default
where the format supports them.

`convert(input, options?)` returns a `Promise<ConversionResult>`. Input can be a
local file path or a Node.js `Buffer`; the format is detected from the file contents.
The library does not download URLs or save Markdown automatically. The example
above handles saving with Node's `writeFile`.

## Examples

### Convert a Buffer

Useful when your application already has the document bytes:

```js
import { readFile } from 'node:fs/promises';
import { convert } from 'file2md';

const buffer = await readFile('./report.xlsx');
const result = await convert(buffer);
console.log(result.markdown);
```

### Convert content without saving images

```js
import { convert } from 'file2md';

const { markdown } = await convert('./report.docx', {
  preserveLayout: false,
  extractImages: false,
  extractCharts: false,
});

console.log(markdown);
```

This disables style enhancements and image/chart extraction. The output is still
Markdown, and tables retain their structure. No image directory is created.

### Use CommonJS and limit PDF pages

Save as a `.cjs` file or use it in a CommonJS project:

```js
const { convert } = require('file2md');

async function main() {
  const result = await convert('./report.pdf', { maxPages: 10 });
  console.log(result.markdown);
  console.log(result.metadata.pageCount);
}

main().catch(console.error);
```

`maxPages` applies only to PDF. It limits actual text extraction, rather than
truncating the metadata after reading all pages.

## Supported formats

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

Size and memory limits are in **bytes**; `timeout` is in **milliseconds**. For
example, `maxFileSize: 20 * 1024 * 1024` sets a 20 MiB input limit. Numeric limits
must be positive safe integers. PDF, HWP, and native image
processing load lazily, so importing the library does not initialize them.

## Result

```ts
import type { ImageData, ChartData, DocumentMetadata } from 'file2md';

interface ConversionResult {
  readonly markdown: string;
  readonly images: readonly ImageData[];
  readonly charts: readonly ChartData[];
  readonly metadata: DocumentMetadata;
}
```

Each image includes `originalPath`, an absolute filesystem `savedPath`, and,
where available, its format and byte size. Markdown image URLs are generated
separately from the configured image directory. Chart data includes its type, title, categories, and named numeric
series. Metadata includes `fileType`, `mimeType`, `pageCount`, `imageCount`,
`chartCount`, `processingTime`, and format-specific `additional` information.

`pageCount` means processed PDF pages, workbook sheets, or presentation slides.
For DOCX and HWP/HWPX it is `1`; the library does not paginate those formats.
HWP/HWPX section counts are available in `metadata.additional.sectionCount`.

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
process with operating-system limits. A failed conversion may leave
images already written before the error; use a per-document output directory.

## Upgrading from the previous implementation

Review these changes if your application depends on the previous output:

- **Runtime:** Node.js 20.9+ is required.
- **Images:** filenames now include a content hash. Use `result.images` instead of
  predicting filenames; custom image directories are respected across formats.
- **Markdown:** corrected block ordering, relationships, and text decoding can
  change generated output. `preserveLayout: false` disables supported styling.
- **PDF:** `maxPages` now limits extraction itself and reports only processed pages.

ESM and CommonJS share one implementation, including error/class identity.

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

### Publish from GitHub Actions

The workflow in [`.github/workflows/publish.yml`](https://github.com/ricky-clevi/file2md/blob/main/.github/workflows/publish.yml)
checks pushes to `main` and publishes when its tracked source/build files differ
from the latest Git tag, or when no tag exists.

1. Add an npm publishing credential as the repository Actions secret **`NPM_TOKEN`**.
   Checkout, version commits, tags, and GitHub releases use the built-in
   `GITHUB_TOKEN`; no separate `GH_TOKEN` secret is required.
2. Push the changes to `main`. The workflow installs dependencies, runs lint,
   type checking and tests, and builds the package.
3. If a release is needed, it increments the patch version in `package.json` and
   `package-lock.json`, publishes to npm, then records the version commit, tag,
   and GitHub release.

After correcting a missing credential, use **Re-run all jobs** on the failed
Actions run. Check that the **Publish package** step succeeded; a successful
build alone does not mean the version is available on npm.

README-only changes do not trigger a new npm version once the tracked files match
the latest tag. They appear on npm with the next package release. Pull requests
and other branches run CI without publishing.

### Local release commands

| Command | Behavior |
| --- | --- |
| `npm run release:dry` | Runs validation and previews the package without changing the version or publishing. |
| `npm run release` | Validates, checks npm authentication, increments the patch version in both manifests, then publishes. |
| `npm run release:retry` | Validates and publishes the current version without incrementing it; use only for an unpublished version. |

The release scripts increment **patch versions only**. For a breaking release,
choose the major version explicitly and account for the workflow's automatic
increment before publishing. Local release commands do not create Git commits,
tags, or GitHub releases; installing or building the package never publishes it.

## License

[MIT](LICENSE).
