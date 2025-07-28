/**
 * Base error class for all conversion-related errors
 */
export abstract class ConversionError extends Error {
  public readonly code: string;
  public readonly originalError?: Error;

  constructor(message: string, code: string, originalError?: Error) {
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
  constructor(mimeType: string, supportedFormats: readonly string[] = ['PDF', 'DOCX', 'XLSX', 'PPTX']) {
    super(
      `Unsupported file type: ${mimeType}. Supported formats: ${supportedFormats.join(', ')}`,
      'UNSUPPORTED_FORMAT'
    );
  }
}

/**
 * Thrown when a file cannot be found
 */
export class FileNotFoundError extends ConversionError {
  constructor(filePath: string) {
    super(`File not found: ${filePath}`, 'FILE_NOT_FOUND');
  }
}

/**
 * Thrown when a file is corrupted or invalid
 */
export class InvalidFileError extends ConversionError {
  constructor(reason: string, originalError?: Error) {
    super(`Invalid or corrupted file: ${reason}`, 'INVALID_FILE', originalError);
  }
}

/**
 * Thrown when file parsing fails
 */
export class ParseError extends ConversionError {
  public readonly fileType: string;

  constructor(fileType: string, reason: string, originalError?: Error) {
    super(`Failed to parse ${fileType}: ${reason}`, 'PARSE_ERROR', originalError);
    this.fileType = fileType;
  }
}

/**
 * Thrown when image extraction fails
 */
export class ImageExtractionError extends ConversionError {
  constructor(reason: string, originalError?: Error) {
    super(`Image extraction failed: ${reason}`, 'IMAGE_EXTRACTION_ERROR', originalError);
  }
}

/**
 * Thrown when chart extraction fails
 */
export class ChartExtractionError extends ConversionError {
  constructor(reason: string, originalError?: Error) {
    super(`Chart extraction failed: ${reason}`, 'CHART_EXTRACTION_ERROR', originalError);
  }
}

/**
 * Thrown when layout parsing fails
 */
export class LayoutParsingError extends ConversionError {
  constructor(reason: string, originalError?: Error) {
    super(`Layout parsing failed: ${reason}`, 'LAYOUT_PARSING_ERROR', originalError);
  }
}