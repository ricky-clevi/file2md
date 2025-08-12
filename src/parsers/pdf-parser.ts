import pdfParse from 'pdf-parse';
import { Buffer } from 'node:buffer';
import path from 'node:path';
import fs from 'node:fs';

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
              savedPath: page.fullPath || page.imagePath,
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
  buffer: Buffer,
  imageExtractor: ImageExtractor
): Promise<ImageData[]> {
  try {
    console.log('🖼️ Starting PDF embedded image extraction...');
    
    // First, try to parse the PDF and check if it contains images
    const pdfData = await pdfParse(buffer);
    
    // If the PDF has very little text content, it's likely image-heavy
    const textLength = pdfData.text ? pdfData.text.trim().length : 0;
    const isImageHeavy = !pdfData.text || textLength < 200;
    
    console.log(`📊 PDF analysis - Text length: ${textLength}, Pages: ${pdfData.numpages || 1}, Image-heavy: ${isImageHeavy}`);
    
    // Always try the PDFExtractor approach first as it's more reliable
    console.log('📝 Trying to extract images using PDFExtractor...');
    try {
      const { PDFExtractor } = await import('../utils/pdf-extractor.js');
      const pdfExtractor = new PDFExtractor(imageExtractor);
      const extractedImages = await pdfExtractor.extractImagesFromPDF(buffer);
      
      if (extractedImages.length > 0) {
        console.log(`🎉 PDFExtractor successfully extracted ${extractedImages.length} images`);
        return extractedImages.map(page => ({
          originalPath: `pdf_page_${page.pageNumber}.png`,
          savedPath: page.fullPath || page.imagePath,
          basePath: 'pdf/',
          format: 'png',
          dimensions: page.dimensions
        }));
      } else {
        console.log('ℹ️ PDFExtractor found no images to extract');
      }
    } catch (extractorError: unknown) {
      console.warn('⚠️ PDFExtractor failed:', extractorError instanceof Error ? extractorError.message : 'Unknown error');
    }
    
    // If PDFExtractor doesn't find images, try alternative approaches
    if (isImageHeavy) {
      console.log('📄 PDF appears to be image-heavy, trying alternative extraction...');
      return await extractImagesAlternative(buffer, imageExtractor, pdfData.numpages || 1);
    } else {
      console.log('📝 PDF appears to be text-heavy with potential embedded images...');
      return await extractEmbeddedImagesAlternative(buffer, imageExtractor);
    }
  } catch (error: unknown) {
    console.warn('❌ Failed to extract embedded PDF images:', error instanceof Error ? error.message : 'Unknown error');
    return [];
  }
}

/**
 * Alternative approach for extracting images from image-heavy PDFs
 */
async function extractImagesAlternative(
  buffer: Buffer,
  imageExtractor: ImageExtractor,
  pageCount: number
): Promise<ImageData[]> {
  console.log(`🖼️ Alternative image extraction for ${pageCount} page(s)...`);
  
  // For image-heavy PDFs, we'll create a placeholder image that indicates
  // the PDF contains images but requires external tools for extraction
  try {
    console.log('📝 Creating placeholder for image-heavy PDF...');
    
    // Create a simple placeholder image using Canvas or text
    const placeholderContent = `PDF Image Placeholder\n\nThis PDF appears to contain ${pageCount} page(s) with images.\nTo extract individual images, external tools like GraphicsMagick/ImageMagick would be required.\n\nThe PDF text content has been successfully converted to markdown.`;
    
    // Create a simple text-based placeholder
    const placeholderBuffer = Buffer.from(placeholderContent, 'utf-8');
    
    // Save as a text file for now (this could be enhanced with actual image generation)
    const savedPath = await imageExtractor.saveImage(placeholderBuffer, 'pdf_images_placeholder.txt');
    
    if (savedPath) {
      console.log('✅ Created placeholder for PDF images');
      return [{
        originalPath: 'pdf_images_placeholder.txt',
        savedPath,
        basePath: 'pdf/',
        format: 'txt',
        dimensions: undefined
      }];
    }
    
    return [];
  } catch (error: unknown) {
    console.warn('❌ Failed to create placeholder:', error instanceof Error ? error.message : 'Unknown error');
    return [];
  }
}

/**
 * Alternative approach for extracting embedded images from text-heavy PDFs
 */
async function extractEmbeddedImagesAlternative(
  buffer: Buffer,
  imageExtractor: ImageExtractor
): Promise<ImageData[]> {
  console.log('🔍 Alternative approach for text-heavy PDF with potential images...');
  
  try {
    // Try to analyze the PDF structure for embedded images
    // This is a simplified approach that looks for image-like patterns in the PDF
    const pdfString = buffer.toString('binary');
    
    // Look for common image signatures in PDF
    const imagePatterns = [
      /\/Type\/XObject[\s\S]*?\/Subtype\/Image/g,
      /\/FlateDecode[\s\S]*?\/Type\/XObject/g,
      /JFIF/g, // JPEG
      /PNG/g,  // PNG
      /GIF89a/g, // GIF
    ];
    
    let imageCount = 0;
    for (const pattern of imagePatterns) {
      const matches = pdfString.match(pattern);
      if (matches) {
        imageCount += matches.length;
      }
    }
    
    console.log(`🔎 Found ${imageCount} potential image references in PDF structure`);
    
    if (imageCount > 0) {
      // Create a summary of found images
      const summaryContent = `PDF Image Analysis Summary\n\nFound ${imageCount} potential image(s) embedded in this PDF.\n\nThese images are embedded within the PDF structure but require specialized tools for extraction.\nThe text content has been successfully converted to markdown.\n\nTo extract the actual images, consider using:\n- Adobe Acrobat Pro\n- XPDF tools\n- Poppler utilities\n- Online PDF image extraction services`;
      
      const summaryBuffer = Buffer.from(summaryContent, 'utf-8');
      const savedPath = await imageExtractor.saveImage(summaryBuffer, 'pdf_embedded_images_summary.txt');
      
      if (savedPath) {
        console.log(`✅ Created summary for ${imageCount} embedded images`);
        return [{
          originalPath: 'pdf_embedded_images_summary.txt',
          savedPath,
          basePath: 'pdf/',
          format: 'txt',
          dimensions: undefined
        }];
      }
    } else {
      console.log('ℹ️ No embedded images detected in PDF structure');
    }
    
    return [];
  } catch (error: unknown) {
    console.warn('❌ Failed to analyze PDF for embedded images:', error instanceof Error ? error.message : 'Unknown error');
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