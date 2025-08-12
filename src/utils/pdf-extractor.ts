import path from 'node:path';
import { Buffer } from 'node:buffer';

import type { PageData } from '../types/interfaces.js';
import { ImageExtractionError } from '../types/errors.js';
import type { ImageExtractor } from './image-extractor.js';

interface PDFConvertResult {
  readonly page: number;
  readonly path: string;
}

interface TableRow {
  readonly cells: readonly string[];
}

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

export class PDFExtractor {
  private readonly imageExtractor: ImageExtractor;
  private pageCounter: number = 0;

  constructor(imageExtractor: ImageExtractor) {
    this.imageExtractor = imageExtractor;
  }

  /**
   * Extract images from PDF using pdf2pic
   */
  async extractImagesFromPDF(buffer: Buffer): Promise<readonly PageData[]> {
    try {
      console.log('🖼️ PDFExtractor: Using pdf-to-img for image extraction...');
      
      // Parse the PDF to get basic information
      const pdfParse = await import('pdf-parse');
      const pdfData = await pdfParse.default(buffer);
      
      console.log(`📊 PDFExtractor: PDF has ${pdfData.numpages} pages, text length: ${pdfData.text?.length || 0}`);
      
      // Check if this is an image-heavy PDF (little text, likely scanned)
      const isImageHeavy = !pdfData.text || pdfData.text.trim().length < 100;
      
      // Always try to extract images using pdf2pic for image-heavy PDFs or when explicitly needed
      if (isImageHeavy || pdfData.numpages <= 3) {
        console.log('📄 PDF appears to be image-heavy - extracting as images using pdf2pic');
        
        try {
          const extractedPages = await this.convertPDFToImages(buffer, Math.min(pdfData.numpages, 3));
          if (extractedPages.length > 0) {
            console.log(`🎉 Successfully extracted ${extractedPages.length} page images`);
            return extractedPages;
          }
        } catch (pdf2picError: unknown) {
          console.warn('⚠️ pdf-to-img extraction failed:', pdf2picError instanceof Error ? pdf2picError.message : 'Unknown error');
          
          // Fall back to placeholder creation if pdf-to-img fails
          return await this.createPlaceholders(pdfData.numpages);
        }
      } else {
        console.log('ℹ️ PDF appears to be text-heavy - no image extraction needed');
        return [];
      }
      
      return [];
    } catch (error: unknown) {
      console.warn('⚠️ PDFExtractor failed:', error instanceof Error ? error.message : 'Unknown error');
      // Don't throw, just return empty array to allow text processing to continue
      return [];
    }
  }

