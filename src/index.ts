import { promises as fs } from 'node:fs';
import { Buffer } from 'node:buffer';
const fileType = require('file-type');

import { ImageExtractor } from './utils/image-extractor.js';
import { ChartExtractor } from './utils/chart-extractor.js';
import { parsePdf } from './parsers/pdf-parser.js';
import { parseDocx } from './parsers/docx-parser.js';
import { parseXlsx } from './parsers/xlsx-parser.js';
import { parsePptx } from './parsers/pptx-parser.js';

import type {
  ConvertInput,
  ConvertOptions,
  ConversionResult,
  DocumentMetadata,
  SupportedMimeType
} from './types/index.js';

import {
  FileNotFoundError,
  UnsupportedFormatError,
  InvalidFileError,
  SUPPORTED_MIME_TYPES
} from './types/index.js';

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
export async function convert(input: ConvertInput, options: ConvertOptions = {}): Promise<ConversionResult> {
  const startTime = Date.now();
  
  try {
    let buffer: Buffer;
    
    // Handle input type
    if (typeof input === 'string') {
      try {
        buffer = await fs.readFile(input);
      } catch (error: unknown) {
        if ((error as any)?.code === 'ENOENT') {
          throw new FileNotFoundError(input);
        }
        throw new InvalidFileError(`Failed to read file: ${input}`, error as Error);
      }
    } else if (Buffer.isBuffer(input)) {
      buffer = input;
    } else {
      throw new InvalidFileError('Input must be a file path (string) or Buffer');
    }

    // Detect file type
    const detectedType = await fileType.fromBuffer(buffer);
    
    if (!detectedType) {
      throw new UnsupportedFormatError('unknown');
    }

    // Validate supported format
    const supportedMimeTypes = Object.values(SUPPORTED_MIME_TYPES);
    if (!supportedMimeTypes.includes(detectedType.mime as SupportedMimeType)) {
      throw new UnsupportedFormatError(detectedType.mime);
    }

    // Setup extractors
    const {
      imageDir = 'images',
      outputDir,
      preserveLayout = true,
      extractCharts = true,
      extractImages = true,
      maxPages
    } = options;

    const imageExtractor = new ImageExtractor(imageDir);
    const chartExtractor = new ChartExtractor(imageExtractor);

    // Parse document based on type
    let markdown: string;
    let images: readonly import('./types/interfaces.js').ImageData[] = [];
    let charts: readonly import('./types/interfaces.js').ChartData[] = [];
    let pageCount = 1;
    let additionalMetadata: Record<string, unknown> = {};

    switch (detectedType.mime as SupportedMimeType) {
      case SUPPORTED_MIME_TYPES.PDF: {
        const result = await parsePdf(buffer, imageExtractor, { maxPages, preserveLayout });
        markdown = result.markdown;
        images = result.images || [];
        pageCount = result.pageCount || 1;
        additionalMetadata = result.metadata || {};
        break;
      }
      
      case SUPPORTED_MIME_TYPES.DOCX: {
        const result = await parseDocx(buffer, imageExtractor, chartExtractor, { preserveLayout, extractImages, extractCharts });
        markdown = result.markdown;
        images = result.images || [];
        charts = result.charts || [];
        additionalMetadata = result.metadata || {};
        break;
      }
      
      case SUPPORTED_MIME_TYPES.XLSX: {
        const result = await parseXlsx(buffer, imageExtractor, chartExtractor, { preserveLayout, extractCharts });
        markdown = result.markdown;
        charts = result.charts || [];
        pageCount = result.sheetCount || 1;
        additionalMetadata = result.metadata || {};
        break;
      }
      
      case SUPPORTED_MIME_TYPES.PPTX: {
        const result = await parsePptx(buffer, imageExtractor, chartExtractor, { 
          preserveLayout, 
          extractImages, 
          extractCharts
        });
        markdown = result.markdown;
        images = result.images || [];
        charts = result.charts || [];
        pageCount = result.slideCount || 1;
        additionalMetadata = result.metadata || {};
        break;
      }
      
      default: {
        // This should never happen due to earlier validation, but TypeScript requires it
        const exhaustiveCheck: never = detectedType.mime as never;
        throw new UnsupportedFormatError(exhaustiveCheck);
      }
    }

    const endTime = Date.now();

    // Build metadata
    const metadata: DocumentMetadata = {
      fileType: detectedType.ext.toUpperCase(),
      mimeType: detectedType.mime,
      pageCount,
      imageCount: images.length,
      chartCount: charts.length,
      processingTime: endTime - startTime,
      additional: additionalMetadata
    };

    return {
      markdown,
      images,
      charts,
      metadata
    };

  } catch (error: unknown) {
    // Re-throw known errors
    if (error instanceof FileNotFoundError || 
        error instanceof UnsupportedFormatError || 
        error instanceof InvalidFileError) {
      throw error;
    }
    
    // Wrap unknown errors
    const message = error instanceof Error ? error.message : 'Unknown conversion error';
    throw new InvalidFileError(`Conversion failed: ${message}`, error as Error);
  }
}

// Export types for consumers
export type * from './types/index.js';

// Export utility classes for advanced usage
export { ImageExtractor } from './utils/image-extractor.js';
export { ChartExtractor } from './utils/chart-extractor.js';
export { LayoutParser } from './utils/layout-parser.js';