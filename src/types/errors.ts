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
  constructor(mimeType: string, supportedFormats: readonly string[] = ['PDF', 'DOCX', 'XLSX', 'PPTX', 'HWP', 'HWPX']) {
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

/**
 * Thrown when security violations are detected
 */
export class SecurityError extends ConversionError {
  public readonly securityCode: string;
  public readonly severity: 'low' | 'medium' | 'high' | 'critical';

  constructor(
    message: string, 
    securityCode: string = 'SECURITY_VIOLATION', 
    severity: 'low' | 'medium' | 'high' | 'critical' = 'high',
    originalError?: Error
  ) {
    super(`Security violation: ${message}`, 'SECURITY_ERROR', originalError);
    this.securityCode = securityCode;
    this.severity = severity;
  }
}

/**
 * Thrown when resource limits are exceeded
 */
export class ResourceLimitError extends SecurityError {
  public readonly resourceType: string;
  public readonly limit: number;
  public readonly actual: number;

  constructor(
    resourceType: string,
    limit: number,
    actual: number,
    originalError?: Error
  ) {
    super(
      `Resource limit exceeded for ${resourceType}: ${actual} > ${limit}`,
      'RESOURCE_LIMIT_EXCEEDED',
      'high',
      originalError
    );
    this.resourceType = resourceType;
    this.limit = limit;
    this.actual = actual;
  }
}

/**
 * Thrown when path traversal attempts are detected
 */
export class PathTraversalError extends SecurityError {
  public readonly attemptedPath: string;

  constructor(attemptedPath: string, originalError?: Error) {
    super(
      `Path traversal attempt detected: ${attemptedPath}`,
      'PATH_TRAVERSAL_ATTEMPT',
      'critical',
      originalError
    );
    this.attemptedPath = attemptedPath;
  }
}

/**
 * Thrown when malicious content is detected
 */
export class MaliciousContentError extends SecurityError {
  public readonly contentType: string;
  public readonly details: string;

  constructor(
    contentType: string,
    details: string,
    originalError?: Error
  ) {
    super(
      `Malicious content detected in ${contentType}: ${details}`,
      'MALICIOUS_CONTENT_DETECTED',
      'critical',
      originalError
    );
    this.contentType = contentType;
    this.details = details;
  }
}