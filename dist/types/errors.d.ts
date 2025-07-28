/**
 * Base error class for all conversion-related errors
 */
export declare abstract class ConversionError extends Error {
    readonly code: string;
    readonly originalError?: Error;
    constructor(message: string, code: string, originalError?: Error);
}
/**
 * Thrown when a file format is not supported
 */
export declare class UnsupportedFormatError extends ConversionError {
    constructor(mimeType: string, supportedFormats?: readonly string[]);
}
/**
 * Thrown when a file cannot be found
 */
export declare class FileNotFoundError extends ConversionError {
    constructor(filePath: string);
}
/**
 * Thrown when a file is corrupted or invalid
 */
export declare class InvalidFileError extends ConversionError {
    constructor(reason: string, originalError?: Error);
}
/**
 * Thrown when file parsing fails
 */
export declare class ParseError extends ConversionError {
    readonly fileType: string;
    constructor(fileType: string, reason: string, originalError?: Error);
}
/**
 * Thrown when image extraction fails
 */
export declare class ImageExtractionError extends ConversionError {
    constructor(reason: string, originalError?: Error);
}
/**
 * Thrown when chart extraction fails
 */
export declare class ChartExtractionError extends ConversionError {
    constructor(reason: string, originalError?: Error);
}
/**
 * Thrown when layout parsing fails
 */
export declare class LayoutParsingError extends ConversionError {
    constructor(reason: string, originalError?: Error);
}
//# sourceMappingURL=errors.d.ts.map