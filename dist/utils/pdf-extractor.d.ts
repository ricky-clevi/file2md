import type { Buffer } from 'node:buffer';
import type { PageData } from '../types/interfaces.js';
import type { ImageExtractor } from './image-extractor.js';
export interface PDFParseOptions {
    readonly maxPages?: number;
    readonly preserveLayout?: boolean;
}
export interface PDFParseResult {
    readonly markdown: string;
    readonly images: readonly import('../types/interfaces.js').ImageData[];
    readonly pageCount: number;
    readonly metadata: Record<string, unknown>;
}
export declare class PDFExtractor {
    private readonly imageExtractor;
    private pageCounter;
    constructor(imageExtractor: ImageExtractor);
    /**
     * Extract images from PDF by converting pages to images
     */
    extractImagesFromPDF(buffer: Buffer): Promise<readonly PageData[]>;
    /**
     * Enhance text with layout detection
     */
    enhanceTextWithLayout(text: string, pdfData?: unknown): Promise<string>;
    private isLikelyHeading;
    private determineHeadingLevel;
    private isLikelyTableRow;
    private parseTableRow;
    private formatTableRows;
    private isListItem;
    private formatListItem;
    /**
     * Create page breaks with images
     */
    createPageBreaks(pageImages: readonly PageData[]): Promise<string>;
    /**
     * Reset internal counters
     */
    reset(): void;
    /**
     * Get current page counter
     */
    get currentPageCount(): number;
}
//# sourceMappingURL=pdf-extractor.d.ts.map