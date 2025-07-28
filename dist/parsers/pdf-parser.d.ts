import type { Buffer } from 'node:buffer';
import { type PDFParseOptions, type PDFParseResult } from '../utils/pdf-extractor.js';
import type { ImageExtractor } from '../utils/image-extractor.js';
/**
 * Parse PDF buffer and convert to markdown with enhanced layout preservation
 */
export declare function parsePdf(buffer: Buffer, imageExtractor: ImageExtractor, options?: PDFParseOptions): Promise<PDFParseResult>;
//# sourceMappingURL=pdf-parser.d.ts.map