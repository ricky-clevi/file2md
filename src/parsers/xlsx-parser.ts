import type { ImageExtractor } from '../utils/image-extractor.js';
import type { ChartExtractor } from '../utils/chart-extractor.js';
import { LayoutParser } from '../utils/layout-parser.js';
import {
  ConversionError,
  InvalidFileError,
  ParseError,
  ResourceLimitError
} from '../types/errors.js';
import type {
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
  type XmlNode
} from '../utils/xml.js';
import { escapeMarkdown } from '../utils/markdown.js';
import { checkResources } from '../utils/resource-monitor.js';

export interface XlsxParseOptions {
  readonly preserveLayout?: boolean;
  readonly extractCharts?: boolean;
  readonly options?: ConvertOptions;
}
export interface XlsxParseResult {
  readonly markdown: string;
  readonly charts: readonly ChartData[];
  readonly sheetCount: number;
  readonly metadata: Record<string, unknown>;
}

function columnIndex(reference: string): number {
  const letters = reference.match(/^([A-Z]+)[1-9]\d*$/i)?.[1];
  if (!letters)
    throw new InvalidFileError('Invalid spreadsheet cell reference');
  let index = 0;
  for (const letter of letters.toUpperCase())
    index = index * 26 + letter.charCodeAt(0) - 64;
  if (index > 16384)
    throw new InvalidFileError('Spreadsheet column exceeds XLSX limits');
  return index - 1;
}
const emptyCell = (): CellData => ({
  text: '',
  bold: false,
  italic: false,
  alignment: 'left',
  colSpan: 1,
  rowSpan: 1
});

