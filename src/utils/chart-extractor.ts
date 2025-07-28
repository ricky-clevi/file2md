import { parseStringPromise } from 'xml2js';
import type JSZip from 'jszip';

import type { ChartData, ChartSeries, ChartType } from '../types/interfaces.js';
import { ChartExtractionError } from '../types/errors.js';
import type { ImageExtractor } from './image-extractor.js';

interface ExtractedChart {
  readonly originalPath: string;
  readonly data: ChartData;
  readonly basePath: string;
}

interface ChartFileInfo {
  readonly path: string;
  readonly file: JSZip.JSZipObject;
  readonly basePath: string;
}

// XML parser result types
interface ChartXmlResult {
  readonly 'c:chartSpace'?: readonly [{
    readonly 'c:chart': readonly [{
      readonly 'c:title'?: readonly [{
        readonly 'c:tx': readonly [unknown];
      }];
      readonly 'c:plotArea'?: readonly [{
        readonly 'c:barChart'?: readonly [unknown];
        readonly 'c:lineChart'?: readonly [unknown];
        readonly 'c:pieChart'?: readonly [unknown];
        readonly 'c:scatterChart'?: readonly [unknown];
      }];
    }];
  }];
}

interface ChartSeriesData {
  readonly 'c:ser'?: readonly Array<{
    readonly 'c:tx'?: readonly [{
      readonly 'c:strRef': readonly [{
        readonly 'c:strCache'?: readonly [{
          readonly 'c:pt': readonly Array<{
            readonly 'c:v': readonly [string];
          }>;
        }];
      }];
    }];
    readonly 'c:val'?: readonly [{
      readonly 'c:numRef': readonly [{
        readonly 'c:numCache'?: readonly [{
          readonly 'c:pt': readonly Array<{
            readonly 'c:v': readonly [string];
          }>;
        }];
      }];
    }];
    readonly 'c:cat'?: readonly [{
      readonly 'c:strRef': readonly [{
        readonly 'c:strCache'?: readonly [{
          readonly 'c:pt': readonly Array<{
            readonly 'c:v': readonly [string];
          }>;
        }];
      }];
    }];
  }>;
}

export class ChartExtractor {
  private readonly imageExtractor: ImageExtractor;
  private chartCounter: number = 0;

  constructor(imageExtractor: ImageExtractor) {
    this.imageExtractor = imageExtractor;
  }

  /**
   * Extract charts from a ZIP archive (DOCX, XLSX, PPTX)
   */
  async extractChartsFromZip(zip: JSZip, basePath: string = ''): Promise<readonly ExtractedChart[]> {
    const charts: ChartFileInfo[] = [];
    
    zip.forEach((relativePath, file) => {
      // Look for chart files
      if (relativePath.includes('/charts/') && relativePath.endsWith('.xml')) {
        charts.push({
          path: relativePath,
          file: file,
          basePath: basePath
        });
      }
    });

    const extractedCharts: ExtractedChart[] = [];
    for (const chart of charts) {
      try {
        const chartData = await this.parseChart(chart.file);
        if (chartData) {
          extractedCharts.push({
            originalPath: chart.path,
            data: chartData,
            basePath: chart.basePath
          });
        }
      } catch (error: unknown) {
        console.warn(`Failed to extract chart ${chart.path}:`, error instanceof Error ? error.message : 'Unknown error');
      }
    }

    return extractedCharts;
  }

