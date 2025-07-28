import type { Buffer } from 'node:buffer';
import type { ImageExtractor } from '../utils/image-extractor.js';
import type { ChartExtractor } from '../utils/chart-extractor.js';
import type { ImageData, ChartData } from '../types/interfaces.js';
export interface PptxParseOptions {
    readonly preserveLayout?: boolean;
    readonly extractImages?: boolean;
    readonly extractCharts?: boolean;
}
export interface PptxParseResult {
    readonly markdown: string;
    readonly images: readonly ImageData[];
    readonly charts: readonly ChartData[];
    readonly slideCount: number;
    readonly metadata: Record<string, unknown>;
}
/**
 * Parse PPTX buffer and convert to markdown with layout preservation
 */
export declare function parsePptx(buffer: Buffer, imageExtractor: ImageExtractor, chartExtractor: ChartExtractor, options?: PptxParseOptions): Promise<PptxParseResult>;
//# sourceMappingURL=pptx-parser.d.ts.map