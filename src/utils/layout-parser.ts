import type { 
  TableData, 
  ListData, 
  ListItem, 
  Position
} from '../types/interfaces.js';

export interface TableFormatOptions {
  readonly preserveAlignment?: boolean;
  readonly showBorders?: boolean;
  readonly preserveColors?: boolean;
}

export interface ColumnData {
  readonly content: string;
}

export class LayoutParser {
  private tableCounter: number = 0;

  /**
   * Parse an advanced table with merged cells and styling
   */
  parseAdvancedTable(tableData: TableData, options: TableFormatOptions = {}): string {
    if (!tableData.rows || tableData.rows.length === 0) {
      return '';
    }

    const { 
      preserveAlignment = true, 
      preserveColors = false 
    } = options;

    let markdown = '';
    const rows = tableData.rows;
    const colCount = Math.max(...rows.map(row => row.cells ? row.cells.length : 0));

    // Process each row
    for (const [rowIndex, row] of rows.entries()) {
      let rowMarkdown = '|';
      
      if (!row.cells) continue;

      // Process each cell
      for (let colIndex = 0; colIndex < colCount; colIndex++) {
        const cell = row.cells[colIndex];
        if (!cell) {
          rowMarkdown += '  |';
          continue;
        }
        
        let cellContent = cell.text || '';
        
        // Handle merged cells
        if (cell.merged) {
          if (cell.colSpan > 1) {
            // For horizontal merge, add extra columns
            cellContent += ' '.repeat(Math.max(0, cell.colSpan - 1) * 3);
          }
          // Note: Markdown doesn't support rowspan, so we approximate
        }

        // Process markdown formatting in cell content
        cellContent = this.processCellFormatting(cellContent);
        
        // Apply additional text formatting from cell properties
        if (cell.bold && !cellContent.includes('**')) {
          cellContent = `**${cellContent}**`;
        }
        if (cell.italic && !cellContent.includes('*')) {
          cellContent = `*${cellContent}*`;
        }
        
        // Apply alignment (approximate with spaces)
        if (preserveAlignment && cell.alignment) {
          const cellWidth = Math.max(cellContent.length, 10);
          switch (cell.alignment) {
            case 'center': {
              const padding = Math.floor((cellWidth - cellContent.length) / 2);
              cellContent = `${' '.repeat(padding)}${cellContent}${' '.repeat(padding)}`;
              break;
            }
            case 'right': {
              cellContent = cellContent.padStart(cellWidth);
              break;
            }
            // 'left' and 'justify' use default formatting
          }
        }

        // Add background color note if enabled
        if (preserveColors && cell.backgroundColor) {
          cellContent += ` <!-- bg:${cell.backgroundColor} -->`;
        }

        rowMarkdown += ` ${cellContent} |`;
      }

      markdown += `${rowMarkdown}\n`;

      // Add header separator after first row
      if (rowIndex === 0) {
        let separator = '|';
        for (const cell of rows[0].cells) {
          let sepContent = ' --- ';
          
          // Apply alignment in separator
          if (preserveAlignment && cell?.alignment) {
            switch (cell.alignment) {
              case 'center':
                sepContent = ':---:';
                break;
              case 'right':
                sepContent = ' ---:';
                break;
              case 'left':
              default:
                sepContent = ':--- ';
                break;
            }
          }
          separator += `${sepContent}|`;
        }
        markdown += `${separator}
`;
      }
    }

    return markdown;
  }

  /**
   * Parse lists with proper nesting
   */
  parseList(listData: ListData): string {
    if (!listData.items || listData.items.length === 0) return '';
    
    const processListItems = (items: readonly ListItem[], level: number = 0): string => {
      let result = '';
      for (const item of items) {
        const indent = '  '.repeat(level);
        const marker = listData.isOrdered ? '1.' : '-';
        
        let itemText = item.text || '';
        
        // Apply formatting
        if (item.bold) itemText = `**${itemText}**`;
        if (item.italic) itemText = `*${itemText}*`;
        
        result += `${indent}${marker} ${itemText}\n`;
        
        // Handle nested lists
        if (item.children && item.children.length > 0) {
          result += processListItems(item.children, level + 1);
        }
      }
      return result;
    };

    return processListItems(listData.items);
  }

  /**
   * Create text box representation
   */
  createTextBox(content: string, position?: Position): string {
    let markdown = '';
    
    if (position && (position.x || position.y)) {
      markdown += `<!-- Position: x=${position.x || 0}, y=${position.y || 0} -->\n`;
    }
    
    markdown += '> **Text Box**\n';
    markdown += '> \n';
    
    // Split content into lines and add blockquote formatting
    const lines = content.split('\n');
    for (const line of lines) {
      markdown += `> ${line}\n`;
    }
    
    return `${markdown}\n`;
  }