  /**
   * Convert PDF pages to images using pdf-to-img (pure JavaScript solution)
   */
  private async convertPDFToImages(buffer: Buffer, maxPages: number = 3): Promise<PageData[]> {
    try {
      // Use pdf-to-img for pure JavaScript PDF-to-image conversion
      const { pdf } = await import('pdf-to-img');
      
      console.log(`🔄 Converting PDF to images (max ${maxPages} pages) using pdf-to-img...`);
      
      const extractedPages: PageData[] = [];
      
      // Convert PDF buffer to images - pdf-to-img converts and provides document object
      const pdfDocument = await pdf(buffer, { scale: 2.0 });
      
      // Extract pages up to maxPages
      for (let pageNumber = 1; pageNumber <= Math.min(pdfDocument.length, maxPages); pageNumber++) {
        try {
          // Get the page image buffer
          const imageBuffer = await pdfDocument.getPage(pageNumber);
          const filename = `pdf_page_${pageNumber}.png`;
          
          // Save using image extractor to ensure proper naming and location
          const savedPath = await this.imageExtractor.saveImage(imageBuffer, filename);
          
          if (savedPath) {
            extractedPages.push({
              pageNumber,
              imagePath: path.basename(savedPath),
              fullPath: savedPath,
              dimensions: {
                width: 800, // pdf-to-img doesn't provide exact dimensions
                height: 600
              }
            });
            console.log(`✅ Converted page ${pageNumber} to image using JavaScript`);
          }
        } catch (pageError: unknown) {
          console.warn(`⚠️ Failed to convert page ${pageNumber}:`, pageError instanceof Error ? pageError.message : 'Unknown error');
          // Continue with next page
        }
      }
      
      if (extractedPages.length === 0) {
        throw new Error('No pages could be converted to images');
      }
      
      console.log(`🎉 Successfully converted ${extractedPages.length} pages to images using JavaScript`);
      return extractedPages;
    } catch (error: unknown) {
      console.error('❌ pdf-to-img conversion failed:', error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }

  /**
   * Create placeholder files as fallback when pdf2pic fails
   */
  private async createPlaceholders(pageCount: number): Promise<PageData[]> {
    console.log('📝 Creating image placeholders as fallback...');
    
    const extractedPages: PageData[] = [];
    const maxPages = Math.min(pageCount, 3);
    
    for (let page = 1; page <= maxPages; page++) {
      try {
        // Create a simple placeholder image using Sharp
        const sharp = await import('sharp');
        
        // Create a 800x600 placeholder image with text
        const placeholderImage = await sharp.default({
          create: {
            width: 800,
            height: 600,
            channels: 4,
            background: { r: 240, g: 240, b: 240, alpha: 1 }
          }
        })
        .png()
        .composite([
          {
            input: Buffer.from(
              `<svg width="800" height="600" xmlns="http://www.w3.org/2000/svg">
                <rect width="800" height="600" fill="#f0f0f0" stroke="#ccc" stroke-width="2"/>
                <text x="400" y="250" text-anchor="middle" font-family="Arial" font-size="24" fill="#666">PDF Page ${page}</text>
                <text x="400" y="290" text-anchor="middle" font-family="Arial" font-size="16" fill="#888">Image extraction failed</text>
                <text x="400" y="320" text-anchor="middle" font-family="Arial" font-size="16" fill="#888">Page ${page} of ${pageCount}</text>
                <text x="400" y="360" text-anchor="middle" font-family="Arial" font-size="14" fill="#aaa">Install GraphicsMagick for better PDF support</text>
              </svg>`
            ),
            top: 0,
            left: 0,
          }
        ])
        .toBuffer();
        
        const filename = `pdf_page_${page}_placeholder.png`;
        
        // Use the image extractor to save the placeholder
        const savedPath = await this.imageExtractor.saveImage(placeholderImage, filename);
        
        if (savedPath) {
          extractedPages.push({
            pageNumber: page,
            imagePath: path.basename(savedPath),
            fullPath: savedPath,
            dimensions: {
              width: 800,
              height: 600
            }
          });
          console.log(`✅ Created image placeholder for page ${page}`);
        }
      } catch (sharpError: unknown) {
        console.warn(`⚠️ Failed to create image placeholder for page ${page}:`, sharpError instanceof Error ? sharpError.message : 'Unknown error');
        
        // Fallback to simple text-based approach without Sharp conversion
        const filename = `pdf_page_${page}_info.txt`;
        const placeholderContent = `PDF Page ${page} - Image extraction failed\n\nPage ${page} of ${pageCount}\n\nInstall GraphicsMagick for better PDF image support.`;
        const placeholderBuffer = Buffer.from(placeholderContent, 'utf-8');
        
        // Save directly without image conversion
        const fs = await import('fs/promises');
        const fullPath = path.join(this.imageExtractor.imageDirectory, filename);
        
        try {
          await fs.writeFile(fullPath, placeholderBuffer);
          
          extractedPages.push({
            pageNumber: page,
            imagePath: filename,
            fullPath: path.resolve(fullPath)
          });
          console.log(`✅ Created text placeholder for page ${page}`);
        } catch (writeError: unknown) {
          console.warn(`⚠️ Failed to write placeholder for page ${page}:`, writeError instanceof Error ? writeError.message : 'Unknown error');
        }
      }
    }
    
    return extractedPages;
  }

  /**
   * Enhance text with layout detection
   */
  async enhanceTextWithLayout(text: string, _pdfData?: unknown): Promise<string> {
    const lines = text.split('\n');
    let enhancedText = '';
    let inTable = false;
    let tableRows: TableRow[] = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      if (!line) {
        // Handle empty lines
        if (inTable) {
          enhancedText += this.formatTableRows(tableRows);
          tableRows = [];
          inTable = false;
        }
        enhancedText += '\n';
        continue;
      }
      
      // Detect headings (lines that are short and followed by content)
      if (this.isLikelyHeading(line, lines, i)) {
        if (inTable) {
          enhancedText += this.formatTableRows(tableRows);
          tableRows = [];
          inTable = false;
        }
        
        const headingLevel = this.determineHeadingLevel(line);
        enhancedText += `${'#'.repeat(headingLevel)} ${line}\n\n`;
        continue;
      }
      
      // Detect table-like content
      if (this.isLikelyTableRow(line)) {
        if (!inTable) {
          inTable = true;
        }
        tableRows.push({ cells: this.parseTableRow(line) });
        continue;
      } else if (inTable) {
        // End of table
        enhancedText += this.formatTableRows(tableRows);
        tableRows = [];
        inTable = false;
      }
      
      // Detect lists
      if (this.isListItem(line)) {
        enhancedText += `${this.formatListItem(line)}\n`;
        continue;
      }
      
      // Regular paragraph
      enhancedText += `${line}\n`;
    }
    
    // Handle any remaining table
    if (inTable && tableRows.length > 0) {
      enhancedText += this.formatTableRows(tableRows);
    }
    
    return enhancedText;
  }

  private isLikelyHeading(line: string, allLines: readonly string[], index: number): boolean {
    // Check if line looks like a heading
    if (line.length > 80) return false; // Too long to be a heading
    if (line.length < 3) return false;  // Too short
    
    // Check if it's all caps (common for headings)
    if (line === line.toUpperCase() && line.length > 5) return true;
    
    // Check if followed by a longer paragraph
    const nextLine = allLines[index + 1];
    if (nextLine && nextLine.trim().length > line.length * 1.5) {
      return true;
    }
    
    // Check if it ends with a colon (section header)
    if (line.endsWith(':')) return true;
    
    return false;
  }

  private determineHeadingLevel(line: string): number {
    if (line === line.toUpperCase()) return 1; // All caps = major heading
    if (line.endsWith(':')) return 2;         // Ends with colon = section
    if (line.length < 30) return 3;           // Short = subsection
    return 2; // Default
  }

  private isLikelyTableRow(line: string): boolean {
    // Look for patterns that suggest tabular data
    const patterns = [
      /\t+/,
      /\s{3,}/,                 // Multiple spaces
      /\|/,                     // Pipe separated
      /\s+\d+\s+/,
      /^\s*\d+\.\s+/,
    ];
    
    return patterns.some(pattern => pattern.test(line));
  }

  private parseTableRow(line: string): readonly string[] {
    // Split line into columns based on various separators
    let columns: string[] = [];
    
    if (line.includes('\t')) {
      columns = line.split('\t').map(col => col.trim());
    } else if (line.includes('|')) {
      columns = line.split('|').map(col => col.trim());
    } else {
      // Split on multiple spaces
      columns = line.split(/\s{2,}/).map(col => col.trim());
    }
    
    return columns.filter(col => col.length > 0);
  }

  private formatTableRows(rows: readonly TableRow[]): string {
    if (rows.length === 0) return '';
    
    // Find maximum number of columns
    const maxCols = Math.max(...rows.map(row => row.cells.length));
    
    let markdown = '';
    
    for (const [i, row] of rows.entries()) {
      let rowMarkdown = '|';
      
      for (let j = 0; j < maxCols; j++) {
        const cell = row.cells[j] || '';
        rowMarkdown += ` ${cell} |`;
      }
      
      markdown += `${rowMarkdown}\n`;
      
      // Add header separator after first row
      if (i === 0) {
        let separator = '|';
        for (let j = 0; j < maxCols; j++) {
          separator += ' --- |';
        }
        markdown += `${separator}\n`;
      }
    }
    
    return `${markdown}\n`;
  }

  private isListItem(line: string): boolean {
    // Check for various list patterns
    const listPatterns = [
      /^\s*[-•·]\s+/,
      /^\s*\d+\.\s+/,
      /^\s*[a-zA-Z]\.\s+/,
      /^\s*[ivx]+\.\s+/i,
    ];
    
    return listPatterns.some(pattern => pattern.test(line));
  }

  private formatListItem(line: string): string {
    // Convert various list formats to markdown
    if (/^\s*\d+\.\s+/.test(line)) {
      return line.replace(/^\s*\d+\.\s+/, '1. ');
    } else if (/^\s*[a-zA-Z]\.\s+/.test(line)) {
      return line.replace(/^\s*[a-zA-Z]\.\s+/, '- ');
    } else if (/^\s*[ivx]+\.\s+/i.test(line)) {
      return line.replace(/^\s*[ivx]+\.\s+/i, '- ');
    } else {
      return line.replace(/^\s*[-•·]\s+/, '- ');
    }
  }

  /**
   * Create page breaks with images
   */
  async createPageBreaks(pageImages: readonly PageData[]): Promise<string> {
    let markdown = '';
    
    for (const [i, page] of pageImages.entries()) {
      markdown += `## Page ${page.pageNumber}\n\n`;
      markdown += this.imageExtractor.getImageMarkdown(`Page ${page.pageNumber}`, page.imagePath);
      markdown += '\n\n';
      
      if (i < pageImages.length - 1) {
        markdown += '---\n\n'; // Page separator
      }
    }
    
    return markdown;
  }

  /**
   * Reset internal counters
   */
  reset(): void {
    this.pageCounter = 0;
  }

  /**
   * Get current page counter
   */
  get currentPageCount(): number {
    return this.pageCounter;
  }
}
