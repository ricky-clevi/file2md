import path from 'node:path';
import { stat } from 'node:fs/promises';
import type { ImageExtractor } from '../utils/image-extractor.js';
import type { ChartExtractor } from '../utils/chart-extractor.js';
import {
  ConversionError,
  InvalidFileError,
  ParseError
} from '../types/errors.js';
import type {
  ImageData,
  ChartData,
  ConvertOptions,
  CellData
} from '../types/interfaces.js';
import { loadArchive, type Archive } from '../utils/zip-security.js';
import {
  readXml,
  relationships,
  child,
  children,
  text,
  attr,
  localName,
  type XmlNode
} from '../utils/xml.js';
import { escapeMarkdown } from '../utils/markdown.js';
import { LayoutParser } from '../utils/layout-parser.js';
import { checkResources } from '../utils/resource-monitor.js';

export interface HwpParseOptions {
  readonly preserveLayout?: boolean;
  readonly extractImages?: boolean;
  readonly extractCharts?: boolean;
  readonly options?: ConvertOptions;
}
export interface HwpParseResult {
  readonly markdown: string;
  readonly images: readonly ImageData[];
  readonly charts: readonly ChartData[];
  readonly metadata: Record<string, unknown>;
}
const cfbSignature = Buffer.from([
  0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1
]);

export async function parseHwp(
  buffer: Buffer,
  images: ImageExtractor,
  _charts: ChartExtractor,
  options: HwpParseOptions = {},
  archive?: Archive
): Promise<HwpParseResult> {
  try {
    if (buffer.subarray(0, 8).equals(cfbSignature))
      return await parseBinary(buffer, images, options);
    if (buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 3, 4])))
      return await parseHwpx(buffer, images, options, archive);
    throw new ParseError('HWP', 'Unsupported HWP format variant');
  } catch (error) {
    if (error instanceof ConversionError) throw error;
    throw new ParseError('HWP', 'Could not read the document', error as Error);
  }
}