  /**
   * Parse a chart XML file
   */
  private async parseChart(chartFile: JSZip.JSZipObject): Promise<ChartData | null> {
    try {
      const xmlContent = await chartFile.async('string');
      const result = await parseStringPromise(xmlContent) as ChartXmlResult;
      
      const chartData: Omit<ChartData, 'type' | 'title' | 'series' | 'categories'> & {
        type: ChartType;
        title: string;
        series: ChartSeries[];
        categories: string[];
      } = {
        type: 'unknown',
        title: '',
        series: [],
        categories: []
      };

      // Extract chart type
      if (result['c:chartSpace']) {
        const chart = result['c:chartSpace'][0]['c:chart'][0];
        
        // Extract title
        if (chart['c:title']?.[0]?.['c:tx']) {
          chartData.title = this.extractTextFromTitle(chart['c:title'][0]['c:tx'][0]);
        }

        // Extract plot area
        if (chart['c:plotArea']) {
          const plotArea = chart['c:plotArea'][0];
          
          // Determine chart type and extract data
          if (plotArea['c:barChart']) {
            chartData.type = 'bar';
            const { series, categories } = this.extractBarChartData(plotArea['c:barChart'][0] as ChartSeriesData);
            chartData.series = series;
            chartData.categories = categories;
          } else if (plotArea['c:lineChart']) {
            chartData.type = 'line';
            const { series, categories } = this.extractLineChartData(plotArea['c:lineChart'][0] as ChartSeriesData);
            chartData.series = series;
            chartData.categories = categories;
          } else if (plotArea['c:pieChart']) {
            chartData.type = 'pie';
            const { series, categories } = this.extractPieChartData(plotArea['c:pieChart'][0] as ChartSeriesData);
            chartData.series = series;
            chartData.categories = categories;
          } else if (plotArea['c:scatterChart']) {
            chartData.type = 'scatter';
            const { series, categories } = this.extractScatterChartData(plotArea['c:scatterChart'][0] as ChartSeriesData);
            chartData.series = series;
            chartData.categories = categories;
          }
        }
      }

      return chartData;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new ChartExtractionError(`Failed to parse chart: ${message}`, error as Error);
    }
  }

  private extractTextFromTitle(titleData: unknown): string {
    // Simplified title extraction - in a real implementation, this would need more robust typing
    try {
      const title = titleData as any;
      if (title?.['c:rich']?.[0]?.['a:p']) {
        const paragraphs = title['c:rich'][0]['a:p'];
        let titleText = '';
        for (const para of paragraphs) {
          if (para?.['a:r']?.[0]?.['a:t']?.[0]) {
            titleText += para['a:r'][0]['a:t'][0] + ' ';
          }
        }
        return titleText.trim();
      }
    } catch {
      // Ignore parsing errors for title
    }
    return '';
  }

  private extractBarChartData(barChart: ChartSeriesData): { series: ChartSeries[]; categories: string[] } {
    return this.extractGenericChartData(barChart);
  }

  private extractLineChartData(lineChart: ChartSeriesData): { series: ChartSeries[]; categories: string[] } {
    return this.extractGenericChartData(lineChart);
  }

  private extractPieChartData(pieChart: ChartSeriesData): { series: ChartSeries[]; categories: string[] } {
    return this.extractGenericChartData(pieChart);
  }

  private extractScatterChartData(scatterChart: ChartSeriesData): { series: ChartSeries[]; categories: string[] } {
    return this.extractGenericChartData(scatterChart);
  }

  private extractGenericChartData(chartData: ChartSeriesData): { series: ChartSeries[]; categories: string[] } {
    const series: ChartSeries[] = [];
    let allCategories: string[] = [];
    
    if (chartData['c:ser']) {
      for (const seriesData of chartData['c:ser']) {
        const seriesInfo: Omit<ChartSeries, 'name' | 'values' | 'categories'> & {
          name: string;
          values: number[];
          categories?: string[];
        } = {
          name: '',
          values: [],
          categories: undefined
        };
        
        // Extract series name
        if (seriesData['c:tx']?.[0]?.['c:strRef']?.[0]?.['c:strCache']?.[0]?.['c:pt']?.[0]) {
          seriesInfo.name = seriesData['c:tx'][0]['c:strRef'][0]['c:strCache'][0]['c:pt'][0]['c:v'][0];
        }
        
        // Extract values
        if (seriesData['c:val']?.[0]?.['c:numRef']?.[0]?.['c:numCache']?.[0]?.['c:pt']) {
          for (const pt of seriesData['c:val'][0]['c:numRef'][0]['c:numCache'][0]['c:pt']) {
            seriesInfo.values.push(parseFloat(pt['c:v'][0]) || 0);
          }
        }
        
        // Extract categories for this series
        if (seriesData['c:cat']?.[0]?.['c:strRef']?.[0]?.['c:strCache']?.[0]?.['c:pt']) {
          const categories: string[] = [];
          for (const pt of seriesData['c:cat'][0]['c:strRef'][0]['c:strCache'][0]['c:pt']) {
            categories.push(pt['c:v'][0]);
          }
          seriesInfo.categories = categories;
          if (allCategories.length === 0) {
            allCategories = categories;
          }
        }
        
        series.push(seriesInfo);
      }
    }
    
    return { series, categories: allCategories };
  }