export async function parseXlsx(
  buffer: Buffer,
  _imageExtractor: ImageExtractor,
  chartExtractor: ChartExtractor,
  options: XlsxParseOptions = {},
  archive?: Archive
): Promise<XlsxParseResult> {
  try {
    const source = archive ?? (await loadArchive(buffer, options.options));
    const workbook = await readXml(source, 'xl/workbook.xml', options.options);
    if (!workbook) throw new InvalidFileError('XLSX is missing workbook.xml');
    const rels = await relationships(
      source,
      'xl/workbook.xml',
      options.options
    );
    const shared = await readXml(
      source,
      'xl/sharedStrings.xml',
      options.options
    );
    const strings = children(shared, 'si').map((si) =>
      descendants(si, 't')
        .map((t) => text(t))
        .join('')
    );
    const styles = await readXml(source, 'xl/styles.xml', options.options);
    const fonts = children(child(styles, 'fonts'), 'font');
    const formats = children(child(styles, 'cellXfs'), 'xf');
    const fills = children(child(styles, 'fills'), 'fill');
    const numberFormats = new Map(
      children(child(styles, 'numFmts'), 'numFmt').map((n) => [
        attr(n, 'numFmtId'),
        attr(n, 'formatCode') ?? ''
      ])
    );
    const date1904 = ['1', 'true'].includes(
      attr(child(workbook, 'workbookPr'), 'date1904') ?? ''
    );
    const sheets = children(child(workbook, 'sheets'), 'sheet');
    const output: string[] = [];
    const layout = new LayoutParser();
    let totalCells = 0;
    let lastRowNumber = 0;
    function value(cell: XmlNode, format: XmlNode | undefined): string {
      const raw = text(child(cell, 'v'));
      switch (attr(cell, 't')) {
        case 'inlineStr':
          return descendants(child(cell, 'is'), 't')
            .map((t) => text(t))
            .join('');
        case 's':
          return raw ? (strings[Number(raw)] ?? '') : '';
        case 'b':
          return raw === '1' ? 'TRUE' : 'FALSE';
        case 'str':
        case 'e':
        case 'd':
          return raw;
      }
      if (!raw && child(cell, 'f')) return `=${text(child(cell, 'f'))}`;
      const number = Number(raw);
      const id = Number(attr(format, 'numFmtId') ?? 0);
      const code = (numberFormats.get(String(id)) ?? '').replace(
        /"[^"]*"|\\.|\[[^\]]*\]/g,
        ''
      );
      if (raw && Number.isFinite(number)) {
        const timeOnly =
          (id >= 18 && id <= 21) ||
          (id >= 45 && id <= 47) ||
          (/[hs]/i.test(code) && !/[yd]/i.test(code));
        if (timeOnly && number >= 0 && number < 2958466) {
          const seconds = Math.round(number * 86400);
          const hours =
            id === 46
              ? Math.floor(seconds / 3600)
              : Math.floor(seconds / 3600) % 24;
          const minutes = Math.floor(seconds / 60) % 60;
          return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
        }
        const isDate =
          (id >= 14 && id <= 22) ||
          (id >= 27 && id <= 36) ||
          (id >= 50 && id <= 58) ||
          /[ydhs]/i.test(code);
        if (isDate && number >= 0 && number < 2958466) {
          const date = new Date(
            Date.UTC(
              date1904 ? 1904 : 1899,
              date1904 ? 0 : 11,
              date1904 ? 1 : 31
            ) +
              (number - (!date1904 && number >= 60 ? 1 : 0)) * 86400000
          );
          // Preserve Excel's historical, non-Gregorian leap-day value.
          if (!date1904 && Math.floor(number) === 60) return '1900-02-29';
          return number % 1
            ? date.toISOString().replace('.000Z', 'Z')
            : date.toISOString().slice(0, 10);
        }
        if (id === 9 || id === 10 || code.includes('%'))
          return `${Number((number * 100).toFixed(10))}%`;
      }
      return raw;
    }
    for (const sheet of sheets) {
      checkResources();
      const rel = rels.get(attr(sheet, 'id') ?? '');
      if (!rel || rel.external)
        throw new InvalidFileError('XLSX worksheet relationship is missing');
      const root = await readXml(source, rel.target, options.options);
      if (!root) throw new InvalidFileError('XLSX worksheet is missing');
      const rows: { cells: CellData[] }[] = [];
      lastRowNumber = 0;
      for (const row of children(child(root, 'sheetData'), 'row')) {
        const rowNumber = Number(attr(row, 'r') ?? lastRowNumber + 1);
        if (
          !Number.isSafeInteger(rowNumber) ||
          rowNumber <= lastRowNumber ||
          rowNumber > 1048576
        )
          throw new InvalidFileError('Invalid worksheet row index');
        lastRowNumber = rowNumber;
        const cells: CellData[] = [];
        for (const cell of children(row, 'c')) {
          const reference = attr(cell, 'r');
          const index = reference ? columnIndex(reference) : cells.length;
          if (index > 16383)
            throw new InvalidFileError('Invalid spreadsheet column');
          const format = formats[Number(attr(cell, 's') ?? 0)];
          const font = fonts[Number(attr(format, 'fontId') ?? 0)];
          const fill = fills[Number(attr(format, 'fillId') ?? 0)];
          while (cells.length <= index) cells.push(emptyCell());
          const alignment = attr(child(format, 'alignment'), 'horizontal');
          const styled = options.preserveLayout !== false;
          cells[index] = {
            ...emptyCell(),
            text: escapeMarkdown(value(cell, format)),
            bold:
              styled &&
              !!child(font, 'b') &&
              attr(child(font, 'b'), 'val') !== '0',
            italic:
              styled &&
              !!child(font, 'i') &&
              attr(child(font, 'i'), 'val') !== '0',
            alignment: (styled &&
            ['left', 'center', 'right', 'justify'].includes(alignment ?? '')
              ? alignment
              : 'left') as TextAlignment,
            backgroundColor: styled
              ? attr(child(child(fill, 'patternFill'), 'fgColor'), 'rgb')
              : undefined
          };
        }
        totalCells += cells.length;
        if (totalCells > 1_000_000)
          throw new ResourceLimitError(
            'spreadsheet cells',
            1_000_000,
            totalCells
          );
        if (cells.length) rows.push({ cells });
      }
      // Sparse row indexes do not allocate millions of empty rows.
      const renderedCells =
        rows.length *
        rows.reduce((max, row) => Math.max(max, row.cells.length), 0);
      if (renderedCells > 1_000_000)
        throw new ResourceLimitError(
          'rendered spreadsheet cells',
          1_000_000,
          renderedCells
        );
      output.push(
        `### ${escapeMarkdown(attr(sheet, 'name') ?? 'Sheet')}\n\n${layout.parseAdvancedTable({ rows }, { preserveAlignment: options.preserveLayout !== false, preserveColors: options.preserveLayout !== false })}`
      );
    }
    const charts =
      options.extractCharts === false
        ? []
        : await chartExtractor.extractChartsFromZip(
            source.zip,
            'xl/',
            options.options,
            source.extractor
          );
    output.push(
      ...charts.map((chart) => chartExtractor.formatChartAsMarkdown(chart.data))
    );
    return {
      markdown: output.join('\n\n').trim(),
      charts: charts.map((c) => c.data),
      sheetCount: sheets.length,
      metadata: { totalSheets: sheets.length, processedSheets: sheets.length }
    };
  } catch (error) {
    if (error instanceof ConversionError) throw error;
    throw new ParseError('XLSX', 'Could not read the workbook', error as Error);
  }
}
