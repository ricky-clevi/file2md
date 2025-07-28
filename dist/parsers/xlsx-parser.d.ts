import type { Buffer } from 'node:buffer';
import type { ImageExtractor } from '../utils/image-extractor.js';
import type { ChartExtractor } from '../utils/chart-extractor.js';
import type { ChartData } from '../types/interfaces.js';
export interface XlsxParseOptions {
    readonly preserveLayout?: boolean;
    readonly extractCharts?: boolean;
}
export interface XlsxParseResult {
    readonly markdown: string;
    readonly charts: readonly ChartData[];
    readonly sheetCount: number;
    readonly metadata: Record<string, unknown>;
}
/**
 * Parse XLSX buffer and convert to markdown with formatting preservation
 */
export declare function parseXlsx(buffer: Buffer, imageExtractor: ImageExtractor, chartExtractor: ChartExtractor, options?: XlsxParseOptions): Promise<XlsxParseResult>;
//# sourceMappingURL=xlsx-parser.d.ts.map