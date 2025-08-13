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
  private pageCounter: number = 0;

  constructor() {
    // No longer needs image extractor - PDF text only
  }

  /**
   * Extract text from PDF - no image extraction
   */
  async extractTextFromPDF(buffer: Buffer): Promise<{ text: string; pageCount: number; metadata: Record<string, unknown> }> {
    try {
      console.log('📄 PDFExtractor: Extracting text content only...');
      
      // Parse the PDF to get text content
      const pdfParse = await import('pdf-parse');
      const pdfData = await pdfParse.default(buffer);
      
      console.log(`📊 PDFExtractor: PDF has ${pdfData.numpages} pages, text length: ${pdfData.text?.length || 0}`);
      
      return {
        text: pdfData.text || '',
        pageCount: pdfData.numpages || 0,
        metadata: pdfData.metadata || {}
      };
    } catch (error: unknown) {
      console.warn('⚠️ PDFExtractor failed to extract text:', error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
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
