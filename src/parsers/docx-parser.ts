import type { ImageExtractor } from '../utils/image-extractor.js';
import type { ChartExtractor } from '../utils/chart-extractor.js';
import { LayoutParser } from '../utils/layout-parser.js';
import {
  ConversionError,
  InvalidFileError,
  ParseError
} from '../types/errors.js';
import type {
  ImageData,
  ChartData,
  ConvertOptions,
  CellData,
  TextAlignment
} from '../types/interfaces.js';
import { loadArchive, type Archive } from '../utils/zip-security.js';
import {
  readXml,
  relationships,
  child,
  children,
  descendants,
  text,
  attr,
  localName,
  type XmlNode
} from '../utils/xml.js';
import { escapeMarkdown, safeLink } from '../utils/markdown.js';

export interface DocxParseOptions {
  readonly preserveLayout?: boolean;
  readonly extractImages?: boolean;
  readonly extractCharts?: boolean;
  readonly options?: ConvertOptions;
}
export interface DocxParseResult {
  readonly markdown: string;
  readonly images: readonly ImageData[];
  readonly charts: readonly ChartData[];
  readonly metadata: Record<string, unknown>;
}

export async function parseDocx(
  buffer: Buffer,
  imageExtractor: ImageExtractor,
  chartExtractor: ChartExtractor,
  options: DocxParseOptions = {},
  archive?: Archive
): Promise<DocxParseResult> {
  try {
    const source = archive ?? (await loadArchive(buffer, options.options));
    const root = await readXml(source, 'word/document.xml', options.options);
    const body = child(root, 'body');
    if (!body) throw new InvalidFileError('DOCX is missing its document body');
    const rels = await relationships(
      source,
      'word/document.xml',
      options.options
    );
    const images =
      options.extractImages === false
        ? []
        : await imageExtractor.extractImagesFromZip(
            source.zip,
            'word/',
            options.options,
            source.extractor
          );
    const charts =
      options.extractCharts === false
        ? []
        : await chartExtractor.extractChartsFromZip(
            source.zip,
            'word/',
            options.options,
            source.extractor
          );
    const numbering = await readXml(
      source,
      'word/numbering.xml',
      options.options
    );
    const usedCharts = new Set<string>();
    const layout = new LayoutParser();
    const listCounters = new Map<string, number>();
    function linkedAsset(id: string | undefined, chart: boolean): string {
      const rel = id ? rels.get(id) : undefined;
      if (!rel || rel.external) return '';
      if (!chart) return imageExtractor.getImageReference(rel.target) ?? '';
      const found = charts.find((c) => c.originalPath === rel.target);
      if (!found || usedCharts.has(rel.target)) return '';
      usedCharts.add(rel.target);
      return `\n\n${chartExtractor.formatChartAsMarkdown(found.data)}`;
    }
    function inline(node: XmlNode): string {
      const name = localName(node.name);
      if (name === 't') return escapeMarkdown(text(node));
      if (name === 'tab') return '\t';
      if (name === 'br' || name === 'cr') return '  \n';
      if (name === 'del' || name === 'instrText' || name.endsWith('Pr'))
        return '';
      if (name === 'blip' || name === 'imagedata')
        return linkedAsset(attr(node, 'embed') ?? attr(node, 'id'), false);
      if (name === 'chart') return linkedAsset(attr(node, 'id'), true);
      let value = children(node).map(inline).join('');
      if (name === 'r' && options.preserveLayout !== false) {
        const properties = child(node, 'rPr');
        const enabled = (key: string) => {
          const prop = child(properties, key);
          return (
            !!prop && !['0', 'false', 'off'].includes(attr(prop, 'val') ?? '')
          );
        };
        if (value.trim() && enabled('b')) value = `**${value}**`;
        if (value.trim() && enabled('i')) value = `*${value}*`;
      }
      if (name === 'hyperlink') {
        const rel = rels.get(attr(node, 'id') ?? '');
        const url = rel?.external ? safeLink(rel.target) : undefined;
        if (url && value) value = `[${value}](${url})`;
      }
      return value;
    }
    function paragraph(node: XmlNode): string {
      let value = inline(node).trim();
      if (!value || options.preserveLayout === false) return value;
      const props = child(node, 'pPr');
      const heading = attr(child(props, 'pStyle'), 'val')?.match(
        /^heading\s*([1-6])$/i
      );
      if (heading) return `${'#'.repeat(Number(heading[1]))} ${value}`;
      const num = child(props, 'numPr');
      if (num) {
        const id = attr(child(num, 'numId'), 'val') ?? '';
        const level = Math.min(
          8,
          Math.max(0, Number(attr(child(num, 'ilvl'), 'val')) || 0)
        );
        const definition = children(numbering, 'num').find(
          (n) => attr(n, 'numId') === id
        );
        const abstractId = attr(child(definition, 'abstractNumId'), 'val');
        const abstract = children(numbering, 'abstractNum').find(
          (n) => attr(n, 'abstractNumId') === abstractId
        );
        const lvl = children(abstract, 'lvl').find(
          (n) => attr(n, 'ilvl') === String(level)
        );
        const format = attr(child(lvl, 'numFmt'), 'val');
        const key = `${id}:${level}`;
        const counter =
          (listCounters.get(key) ??
            (Number(attr(child(lvl, 'start'), 'val')) || 1) - 1) + 1;
        listCounters.set(key, counter);
        value = `${'  '.repeat(level)}${format && format !== 'bullet' ? `${counter}.` : '-'} ${value}`;
      }
      return value;
    }
    function table(node: XmlNode): string {
      const rows = children(node, 'tr').map((row) => ({
        cells: children(row, 'tc').map((cell) => {
          const props = child(cell, 'tcPr');
          const alignment =
            attr(child(child(child(cell, 'p'), 'pPr'), 'jc'), 'val') ?? 'left';
          return {
            text: blocks(cell).join('\n'),
            bold: false,
            italic: false,
            alignment: (['left', 'center', 'right', 'justify'].includes(
              alignment
            )
              ? alignment
              : 'left') as TextAlignment,
            colSpan: Math.min(
              1000,
              Number(attr(child(props, 'gridSpan'), 'val')) || 1
            ),
            rowSpan: 1,
            backgroundColor:
              options.preserveLayout === false
                ? undefined
                : attr(child(props, 'shd'), 'fill')
          } satisfies CellData;
        })
      }));
      return layout.parseAdvancedTable(
        { rows },
        {
          preserveAlignment: options.preserveLayout !== false,
          preserveColors: options.preserveLayout !== false
        }
      );
    }
    function blocks(node: XmlNode): string[] {
      return children(node)
        .flatMap((c) => {
          const name = localName(c.name);
          if (name === 'p') return [paragraph(c)];
          if (name === 'tbl') return [table(c)];
          return name === 'sdt' || name === 'sdtContent' ? blocks(c) : [];
        })
        .filter(Boolean);
    }
    const output = blocks(body);
    for (const chart of charts)
      if (!usedCharts.has(chart.originalPath))
        output.push(chartExtractor.formatChartAsMarkdown(chart.data));
    return {
      markdown: output.join('\n\n').trim(),
      images,
      charts: charts.map((c) => c.data),
      metadata: {
        paragraphCount: descendants(body, 'p').length,
        tableCount: descendants(body, 'tbl').length
      }
    };
  } catch (error) {
    if (error instanceof ConversionError) throw error;
    throw new ParseError('DOCX', 'Could not read the document', error as Error);
  }
}
