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
      console.log('🖼️ PDFExtractor: Using pdf2pic for image extraction...');
      
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
          console.warn('⚠️ pdf2pic extraction failed:', pdf2picError instanceof Error ? pdf2picError.message : 'Unknown error');
          // Fall back to placeholder creation only if pdf2pic fails
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
   * Convert PDF pages to images using pdf2pic
   */
  private async convertPDFToImages(buffer: Buffer, maxPages: number = 3): Promise<PageData[]> {
    try {
      const { fromBuffer } = await import('pdf2pic');
      
      console.log(`🔄 Converting PDF to images (max ${maxPages} pages)...`);
      
      const extractedPages: PageData[] = [];
      
      // Convert each page individually to have more control
      for (let pageNumber = 1; pageNumber <= maxPages; pageNumber++) {
        try {
          // Configure pdf2pic options for this specific page
          const convertOptions = {
            format: 'png' as const,
            out_dir: this.imageExtractor.imageDirectory,
            out_prefix: `pdf_page_${pageNumber}`,
            page: pageNumber
          };
          
          // Convert single page from buffer
          const convert = fromBuffer(buffer, convertOptions);
          const result = await convert(pageNumber, true); // true for returning base64
          
          if (result && 'base64' in result && result.base64) {
            // Convert base64 to buffer
            const imageBuffer = Buffer.from(result.base64, 'base64');
            const filename = `pdf_page_${pageNumber}.png`;
            
            // Save the image using the image extractor
            const savedPath = await this.imageExtractor.saveImage(imageBuffer, filename);
            
            if (savedPath) {
              extractedPages.push({
                pageNumber,
                imagePath: path.basename(savedPath),
                fullPath: savedPath,
                dimensions: {
                  width: 800, // Default dimensions since pdf2pic doesn't always provide them
                  height: 600
                }
              });
              console.log(`✅ Converted page ${pageNumber} to image`);
            }
          }
        } catch (pageError: unknown) {
          console.warn(`⚠️ Failed to convert page ${pageNumber}:`, pageError instanceof Error ? pageError.message : 'Unknown error');
          // Continue with next page
        }
      }
      
      if (extractedPages.length === 0) {
        throw new Error('No pages could be converted to images');
      }
      
      return extractedPages;
    } catch (error: unknown) {
      console.error('❌ pdf2pic conversion failed:', error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }

  /**
   * Create placeholder files as fallback when pdf2pic fails
   */
  private async createPlaceholders(pageCount: number): Promise<PageData[]> {
    console.log('📝 Creating placeholders as fallback...');
    
    const extractedPages: PageData[] = [];
    const maxPages = Math.min(pageCount, 3);
    
    for (let page = 1; page <= maxPages; page++) {
      const placeholderContent = `PDF Page ${page} Image Placeholder\n\nThis page appears to contain primarily image content.\nUnable to extract actual image - pdf2pic conversion failed.\n\nPage ${page} of ${pageCount}`;
      const placeholderBuffer = Buffer.from(placeholderContent, 'utf-8');
      
      // Save placeholder as a text file
      const filename = `pdf_page_${page}_placeholder.txt`;
      
      // Use the image extractor to save the placeholder
      const savedPath = await this.imageExtractor.saveImage(placeholderBuffer, filename);
      
      if (savedPath) {
        extractedPages.push({
          pageNumber: page,
          imagePath: path.basename(savedPath),
          fullPath: savedPath
        });
        console.log(`✅ Created placeholder for page ${page}`);
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