  /**
   * Format chart data as markdown
   */
  formatChartAsMarkdown(chartData: ChartData): string {
    this.chartCounter++;
    let markdown = `#### Chart ${this.chartCounter}: ${chartData.title || chartData.type.toUpperCase() + ' Chart'}\n\n`;
    
    if (chartData.series.length === 0) {
      return markdown + '*No chart data available*\n\n';
    }

    switch (chartData.type) {
      case 'bar':
      case 'line':
        markdown += this.formatBarLineChart(chartData);
        break;
      case 'pie':
        markdown += this.formatPieChart(chartData);
        break;
      default:
        markdown += this.formatGenericChart(chartData);
    }

    return markdown + '\n';
  }

  private formatBarLineChart(chartData: ChartData): string {
    let markdown = '| Category |';
    
    // Add series headers
    for (const series of chartData.series) {
      markdown += ` ${series.name || 'Series'} |`;
    }
    markdown += '\n';
    
    // Add separator
    markdown += '| --- |';
    for (let i = 0; i < chartData.series.length; i++) {
      markdown += ' --- |';
    }
    markdown += '\n';
    
    // Find maximum number of categories
    const maxCategories = Math.max(
      chartData.categories.length,
      ...chartData.series.map(s => s.categories?.length || 0)
    );
    
    // Add data rows
    for (let i = 0; i < maxCategories; i++) {
      const category = chartData.categories[i] || chartData.series[0]?.categories?.[i] || `Item ${i + 1}`;
      markdown += `| ${category} |`;
      
      for (const series of chartData.series) {
        const value = series.values[i] || 0;
        markdown += ` ${value} |`;
      }
      markdown += '\n';
    }
    
    return markdown;
  }

  private formatPieChart(chartData: ChartData): string {
    const series = chartData.series[0];
    if (!series) return '*No pie chart data*\n';
    
    let markdown = '| Category | Value | Percentage |\n';
    markdown += '| --- | --- | --- |\n';
    
    const total = series.values.reduce((sum, val) => sum + val, 0);
    const categories = series.categories || chartData.categories;
    
    for (let i = 0; i < Math.min(categories.length, series.values.length); i++) {
      const category = categories[i];
      const value = series.values[i] || 0;
      const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : '0';
      
      markdown += `| ${category} | ${value} | ${percentage}% |\n`;
    }
    
    return markdown;
  }

  private formatGenericChart(chartData: ChartData): string {
    let markdown = `*${chartData.type.toUpperCase()} chart with ${chartData.series.length} series*\n\n`;
    
    for (let i = 0; i < chartData.series.length; i++) {
      const series = chartData.series[i];
      markdown += `**Series ${i + 1}: ${series.name}**\n`;
      markdown += `Values: ${series.values.join(', ')}\n`;
      if (series.categories && series.categories.length > 0) {
        markdown += `Categories: ${series.categories.join(', ')}\n`;
      }
      markdown += '\n';
    }
    
    return markdown;
  }

  /**
   * Reset internal counters
   */
  reset(): void {
    this.chartCounter = 0;
  }

  /**
   * Get current chart counter
   */
  get currentChartCount(): number {
    return this.chartCounter;
  }
}