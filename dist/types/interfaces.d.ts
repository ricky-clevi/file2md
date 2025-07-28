import type { Buffer } from 'node:buffer';
/**
 * Options for document conversion
 */
export interface ConvertOptions {
    /** Directory to save extracted images. Defaults to 'images' */
    readonly imageDir?: string;
    /** Whether to preserve document layout as much as possible. Defaults to true */
    readonly preserveLayout?: boolean;
    /** Whether to extract charts and convert them to markdown tables. Defaults to true */
    readonly extractCharts?: boolean;
    /** Whether to extract images from documents. Defaults to true */
    readonly extractImages?: boolean;
    /** Maximum number of pages to process for PDFs. Defaults to unlimited */
    readonly maxPages?: number;
}
/**
 * Metadata about the converted document
 */
export interface DocumentMetadata {
    /** Original file type detected */
    readonly fileType: string;
    /** MIME type of the original file */
    readonly mimeType: string;
    /** Number of pages/sheets/slides processed */
    readonly pageCount: number;
    /** Number of images extracted */
    readonly imageCount: number;
    /** Number of charts extracted */
    readonly chartCount: number;
    /** Processing time in milliseconds */
    readonly processingTime: number;
    /** Additional format-specific metadata */
    readonly additional?: Record<string, unknown>;
}
/**
 * Information about an extracted image
 */
export interface ImageData {
    /** Original path/reference in the document */
    readonly originalPath: string;
    /** Path where the image was saved */
    readonly savedPath: string;
    /** Base path for relative references */
    readonly basePath?: string;
    /** Image dimensions if available */
    readonly dimensions?: {
        readonly width: number;
        readonly height: number;
    };
    /** Image format (png, jpg, etc.) */
    readonly format?: string;
    /** Size of the image file in bytes */
    readonly size?: number;
}
/**
 * Information about an extracted chart
 */
export interface ChartData {
    /** Type of chart (bar, line, pie, scatter, etc.) */
    readonly type: ChartType;
    /** Chart title */
    readonly title: string;
    /** Chart data series */
    readonly series: readonly ChartSeries[];
    /** Category labels */
    readonly categories: readonly string[];
    /** Additional chart metadata */
    readonly metadata?: Record<string, unknown>;
}
/**
 * Supported chart types
 */
export type ChartType = 'bar' | 'line' | 'pie' | 'scatter' | 'area' | 'column' | 'unknown';
/**
 * Data series in a chart
 */
export interface ChartSeries {
    /** Series name */
    readonly name: string;
    /** Data values */
    readonly values: readonly number[];
    /** Categories for this series (if different from chart categories) */
    readonly categories?: readonly string[];
}
/**
 * Cell data in a table
 */
export interface CellData {
    /** Cell text content */
    text: string;
    /** Whether the cell text is bold */
    bold: boolean;
    /** Whether the cell text is italic */
    italic: boolean;
    /** Text alignment */
    alignment: TextAlignment;
    /** Background color (hex code) */
    backgroundColor?: string;
    /** Number of columns this cell spans */
    colSpan: number;
    /** Number of rows this cell spans */
    rowSpan: number;
    /** Whether this cell is part of a merged cell */
    merged?: boolean;
}
/**
 * Row data in a table
 */
export interface RowData {
    /** Cells in this row */
    cells: CellData[];
    /** Row height if available */
    height?: number;
}
/**
 * Table structure
 */
export interface TableData {
    /** All rows in the table */
    rows: RowData[];
    /** Table caption/title */
    caption?: string;
    /** Table width if available */
    width?: number;
}
/**
 * Text alignment options
 */
export type TextAlignment = 'left' | 'center' | 'right' | 'justify';
/**
 * Position information for layout elements
 */
export interface Position {
    /** X coordinate */
    x: number;
    /** Y coordinate */
    y: number;
    /** Width of the element */
    width?: number;
    /** Height of the element */
    height?: number;
}
/**
 * Layout element types
 */
export type ElementType = 'text' | 'image' | 'table' | 'chart' | 'shape' | 'unknown';
/**
 * Layout element with positioning
 */
export interface LayoutElement {
    /** Type of element */
    readonly type: ElementType;
    /** Element content */
    readonly content: string | TableData | ImageData | ChartData;
    /** Position of the element */
    readonly position?: Position;
    /** Additional formatting information */
    readonly formatting?: Record<string, unknown>;
}
/**
 * List item data
 */
export interface ListItem {
    /** List item text */
    readonly text: string;
    /** Nesting level (0-based) */
    readonly level: number;
    /** Whether the text is bold */
    readonly bold?: boolean;
    /** Whether the text is italic */
    readonly italic?: boolean;
    /** Child list items */
    readonly children?: readonly ListItem[];
}
/**
 * List data structure
 */
export interface ListData {
    /** Whether this is an ordered (numbered) list */
    readonly isOrdered: boolean;
    /** List items */
    readonly items: readonly ListItem[];
}
/**
 * Page information for PDFs
 */
export interface PageData {
    /** Page number (1-based) */
    readonly pageNumber: number;
    /** Path to the page image */
    readonly imagePath: string;
    /** Full path to the image file */
    readonly fullPath: string;
    /** Page dimensions */
    readonly dimensions?: {
        readonly width: number;
        readonly height: number;
    };
}
/**
 * Result of document conversion
 */
export interface ConversionResult {
    /** Generated markdown content */
    readonly markdown: string;
    /** Extracted images */
    readonly images: readonly ImageData[];
    /** Extracted charts */
    readonly charts: readonly ChartData[];
    /** Document metadata */
    readonly metadata: DocumentMetadata;
}
/**
 * Input type for conversion function
 */
export type ConvertInput = string | Buffer;
/**
 * Supported MIME types
 */
export declare const SUPPORTED_MIME_TYPES: {
    readonly PDF: "application/pdf";
    readonly DOCX: "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    readonly XLSX: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    readonly PPTX: "application/vnd.openxmlformats-officedocument.presentationml.presentation";
};
export type SupportedMimeType = typeof SUPPORTED_MIME_TYPES[keyof typeof SUPPORTED_MIME_TYPES];
//# sourceMappingURL=interfaces.d.ts.map