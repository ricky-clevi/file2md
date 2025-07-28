import type { ConvertInput, ConvertOptions, ConversionResult } from './types/index.js';
/**
 * Convert a document (PDF, DOCX, XLSX, PPTX) to Markdown format
 *
 * @param input - File path (string) or Buffer containing the document data
 * @param options - Conversion options
 * @returns Promise resolving to conversion result with markdown and metadata
 *
 * @throws {FileNotFoundError} When file path doesn't exist
 * @throws {UnsupportedFormatError} When file format is not supported
 * @throws {InvalidFileError} When file is corrupted or invalid
 * @throws {ParseError} When document parsing fails
 *
 * @example
 * ```typescript
 * // Convert from file path
 * const result = await convert('./document.pdf');
 * console.log(result.markdown);
 *
 * // Convert from buffer with options
 * const buffer = await fs.readFile('./document.docx');
 * const result = await convert(buffer, {
 *   imageDir: 'extracted-images',
 *   preserveLayout: true
 * });
 * ```
 */
export declare function convert(input: ConvertInput, options?: ConvertOptions): Promise<ConversionResult>;
export type * from './types/index.js';
export { ImageExtractor } from './utils/image-extractor.js';
export { ChartExtractor } from './utils/chart-extractor.js';
export { LayoutParser } from './utils/layout-parser.js';
//# sourceMappingURL=index.d.ts.map