  /**
   * Create multi-column layout approximation - only for genuine multi-column content
   */
  createColumns(columns?: readonly ColumnData[]): string {
    if (!columns || columns.length <= 1) {
      return columns?.[0]?.content || '';
    }

    // Be much more conservative - only create columns if there's substantial content
    // and it looks like genuinely different content types
    const substantialColumns = columns.filter(col => 
      col.content && col.content.trim().length > 10
    );
    
    if (substantialColumns.length <= 1) {
      // Just concatenate content with line breaks
      return columns.map(col => col.content || '').filter(c => c.trim()).join('\n\n');
    }
    
    // Only create table format if we have 2-4 substantial columns
    if (substantialColumns.length > 4) {
      return substantialColumns.map(col => col.content || '').join('\n\n');
    }

    let markdown = '';
    
    // Create a simple side-by-side layout without excessive table structure
    markdown += '|';
    for (const [i] of substantialColumns.entries()) {
      markdown += ` Column ${i + 1} |`;
    }
    markdown += '\n';
    
    markdown += '|';
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for (const _ of substantialColumns) {
      markdown += ' --- |';
    }
    markdown += '\n';
    
    // Create a single row with all content
    markdown += '|';
    for (const column of substantialColumns) {
      const content = column.content || '';
      // Limit content length to prevent excessive table width
      const truncated = content.length > 200 ? `${content.substring(0, 200)}...` : content;
      markdown += ` ${truncated.replace(/\n/g, '<br>')} |`;
    }
    markdown += '\n';
    
    return `${markdown}\n`;
  }

  /**
   * Parse headers and footers
   */
  parseHeaderFooter(content: string, type: 'header' | 'footer' = 'header'): string {
    if (!content) return '';
    
    const marker = type === 'header' ? '🔝' : '🔻';
    return `<!-- Document ${type} -->\n> ${marker} ${content}\n\n`;
  }

  /**
   * Create divider/separator
   */
  createDivider(style: 'simple' | 'thick' | 'dashed' | 'dotted' = 'simple'): string {
    switch (style) {
      case 'thick':
        return '\n═══════════════════════════════════════\n\n';
      case 'dashed':
        return '\n---\n\n';
      case 'dotted':
        return '\n• • • • • • • • • • • • • • • • • • • • •\n\n';
      default:
        return '\n---\n\n';
    }
  }

  /**
   * Calculate relative positioning for layout elements with improved grouping
   */
  calculateRelativePosition<T extends { position?: Position }>(elements: readonly T[]): T[] {
    // Sort elements by their Y position primarily, with much larger threshold for "same row"
    return [...elements].sort((a, b) => {
      const aY = a.position?.y || 0;
      const bY = b.position?.y || 0;
      const aX = a.position?.x || 0;
      const bX = b.position?.x || 0;
      
      const yDiff = aY - bY;
      // Increase threshold significantly to avoid over-segmentation
      if (Math.abs(yDiff) < 200) { // Much larger tolerance for same "section"
        return aX - bX;
      }
      return yDiff;
    });
  }

  /**
   * Format text with approximate font sizes using headers
   */
  formatWithSize(text: string, fontSize: number | string): string {
    if (!fontSize || fontSize === 'normal') return text;
    
    const size = typeof fontSize === 'string' ? parseFloat(fontSize) : fontSize;
    
    // Map font sizes to markdown headers (approximate)
    if (size >= 24) return `# ${text}`;
    if (size >= 20) return `## ${text}`;
    if (size >= 16) return `### ${text}`;
    if (size >= 14) return `#### ${text}`;
    if (size <= 10) return `<small>${text}</small>`;
    
    return text;
  }

  /**
   * Process markdown formatting within table cells
   */
  private processCellFormatting(text: string): string {
    if (!text) return text;
    
    // Convert headers to bold text (since headers don't work well in table cells)
    text = text.replace(/^(#{1,6})\s+(.+)$/gm, (_match, hashes, content) => {
      const level = hashes.length;
      // Convert headers to bold text with size indicators
      if (level <= 2) {
        return `**${content.toUpperCase()}**`; // Major headers become uppercase bold
      } else {
        return `**${content}**`; // Minor headers become bold
      }
    });
    
    // Ensure bold and italic formatting is preserved
    // Bold: **text** or __text__
    text = text.replace(/\*\*([^*]+)\*\*/g, '**$1**');
    text = text.replace(/__([^_]+)__/g, '**$1**');
    
    // Italic: *text* or _text_ (but not within bold)
    text = text.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '*$1*');
    text = text.replace(/(?<!_)_([^_]+)_(?!_)/g, '*$1*');
    
    return text;
  }

  /**
   * Reset internal counters
   */
  reset(): void {
    this.tableCounter = 0;
  }

  /**
   * Get current table counter
   */
  get currentTableCount(): number {
    return this.tableCounter;
  }
}