async function parseHwpx(
  buffer: Buffer,
  extractor: ImageExtractor,
  options: HwpParseOptions,
  archive?: Archive
): Promise<HwpParseResult> {
  const source = archive ?? (await loadArchive(buffer, options.options));
  const sections = Object.keys(source.zip.files)
    .filter((name) => /^Contents\/section\d+\.xml$/i.test(name))
    .sort(
      (a, b) =>
        Number(a.match(/section(\d+)/i)?.[1]) -
        Number(b.match(/section(\d+)/i)?.[1])
    );
  if (!sections.length)
    throw new InvalidFileError('HWPX has no content sections');
  const images =
    options.extractImages === false
      ? []
      : await extractor.extractImagesFromZip(
          source.zip,
          'BinData/',
          options.options,
          source.extractor
        );
  const manifest = await readXml(
    source,
    'Contents/content.hpf',
    options.options
  );
  const imageTargets = new Map<string, string>();
  function manifestItems(node: XmlNode | undefined): void {
    if (!node) return;
    if (localName(node.name) === 'item') {
      const id = attr(node, 'id');
      const encodedHref = attr(node, 'href');
      const href = encodedHref ? decodeURIComponent(encodedHref) : undefined;
      if (id && href) {
        const match = images.find(
          (image) =>
            image.originalPath === href ||
            image.originalPath === href.replace(/^\.\.\//, '')
        );
        if (match) imageTargets.set(id, match.originalPath);
      }
    }
    children(node).forEach(manifestItems);
  }
  manifestItems(manifest);
  const output: string[] = [];
  const layout = new LayoutParser();
  for (const section of sections) {
    checkResources();
    const root = await readXml(source, section, options.options);
    if (!root) continue;
    const rels = await relationships(source, section, options.options);
    function render(node: XmlNode): string {
      const name = localName(node.name);
      if (name === 't' || name === 'TEXT') return escapeMarkdown(text(node));
      if (name === 'lineBreak') return '\n';
      if (name === 'tab') return '\t';
      if (name === 'img' || name === 'pic') {
        const imageNode = name === 'pic' ? child(node, 'img') : node;
        const id =
          attr(imageNode, 'binaryItemIDRef') ??
          attr(imageNode, 'binItemRef') ??
          attr(imageNode, 'idRef') ??
          attr(node, 'r:id');
        const rel = rels.get(id ?? '');
        const target =
          imageTargets.get(id ?? '') ??
          (rel && !rel.external ? rel.target : undefined);
        if (target) return extractor.getImageReference(target) ?? '';
        // A picture can wrap its img node in drawing structures.
        return children(node).map(render).join('');
      }
      if (name === 'tbl') {
        const rows = children(node, 'tr').map((row) => ({
          cells: children(row, 'tc').map(
            (cell) =>
              ({
                text: children(cell).map(render).join('').trim(),
                bold: false,
                italic: false,
                alignment: 'left',
                colSpan: Number(attr(child(cell, 'cellSpan'), 'colSpan')) || 1,
                rowSpan: Number(attr(child(cell, 'cellSpan'), 'rowSpan')) || 1
              }) satisfies CellData
          )
        }));
        return `\n\n${layout.parseAdvancedTable({ rows })}\n`;
      }
      if (['secPr', 'header', 'footer', 'ctrl', 'linesegarray'].includes(name))
        return '';
      const content = children(node).map(render).join('');
      return name === 'p' ? `${content.trim()}\n\n` : content;
    }
    output.push(render(root).trim());
  }
  return {
    markdown: output.filter(Boolean).join('\n\n'),
    images,
    charts: [],
    metadata: { format: 'hwpx', parser: 'sax', sectionCount: sections.length }
  };
}

interface BinaryParagraph {
  content?: { type: number; value: number | string }[];
  controls?: BinaryControl[];
}
interface BinaryControl {
  info?: { binID?: number };
  content?: ({ items?: BinaryParagraph[] } | { items?: BinaryParagraph[] }[])[];
}
async function parseBinary(
  buffer: Buffer,
  extractor: ImageExtractor,
  options: HwpParseOptions
): Promise<HwpParseResult> {
  // Use the data parser directly. No DOM, observers, global mutation, or render delay.
  const { parse } = await import('hwp.js');
  const document = parse(buffer, { type: 'buffer' });
  const images: ImageData[] = [];
  const imageRefs = new Map<number, string>();
  if (options.extractImages !== false) {
    for (const [index, image] of document.info.binData.entries()) {
      checkResources();
      const filename = `hwp-image-${index}.${image.extension}`;
      const data = Buffer.from(image.payload);
      const savedPath = await extractor.saveImage(data, filename);
      if (savedPath) {
        images.push({
          originalPath: filename,
          savedPath,
          size: (await stat(savedPath)).size,
          format: path.extname(savedPath).slice(1)
        });
        imageRefs.set(index, extractor.getImageReference(filename) ?? '');
      }
    }
  }
  function paragraphs(items: BinaryParagraph[], depth = 0): string {
    if (depth > 64)
      throw new InvalidFileError('HWP nesting exceeds supported limits');
    return items
      .map((paragraph) => {
        const value = (paragraph.content ?? [])
          .map((c) =>
            typeof c.value === 'string'
              ? c.value
              : c.value === 9
                ? '\t'
                : [10, 13].includes(c.value)
                  ? '\n'
                  : ''
          )
          .join('');
        const parts = [escapeMarkdown(value).trim()];
        for (const control of paragraph.controls ?? []) {
          const id = control.info?.binID;
          if (id !== undefined && imageRefs.has(id))
            parts.push(imageRefs.get(id) ?? '');
          for (const item of control.content ?? []) {
            const lists = Array.isArray(item) ? item : [item];
            parts.push(
              ...lists.map((list) => paragraphs(list.items ?? [], depth + 1))
            );
          }
        }
        return parts.filter(Boolean).join('\n\n');
      })
      .filter(Boolean)
      .join('\n\n');
  }
  const markdown = document.sections
    .map((section) => paragraphs(section.content as BinaryParagraph[]))
    .join('\n\n');
  return {
    markdown,
    images,
    charts: [],
    metadata: {
      format: 'hwp',
      parser: 'hwp.js',
      sectionCount: document.sections.length
    }
  };
}
