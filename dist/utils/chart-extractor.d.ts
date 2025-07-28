import type JSZip from 'jszip';
import type { ChartData } from '../types/interfaces.js';
import type { ImageExtractor } from './image-extractor.js';
interface ExtractedChart {
    readonly originalPath: string;
    readonly data: ChartData;
    readonly basePath: string;
}
export declare class ChartExtractor {
    private readonly imageExtractor;
    private chartCounter;
    constructor(imageExtractor: ImageExtractor);
    /**
     * Extract charts from a ZIP archive (DOCX, XLSX, PPTX)
     */
    extractChartsFromZip(zip: JSZip, basePath?: string): Promise<readonly ExtractedChart[]>;
    /**
     * Parse a chart XML file
     */
    private parseChart;
    private extractTextFromTitle;
    private extractBarChartData;
    private extractLineChartData;
    private extractPieChartData;
    private extractScatterChartData;
    private extractGenericChartData;
    /**
     * Format chart data as markdown
     */
    formatChartAsMarkdown(chartData: ChartData): string;
    private formatBarLineChart;
    private formatPieChart;
    private formatGenericChart;
    /**
     * Reset internal counters
     */
    reset(): void;
    /**
     * Get current chart counter
     */
    get currentChartCount(): number;
}
export {};
//# sourceMappingURL=chart-extractor.d.ts.map