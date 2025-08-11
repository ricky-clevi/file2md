import pdfParse from 'pdf-parse';
import type { Buffer } from 'node:buffer';
import path from 'node:path';

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
    
    try {
      const embeddedImages = await extractEmbeddedImages(buffer, imageExtractor);
      if (embeddedImages.length > 0) {
        images.push(...embeddedImages);
      }
    } catch (embeddedError: unknown) {
      console.warn('Failed to extract embedded images:', embeddedError instanceof Error ? embeddedError.message : 'Unknown error');
    }
    
    // Try to extract text with enhanced layout
    if (data.text && data.text.trim()) {
      try {
        const enhancedText = await pdfExtractor.enhanceTextWithLayout(data.text, data);
        markdown += enhancedText;
        
        // Embed any extracted images inline within the text content
        if (images.length > 0) {
          markdown += await embedImagesInContent(images, imageExtractor);
        }
      } catch {
        console.warn('Layout enhancement failed, falling back to basic text extraction');
        // Fall back to basic text extraction
        markdown = extractBasicText(data.text);
        
        // Still try to embed images
        if (images.length > 0) {
          markdown += await embedImagesInContent(images, imageExtractor);
        }
      }
    }
    
    // If text is minimal or extraction failed, convert pages to images
    if (!data.text || data.text.trim().length < 100) {
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
 * Extract embedded images from PDF
 */
async function extractEmbeddedImages(
  _buffer: Buffer,
  _imageExtractor: ImageExtractor
): Promise<ImageData[]> {
  try {
    // For now, we'll use a placeholder approach since PDF image extraction
    // is complex and would require parsing the PDF structure directly
    // In a future implementation, we could use libraries like pdf2pic or pdf-poppler
    // to extract individual images rather than converting entire pages
    
    return [];
  } catch (error: unknown) {
    console.warn('Failed to extract embedded PDF images:', error instanceof Error ? error.message : 'Unknown error');
    return [];
  }
}

/**
 * Embed images inline within content
 */
async function embedImagesInContent(
  images: readonly ImageData[],
  imageExtractor: ImageExtractor
): Promise<string> {
  if (images.length === 0) return '';
  
  let imageMarkdown = '\n\n## Document Images\n\n';
  
  for (const [index, image] of images.entries()) {
    if (image.savedPath) {
      const filename = path.basename(image.savedPath);
      imageMarkdown += imageExtractor.getImageMarkdown(`Image ${index + 1}`, filename);
      imageMarkdown += '\n\n';
    }
  }
  
  return imageMarkdown;
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