import type { Buffer } from 'node:buffer';
import type { ImageExtractor } from '../utils/image-extractor.js';
import type { ChartExtractor } from '../utils/chart-extractor.js';
import type { ImageData, ChartData } from '../types/interfaces.js';
export interface DocxParseOptions {
    readonly preserveLayout?: boolean;
    readonly extractImages?: boolean;
    readonly extractCharts?: boolean;
}
export interface DocxParseResult {
    readonly markdown: string;
    readonly images: readonly ImageData[];
    readonly charts: readonly ChartData[];
    readonly metadata: Record<string, unknown>;
}
/**
 * Parse DOCX buffer and convert to markdown with layout preservation
 */
export declare function parseDocx(buffer: Buffer, imageExtractor: ImageExtractor, chartExtractor: ChartExtractor, options?: DocxParseOptions): Promise<DocxParseResult>;
//# sourceMappingURL=docx-parser.d.ts.map