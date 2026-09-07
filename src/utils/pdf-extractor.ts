import { escapeMarkdown } from './markdown.js';
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
  /**
   * Enhance text with layout detection
   */
  async enhanceTextWithLayout(
    text: string,
    _pdfData?: unknown
  ): Promise<string> {
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

      if (this.isListItem(line)) {
        if (inTable) {
          enhancedText += this.formatTableRows(tableRows);
          tableRows = [];
          inTable = false;
        }
        enhancedText += `${this.formatListItem(line)}\n`;
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
        enhancedText += `${'#'.repeat(headingLevel)} ${escapeMarkdown(line)}\n\n`;
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

      // Regular paragraph
      enhancedText += `${escapeMarkdown(line)}\n`;
    }

    // Handle any remaining table
    if (inTable && tableRows.length > 0) {
      enhancedText += this.formatTableRows(tableRows);
    }

    return enhancedText;
  }

  private isLikelyHeading(
    line: string,
    allLines: readonly string[],
    index: number
  ): boolean {
    // Check if line looks like a heading
    if (line.length > 80) return false; // Too long to be a heading
    if (line.length < 3) return false; // Too short

    // Check if it's all caps (common for headings)
    if (/[A-Z]/.test(line) && line === line.toUpperCase() && line.length > 5)
      return true;

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
    if (/[A-Z]/.test(line) && line === line.toUpperCase()) return 1; // All caps = major heading
    if (line.endsWith(':')) return 2; // Ends with colon = section
    if (line.length < 30) return 3; // Short = subsection
    return 2; // Default
  }

  private isLikelyTableRow(line: string): boolean {
    // Look for patterns that suggest tabular data
    const patterns = [
      /\t+/,
      /\s{3,}/, // Multiple spaces
      /\|/, // Pipe separated
      /\s+\d+\s+/,
      /^\s*\d+\.\s+/
    ];

    return patterns.some((pattern) => pattern.test(line));
  }

  private parseTableRow(line: string): readonly string[] {
    // Split line into columns based on various separators
    let columns: string[] = [];

    if (line.includes('\t')) {
      columns = line.split('\t').map((col) => col.trim());
    } else if (line.includes('|')) {
      columns = line.split('|').map((col) => col.trim());
    } else {
      // Split on multiple spaces
      columns = line.split(/\s{2,}/).map((col) => col.trim());
    }

    return columns.filter((col) => col.length > 0);
  }

  private formatTableRows(rows: readonly TableRow[]): string {
    if (rows.length === 0) return '';

    // Find maximum number of columns
    const maxCols = rows.reduce(
      (max, row) => Math.max(max, row.cells.length),
      0
    );

    let markdown = '';

    for (const [i, row] of rows.entries()) {
      let rowMarkdown = '|';

      for (let j = 0; j < maxCols; j++) {
        const cell = escapeMarkdown(row.cells[j] || '').replace(/\|/g, '\\|');
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
      /^\s*[ivx]+\.\s+/i
    ];

    return listPatterns.some((pattern) => pattern.test(line));
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
}
