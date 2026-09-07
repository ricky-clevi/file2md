import { ResourceLimitError } from '../types/errors.js';
import { checkResources } from './resource-monitor.js';
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
  parseAdvancedTable(
    tableData: TableData,
    options: TableFormatOptions = {}
  ): string {
    if (!tableData.rows?.length) return '';
    this.tableCounter++;
    const grid: (import('../types/interfaces.js').CellData | undefined)[][] =
      [];
    const occupied = new Set<string>();
    for (const [rowIndex, row] of tableData.rows.entries()) {
      checkResources();
      const target = (grid[rowIndex] ??= []);
      let column = 0;
      for (const cell of row.cells ?? []) {
        while (occupied.has(`${rowIndex}:${column}`)) column++;
        target[column] = cell;
        const colSpan = Math.max(
          1,
          Math.min(1000, Math.trunc(cell?.colSpan || 1))
        );
        const rowSpan = Math.max(
          1,
          Math.min(
            tableData.rows.length - rowIndex,
            Math.trunc(cell?.rowSpan || 1)
          )
        );
        const area = (column + colSpan) * tableData.rows.length;
        if (area > 1_000_000)
          throw new ResourceLimitError('rendered table cells', 1_000_000, area);
        for (let r = 1; r < rowSpan; r++) {
          for (let c = 0; c < colSpan; c++)
            occupied.add(`${rowIndex + r}:${column + c}`);
        }
        column += colSpan;
        target.length = Math.max(target.length, column);
      }
    }
    const width = grid.reduce((max, row) => Math.max(max, row.length), 0);
    if (!width) return '';
    const lines: string[] = [];
    for (const [index, row] of grid.entries()) {
      checkResources();
      const cells = Array.from({ length: width }, (_, col) => {
        const cell = row[col];
        if (!cell) return '';
        let value = this.processCellFormatting(cell.text || '')
          .replace(/(\\*)\|/g, (_match, slashes: string) =>
            slashes.length % 2 ? `${slashes}|` : `${slashes}\\|`
          )
          .replace(/\r?\n/g, '<br>');
        if (cell.bold && !value.includes('**')) value = `**${value}**`;
        if (cell.italic && !value.includes('*')) value = `*${value}*`;
        if (
          options.preserveColors &&
          /^[0-9a-f]{6,8}$/i.test(cell.backgroundColor || '')
        )
          value += ` <!-- bg:${cell.backgroundColor} -->`;
        return value;
      });
      lines.push(`| ${cells.join(' | ')} |`);
      if (index === 0)
        lines.push(
          `| ${Array.from({ length: width }, (_, col) => {
            const align =
              options.preserveAlignment === false
                ? 'left'
                : row[col]?.alignment;
            return align === 'center'
              ? ':---:'
              : align === 'right'
                ? '---:'
                : '---';
          }).join(' | ')} |`
        );
    }
    return `${lines.join('\n')}\n`;
  }

  /**
   * Parse lists with proper nesting
   */
  parseList(listData: ListData): string {
    if (!listData.items || listData.items.length === 0) return '';

    const processListItems = (
      items: readonly ListItem[],
      level: number = 0
    ): string => {
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
    const substantialColumns = columns.filter(
      (col) => col.content && col.content.trim().length > 10
    );

    if (substantialColumns.length <= 1) {
      // Just concatenate content with line breaks
      return columns
        .map((col) => col.content || '')
        .filter((c) => c.trim())
        .join('\n\n');
    }

    // Only create table format if we have 2-4 substantial columns
    if (substantialColumns.length > 4) {
      return substantialColumns.map((col) => col.content || '').join('\n\n');
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
      markdown += ` ${content.replace(/\n/g, '<br>')} |`;
    }
    markdown += '\n';

    return `${markdown}\n`;
  }

  /**
   * Parse headers and footers
   */
  parseHeaderFooter(
    content: string,
    type: 'header' | 'footer' = 'header'
  ): string {
    if (!content) return '';

    const marker = type === 'header' ? '🔝' : '🔻';
    return `<!-- Document ${type} -->\n> ${marker} ${content}\n\n`;
  }

  /**
   * Create divider/separator
   */
  createDivider(
    style: 'simple' | 'thick' | 'dashed' | 'dotted' = 'simple'
  ): string {
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
  calculateRelativePosition<T extends { position?: Position }>(
    elements: readonly T[]
  ): T[] {
    // Sort elements by their Y position primarily, with much larger threshold for "same row"
    return [...elements].sort((a, b) => {
      const aY = a.position?.y || 0;
      const bY = b.position?.y || 0;
      const aX = a.position?.x || 0;
      const bX = b.position?.x || 0;

      const yDiff = aY - bY;
      // Increase threshold significantly to avoid over-segmentation
      if (Math.abs(yDiff) < 200) {
        // Much larger tolerance for same "section"
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
    text = text.replace(/^(#{1,6})\s+(.+)$/gm, (_match, _hashes, content) => {
      return `**${content}**`;
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
