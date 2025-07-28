import type { TableData, ListData, Position } from '../types/interfaces.js';
export interface TableFormatOptions {
    readonly preserveAlignment?: boolean;
    readonly showBorders?: boolean;
    readonly preserveColors?: boolean;
}
export interface ColumnData {
    readonly content: string;
}
export declare class LayoutParser {
    private tableCounter;
    /**
     * Parse an advanced table with merged cells and styling
     */
    parseAdvancedTable(tableData: TableData, options?: TableFormatOptions): string;
    /**
     * Parse lists with proper nesting
     */
    parseList(listData: ListData): string;
    /**
     * Create text box representation
     */
    createTextBox(content: string, position?: Position): string;
    /**
     * Create multi-column layout approximation
     */
    createColumns(columns: readonly ColumnData[]): string;
    /**
     * Parse headers and footers
     */
    parseHeaderFooter(content: string, type?: 'header' | 'footer'): string;
    /**
     * Create divider/separator
     */
    createDivider(style?: 'simple' | 'thick' | 'dashed' | 'dotted'): string;
    /**
     * Calculate relative positioning for layout elements
     */
    calculateRelativePosition<T extends {
        position?: Position;
    }>(elements: readonly T[]): T[];
    /**
     * Format text with approximate font sizes using headers
     */
    formatWithSize(text: string, fontSize: number | string): string;
    /**
     * Reset internal counters
     */
    reset(): void;
    /**
     * Get current table counter
     */
    get currentTableCount(): number;
}
//# sourceMappingURL=layout-parser.d.ts.map