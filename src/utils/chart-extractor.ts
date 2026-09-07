import { ResourceLimitError } from '../types/errors.js';
import { checkResources } from './resource-monitor.js';
import type JSZip from 'jszip';
import type {
  ChartData,
  ChartSeries,
  ChartType,
  ConvertOptions
} from '../types/interfaces.js';
import type { ImageExtractor } from './image-extractor.js';
import { SecureZipExtractor, createZipSecurityConfig } from './zip-security.js';
import { parseXmlTree } from './secure-xml-parser.js';
import {
  child,
  children,
  descendants,
  attr,
  text,
  type XmlNode,
  localName
} from './xml.js';
import { escapeMarkdown } from './markdown.js';

interface ExtractedChart {
  readonly originalPath: string;
  readonly data: ChartData;
  readonly basePath: string;
}

function cachedValues(node: XmlNode | undefined): string[] {
  checkResources();
  const cache =
    descendants(node, 'strCache')[0] ??
    descendants(node, 'numCache')[0] ??
    child(node, 'strLit') ??
    child(node, 'numLit');
  const values: string[] = [];
  for (const pt of children(cache, 'pt')) {
    const index = Number(attr(pt, 'idx') ?? values.length);
    if (!Number.isSafeInteger(index) || index < 0 || index > 100000)
      throw new Error('Invalid chart point index');
    values[index] = text(child(pt, 'v'));
  }
  return Array.from({ length: values.length }, (_, i) => values[i] ?? '');
}
export class ChartExtractor {
  private chartCounter = 0;
  constructor(_imageExtractor: ImageExtractor) {
    /* Kept for public API compatibility. */
  }
  async extractChartsFromZip(
    zip: JSZip,
    basePath = '',
    options: ConvertOptions = {},
    extractor?: SecureZipExtractor
  ): Promise<readonly ExtractedChart[]> {
    const secure =
      extractor ?? new SecureZipExtractor(createZipSecurityConfig(options));
    if (!extractor) await secure.validate(zip);
    const result: ExtractedChart[] = [];
    let pointCount = 0;
    for (const [filename, file] of Object.entries(zip.files)) {
      if (
        !filename.startsWith(basePath) ||
        !/\/charts\/chart\d+\.xml$/.test(filename) ||
        file.dir
      )
        continue;
      const root = parseXmlTree(
        (await secure.extractFile(file, filename)).toString('utf8'),
        options
      );
      const chart = child(root, 'chart');
      if (!chart) continue;
      const plot = child(chart, 'plotArea');
      const chartNode = children(plot).find((c) =>
        /Chart$/.test(localName(c.name))
      );
      if (!chartNode) continue;
      const typeName = localName(chartNode.name).replace(/Chart$/, '');
      const type: ChartType = [
        'bar',
        'line',
        'pie',
        'scatter',
        'area'
      ].includes(typeName)
        ? (typeName as ChartType)
        : 'unknown';
      const series: ChartSeries[] = children(chartNode, 'ser').map(
        (seriesNode, index) => {
          const tx = child(seriesNode, 'tx');
          const name =
            text(child(tx, 'v')) ||
            cachedValues(tx)[0] ||
            `Series ${index + 1}`;
          const categories = cachedValues(
            child(seriesNode, 'cat') ?? child(seriesNode, 'xVal')
          );
          const values = cachedValues(
            child(seriesNode, 'val') ?? child(seriesNode, 'yVal')
          ).map((value) => {
            const number = Number(value);
            return Number.isFinite(number) ? number : 0;
          });
          pointCount += categories.length + values.length;
          if (pointCount > 1_000_000)
            throw new ResourceLimitError('chart points', 1_000_000, pointCount);
          return { name, categories, values };
        }
      );
      const titleNode = child(chart, 'title');
      const title =
        descendants(titleNode, 't')
          .map((t) => text(t))
          .join(' ') ||
        cachedValues(titleNode)[0] ||
        '';
      result.push({
        originalPath: filename,
        basePath,
        data: { type, title, series, categories: series[0]?.categories ?? [] }
      });
    }
    return result;
  }
  formatChartAsMarkdown(chart: ChartData): string {
    this.chartCounter++;
    const escapeCell = (value: string) =>
      escapeMarkdown(value).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
    let markdown = `#### Chart ${this.chartCounter}: ${escapeMarkdown(chart.title || `${chart.type.toUpperCase()} Chart`)}\n\n`;
    if (!chart.series.length) return `${markdown}*No chart data available*\n\n`;
    markdown += `| Category | ${chart.series.map((s) => escapeCell(s.name)).join(' | ')} |\n`;
    markdown += `| --- | ${chart.series.map(() => '---').join(' | ')} |\n`;
    const length = chart.series.reduce(
      (max, series) => Math.max(max, series.values.length),
      chart.categories.length
    );
    if (length * chart.series.length > 1_000_000)
      throw new ResourceLimitError(
        'rendered chart cells',
        1_000_000,
        length * chart.series.length
      );
    for (let i = 0; i < length; i++) {
      if (i % 256 === 0) checkResources();
      const label =
        chart.categories[i] ||
        chart.series[0]?.categories?.[i] ||
        `Item ${i + 1}`;
      markdown += `| ${escapeCell(label)} | ${chart.series.map((s) => s.values[i] ?? '').join(' | ')} |\n`;
    }
    return `${markdown}\n`;
  }
  reset(): void {
    this.chartCounter = 0;
  }
  get currentChartCount(): number {
    return this.chartCounter;
  }
}
