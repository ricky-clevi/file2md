/**
 * Base error class for all conversion-related errors
 */
export class ConversionError extends Error {
    code;
    originalError;
    constructor(message, code, originalError) {
        super(message);
        this.name = this.constructor.name;
        this.code = code;
        this.originalError = originalError;
        // Maintain proper stack trace for where our error was thrown (only available on V8)
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }
}
/**
 * Thrown when a file format is not supported
 */
export class UnsupportedFormatError extends ConversionError {
    constructor(mimeType, supportedFormats = ['PDF', 'DOCX', 'XLSX', 'PPTX']) {
        super(`Unsupported file type: ${mimeType}. Supported formats: ${supportedFormats.join(', ')}`, 'UNSUPPORTED_FORMAT');
    }
}
/**
 * Thrown when a file cannot be found
 */
export class FileNotFoundError extends ConversionError {
    constructor(filePath) {
        super(`File not found: ${filePath}`, 'FILE_NOT_FOUND');
    }
}
/**
 * Thrown when a file is corrupted or invalid
 */
export class InvalidFileError extends ConversionError {
    constructor(reason, originalError) {
        super(`Invalid or corrupted file: ${reason}`, 'INVALID_FILE', originalError);
    }
}
/**
 * Thrown when file parsing fails
 */
export class ParseError extends ConversionError {
    fileType;
    constructor(fileType, reason, originalError) {
        super(`Failed to parse ${fileType}: ${reason}`, 'PARSE_ERROR', originalError);
        this.fileType = fileType;
    }
}
/**
 * Thrown when image extraction fails
 */
export class ImageExtractionError extends ConversionError {
    constructor(reason, originalError) {
        super(`Image extraction failed: ${reason}`, 'IMAGE_EXTRACTION_ERROR', originalError);
    }
}
/**
 * Thrown when chart extraction fails
 */
export class ChartExtractionError extends ConversionError {
    constructor(reason, originalError) {
        super(`Chart extraction failed: ${reason}`, 'CHART_EXTRACTION_ERROR', originalError);
    }
}
/**
 * Thrown when layout parsing fails
 */
export class LayoutParsingError extends ConversionError {
    constructor(reason, originalError) {
        super(`Layout parsing failed: ${reason}`, 'LAYOUT_PARSING_ERROR', originalError);
    }
}
//# sourceMappingURL=errors.js.map