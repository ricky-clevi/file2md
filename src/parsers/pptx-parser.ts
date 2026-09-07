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
  CellData
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
import { escapeMarkdown } from '../utils/markdown.js';
import { checkResources } from '../utils/resource-monitor.js';

export interface PptxParseOptions {
  readonly preserveLayout?: boolean;
  readonly extractImages?: boolean;
  readonly extractCharts?: boolean;
  readonly outputDir?: string;
  readonly options?: ConvertOptions;
}
export interface PptxParseResult {
  readonly markdown: string;
  readonly images: readonly ImageData[];
  readonly charts: readonly ChartData[];
  readonly slideCount: number;
  readonly metadata: Record<string, unknown>;
}
export async function parsePptx(
  buffer: Buffer,
  imageExtractor: ImageExtractor,
  chartExtractor: ChartExtractor,
  options: PptxParseOptions = {},
  archive?: Archive
): Promise<PptxParseResult> {
  try {
    const source = archive ?? (await loadArchive(buffer, options.options));
    const presentation = await readXml(
      source,
      'ppt/presentation.xml',
      options.options
    );
    if (!presentation)
      throw new InvalidFileError('PPTX is missing presentation.xml');
    const presentationRels = await relationships(
      source,
      'ppt/presentation.xml',
      options.options
    );
    const slides = children(child(presentation, 'sldIdLst'), 'sldId');
    const images =
      options.extractImages === false
        ? []
        : await imageExtractor.extractImagesFromZip(
            source.zip,
            'ppt/',
            options.options,
            source.extractor
          );
    const charts =
      options.extractCharts === false
        ? []
        : await chartExtractor.extractChartsFromZip(
            source.zip,
            'ppt/',
            options.options,
            source.extractor
          );
    const props = await readXml(source, 'docProps/core.xml', options.options);
    const title = text(child(props, 'title'));
    const output: string[] = title ? [`# ${escapeMarkdown(title)}`] : [];
    const layout = new LayoutParser();
    function textBody(node: XmlNode | undefined): string {
      return children(node, 'p')
        .map((paragraph) => {
          let value = children(paragraph)
            .map((run) => {
              if (localName(run.name) === 'br') return '\n';
              let content = descendants(run, 't')
                .map((t) => escapeMarkdown(text(t)))
                .join('');
              if (options.preserveLayout !== false && content) {
                const properties = child(run, 'rPr');
                if (attr(properties, 'b') === '1') content = `**${content}**`;
                if (attr(properties, 'i') === '1') content = `*${content}*`;
              }
              return content;
            })
            .join('');
          const properties = child(paragraph, 'pPr');
          if (
            options.preserveLayout !== false &&
            (child(properties, 'buChar') || child(properties, 'buAutoNum'))
          ) {
            const level = Math.min(8, Number(attr(properties, 'lvl')) || 0);
            value = `${'  '.repeat(Math.max(0, level))}${child(properties, 'buAutoNum') ? '1.' : '-'} ${value}`;
          }
          return value;
        })
        .join('\n');
    }
    for (const [index, slide] of slides.entries()) {
      checkResources();
      const rel = presentationRels.get(attr(slide, 'r:id') ?? '');
      if (!rel || rel.external)
        throw new InvalidFileError('PPTX slide relationship is missing');
      const root = await readXml(source, rel.target, options.options);
      if (!root) throw new InvalidFileError('PPTX slide is missing');
      const rels = await relationships(source, rel.target, options.options);
      output.push(`## Slide ${index + 1}`);
      function render(node: XmlNode): string[] {
        const name = localName(node.name);
        if (name === 'sp')
          return [textBody(child(node, 'txBody'))].filter(Boolean);
        if (name === 'pic') {
          if (options.extractImages === false) return [];
          const id = attr(descendants(node, 'blip')[0], 'embed');
          const imageRel = rels.get(id ?? '');
          const reference =
            imageRel && !imageRel.external
              ? imageExtractor.getImageReference(imageRel.target)
              : null;
          return reference ? [reference] : [];
        }
        if (name === 'graphicFrame') {
          const table = descendants(node, 'tbl')[0];
          if (table) {
            const rows = children(table, 'tr').map((row) => ({
              cells: children(row, 'tc').map(
                (cell) =>
                  ({
                    text: textBody(child(cell, 'txBody')),
                    bold: false,
                    italic: false,
                    alignment: 'left',
                    // DrawingML includes continuation cells explicitly; keep each grid slot once.
                    colSpan: 1,
                    rowSpan: 1
                  }) satisfies CellData
              )
            }));
            return [layout.parseAdvancedTable({ rows })];
          }
          const chart = descendants(node, 'chart')[0];
          const chartRel = rels.get(attr(chart, 'id') ?? '');
          const data =
            chartRel && !chartRel.external
              ? charts.find((c) => c.originalPath === chartRel.target)
              : undefined;
          return data ? [chartExtractor.formatChartAsMarkdown(data.data)] : [];
        }
        return children(node).flatMap(render);
      }
      output.push(...render(child(child(root, 'cSld'), 'spTree') ?? root));
    }
    return {
      markdown: output.join('\n\n').trim(),
      images,
      charts: charts.map((c) => c.data),
      slideCount: slides.length,
      metadata: {
        totalSlides: slides.length,
        hasImages: images.length > 0,
        hasCharts: charts.length > 0,
        renderMethod: 'text-extraction'
      }
    };
  } catch (error) {
    if (error instanceof ConversionError) throw error;
    throw new ParseError(
      'PPTX',
      'Could not read the presentation',
      error as Error
    );
  }
}
