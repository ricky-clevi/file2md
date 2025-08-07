import pdfParse from 'pdf-parse';
import type { Buffer } from 'node:buffer';

import { PDFExtractor, type PDFParseOptions, type PDFParseResult } from '../utils/pdf-extractor.js';
import { ParseError, InvalidFileError } from '../types/errors.js';
import type { ImageExtractor } from '../utils/image-extractor.js';
import type { ImageData } from '../types/interfaces.js';

/**
 * Parse PDF buffer and convert to markdown with enhanced layout preservation
 */
export async function parsePdf(
  buffer: Buffer, 
  imageExtractor: ImageExtractor,
  options: PDFParseOptions = {}
): Promise<PDFParseResult> {
  try {
    const data = await pdfParse(buffer);
    const pdfExtractor = new PDFExtractor(imageExtractor);
    
    let markdown = '';
    const images: ImageData[] = [];
    let pageCount = data.numpages || 1;
    
    // Apply maxPages limit if specified
    if (options.maxPages && options.maxPages > 0) {
      pageCount = Math.min(pageCount, options.maxPages);
    }
    
    // Try to extract text with enhanced layout
    if (data.text && data.text.trim()) {
      console.log('📄 Extracting text with layout enhancement...');
      try {
        const enhancedText = await pdfExtractor.enhanceTextWithLayout(data.text, data);
        markdown += enhancedText;
      } catch {
        console.warn('Layout enhancement failed, falling back to basic text extraction');
        // Fall back to basic text extraction
        markdown = extractBasicText(data.text);
      }
    }
    
    // If text is minimal or extraction failed, convert pages to images
    if (!data.text || data.text.trim().length < 100) {
      console.log('📸 Converting PDF pages to images for better preservation...');
      try {
        const pageImages = await pdfExtractor.extractImagesFromPDF(buffer);
        if (pageImages.length > 0) {
          // Convert page images to ImageData format
          for (const page of pageImages) {
            images.push({
              originalPath: `page_${page.pageNumber}`,
              savedPath: page.imagePath,
              basePath: '',
              format: 'png',
              dimensions: page.dimensions
            });
          }
          
          if (markdown.trim()) {
            markdown += '\n\n---\n\n## Visual Content\n\n';
          }
          markdown += await pdfExtractor.createPageBreaks(pageImages);
        }
      } catch (imageError: unknown) {
        console.warn('Failed to extract PDF as images:', imageError instanceof Error ? imageError.message : 'Unknown error');
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