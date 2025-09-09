import pdfParse from 'pdf-parse';
import { Buffer } from 'node:buffer';

import { PDFExtractor, type PDFParseOptions, type PDFParseResult } from '../utils/pdf-extractor.js';
import { ParseError, InvalidFileError, SecurityError, ResourceLimitError } from '../types/errors.js';
import type { ConvertOptions } from '../types/interfaces.js';
import { validateBuffer } from '../utils/resource-monitor.js';

/**
 * Parse PDF buffer and convert to markdown with enhanced layout preservation
 */
export async function parsePdf(
  buffer: Buffer,
  options: PDFParseOptions & { options?: ConvertOptions } = {}
): Promise<PDFParseResult> {
  try {
    // Additional security validation for PDF content
    if (options.options) {
      validateBuffer(buffer, options.options, 'binary');
    }
    
    const data = await pdfParse(buffer);
    const pdfExtractor = new PDFExtractor();
    
    let markdown = '';
    const images: never[] = []; // No images for PDF
    let pageCount = data.numpages || 1;
    
    // Apply maxPages limit if specified
    if (options.maxPages && options.maxPages > 0) {
      pageCount = Math.min(pageCount, options.maxPages);
    }
    
    console.log('📄 PDF text-only extraction - no images will be processed');
    
    // Try to extract text with enhanced layout
    if (data.text && data.text.trim()) {
      try {
        const enhancedText = await pdfExtractor.enhanceTextWithLayout(data.text, data);
        markdown += enhancedText;
      } catch {
        console.warn('Layout enhancement failed, falling back to basic text extraction');
        // Fall back to basic text extraction
        markdown = extractBasicText(data.text);
      }
    }
    
    // Fallback to basic text if everything else fails
    if (!markdown.trim()) {
      if (data.text && data.text.trim()) {
        markdown = extractBasicText(data.text);
      } else {
        throw new InvalidFileError('PDF file appears to be empty or contains no extractable text');
      }
    }
    
    return {
      markdown,
      images,
      pageCount,
      metadata: {
        version: data.version || 'unknown',
        info: data.info || {},
        textLength: data.text?.length || 0
      }
    };
    
  } catch (error: unknown) {
    if (error instanceof InvalidFileError) {
      throw error;
    }
    
    const message = error instanceof Error ? error.message : 'Unknown error';
    
    if (message.includes('Invalid PDF') || message.includes('PDF')) {
      throw new InvalidFileError('Invalid or corrupted PDF file', error as Error);
    }
    
    throw new ParseError('PDF', message, error as Error);
  }
}


/**
 * Extract basic text from PDF with minimal formatting
 */
function extractBasicText(text: string): string {
  const lines = text.split('\n');
  const cleanedLines = lines
    .map(line => line.trim())
    .filter(line => line.length > 0);
  
  return cleanedLines.join('\n');
}