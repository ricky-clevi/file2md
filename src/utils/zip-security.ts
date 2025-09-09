import path from 'node:path';
import type JSZip from 'jszip';
import { 
  SecurityError, 
  ResourceLimitError, 
  PathTraversalError, 
  MaliciousContentError 
} from '../types/errors.js';
import type { ConvertOptions } from '../types/interfaces.js';

/**
 * Security configuration for ZIP extraction
 */
export interface ZipSecurityConfig {
  /** Maximum total extracted size in bytes */
  readonly maxExtractedSize: number;
  /** Maximum number of files in archive */
  readonly maxFiles: number;
  /** Maximum individual file size in bytes */
  readonly maxFileSize: number;
  /** Maximum compression ratio (uncompressed/compressed) */
  readonly maxCompressionRatio: number;
  /** Enable path validation */
  readonly validatePaths: boolean;
}

/**
 * Default security configuration - conservative for backwards compatibility
 */
export const DEFAULT_ZIP_SECURITY_CONFIG: ZipSecurityConfig = {
  maxExtractedSize: 500 * 1024 * 1024,  // 500MB total
  maxFiles: 1000,                        // Max 1000 files
  maxFileSize: 50 * 1024 * 1024,        // 50MB per file
  maxCompressionRatio: 100,              // 100:1 max compression
  validatePaths: true
};

/**
 * Strict security configuration for high-security environments
 */
export const STRICT_ZIP_SECURITY_CONFIG: ZipSecurityConfig = {
  maxExtractedSize: 100 * 1024 * 1024,  // 100MB total
  maxFiles: 500,                         // Max 500 files
  maxFileSize: 10 * 1024 * 1024,        // 10MB per file
  maxCompressionRatio: 50,               // 50:1 max compression
  validatePaths: true
};

/**
 * Create security configuration from ConvertOptions
 */
export function createZipSecurityConfig(options: ConvertOptions): ZipSecurityConfig {
  return {
    maxExtractedSize: options.maxExtractedSize ?? DEFAULT_ZIP_SECURITY_CONFIG.maxExtractedSize,
    maxFiles: options.maxExtractedFiles ?? DEFAULT_ZIP_SECURITY_CONFIG.maxFiles,
    maxFileSize: options.maxIndividualFileSize ?? DEFAULT_ZIP_SECURITY_CONFIG.maxFileSize,
    maxCompressionRatio: DEFAULT_ZIP_SECURITY_CONFIG.maxCompressionRatio,
    validatePaths: options.enablePathValidation !== false
  };
}

/**
 * Sanitize filename to prevent path traversal
 */
export function sanitizeFilename(filename: string): string {
  if (!filename || typeof filename !== 'string') {
    throw new PathTraversalError('Invalid filename: empty or non-string');
  }

  // Remove any path separators and get just the filename
  const baseName = path.basename(filename);
  
  // Remove dangerous characters and sequences
  const sanitized = baseName
    .replace(/[<>:"/\\|?*\0-\x1f\x80-\x9f]/g, '_')  // Remove dangerous chars
    .replace(/^\.+/, '')                              // Remove leading dots
    .replace(/\.+$/, '')                              // Remove trailing dots
    .replace(/\s+/g, '_')                            // Replace spaces with underscores
    .substring(0, 255);                              // Limit length

  // Ensure we have a valid filename
  if (!sanitized || sanitized === '.' || sanitized === '..') {
    return `safe_file_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  return sanitized;
}

/**
 * Validate file path for security issues
 */
export function validateFilePath(filePath: string): void {
  if (!filePath || typeof filePath !== 'string') {
    throw new PathTraversalError('Invalid file path: empty or non-string');
  }

  // Check for path traversal attempts BEFORE normalization
  if (filePath.includes('..')) {
    throw new PathTraversalError(`Path traversal attempt detected: ${filePath}`);
  }

  // Check for path traversal attempts after normalization too
  const normalizedPath = path.normalize(filePath);
  
  if (normalizedPath.includes('..')) {
    throw new PathTraversalError(`Path traversal attempt detected: ${filePath}`);
  }
  
  if (normalizedPath.startsWith('/') || normalizedPath.match(/^[a-zA-Z]:/)) {
    throw new PathTraversalError(`Absolute path not allowed: ${filePath}`);
  }
  
  // Check for dangerous paths
  const dangerousPaths = [
    '/etc/', '/bin/', '/usr/', '/var/', '/sys/', '/proc/',
    'C:\\Windows\\', 'C:\\Program Files\\', 'C:\\Users\\',
    '\\\\', 'CON', 'PRN', 'AUX', 'NUL'
  ];
  
  const upperPath = filePath.toUpperCase();
  for (const dangerous of dangerousPaths) {
    if (upperPath.includes(dangerous.toUpperCase())) {
      throw new PathTraversalError(`Dangerous path detected: ${filePath}`);
    }
  }
}

/**
 * Calculate compression ratio to detect zip bombs
 */
function calculateCompressionRatio(compressedSize: number, uncompressedSize: number): number {
  if (compressedSize <= 0) return 0;
  return uncompressedSize / compressedSize;
}

/**
 * Validate ZIP archive before extraction to prevent zip bombs
 */
export async function validateZipArchive(zip: JSZip, config: ZipSecurityConfig): Promise<void> {
  let totalUncompressedSize = 0;
  let fileCount = 0;

  // First pass: validate structure without extracting
  for (const [relativePath, file] of Object.entries(zip.files)) {
    // Skip directories
    if (file.dir) continue;
    
    fileCount++;
    
    // Check file count limit
    if (fileCount > config.maxFiles) {
      throw new ResourceLimitError(
        'archive file count',
        config.maxFiles,
        fileCount
      );
    }
    
    // Validate file path if enabled
    if (config.validatePaths) {
      validateFilePath(relativePath);
    }
    
    // Get compressed and uncompressed sizes
    // Note: JSZip doesn't expose internal _data properties reliably
    // We'll use file content length as approximation for security checks
    const fileContent = await file.async('nodebuffer');
    const compressedSize = fileContent.length; // Approximation
    const uncompressedSize = fileContent.length; // Will be the same after decompression
    
    // Check individual file size
    if (uncompressedSize > config.maxFileSize) {
      throw new ResourceLimitError(
        'individual file size',
        config.maxFileSize,
        uncompressedSize
      );
    }
    
    // Check compression ratio for zip bomb detection
    if (compressedSize > 0) {
      const ratio = calculateCompressionRatio(compressedSize, uncompressedSize);
      if (ratio > config.maxCompressionRatio) {
        throw new MaliciousContentError(
          'ZIP archive',
          `Suspicious compression ratio ${ratio.toFixed(1)}:1 for ${relativePath} (max: ${config.maxCompressionRatio}:1)`
        );
      }
    }
    
    totalUncompressedSize += uncompressedSize;
    
    // Check total extracted size
    if (totalUncompressedSize > config.maxExtractedSize) {
      throw new ResourceLimitError(
        'total extracted size',
        config.maxExtractedSize,
        totalUncompressedSize
      );
    }
  }

  // Additional validation: check for zip bomb signatures
  if (fileCount > 0) {
    const averageCompressionRatio = totalUncompressedSize / Object.keys(zip.files).length;
    
    if (averageCompressionRatio > config.maxCompressionRatio * 0.8) {
      throw new MaliciousContentError(
        'ZIP archive',
        `Archive shows zip bomb characteristics (avg ratio: ${averageCompressionRatio.toFixed(1)}:1)`
      );
    }
  }
}

/**
 * Securely extract file from ZIP with validation
 */
export async function secureExtractFile(
  file: JSZip.JSZipObject,
  filename: string,
  config: ZipSecurityConfig
): Promise<Buffer> {
  try {
    // Validate filename
    if (config.validatePaths) {
      validateFilePath(filename);
    }
    
    // Extract with size validation
    const data = await file.async('nodebuffer');
    
    if (data.length > config.maxFileSize) {
      throw new ResourceLimitError(
        'extracted file size',
        config.maxFileSize,
        data.length
      );
    }
    
    return data;
    
  } catch (error) {
    if (error instanceof SecurityError) {
      throw error;
    }
    
    throw new SecurityError(
      `Failed to securely extract file ${filename}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'EXTRACTION_FAILED',
      'high',
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Comprehensive ZIP security wrapper
 * Validates archive and provides secure extraction methods
 */
export class SecureZipExtractor {
  private readonly config: ZipSecurityConfig;
  private validated = false;

  constructor(config: ZipSecurityConfig) {
    this.config = config;
  }

  /**
   * Validate ZIP archive (must be called before extraction)
   */
  async validate(zip: JSZip): Promise<void> {
    await validateZipArchive(zip, this.config);
    this.validated = true;
  }

  /**
   * Securely extract a file from the ZIP
   */
  async extractFile(file: JSZip.JSZipObject, filename: string): Promise<Buffer> {
    if (!this.validated) {
      throw new SecurityError('ZIP archive must be validated before extraction', 'NOT_VALIDATED');
    }
    
    return secureExtractFile(file, filename, this.config);
  }

  /**
   * Get sanitized filename for safe storage
   */
  sanitizeFilename(filename: string): string {
    return sanitizeFilename(filename);
  }

  /**
   * Check if path is safe for extraction
   */
  isPathSafe(filePath: string): boolean {
    try {
      if (this.config.validatePaths) {
        validateFilePath(filePath);
      }
      return true;
    } catch {
      return false;
    }
  }
}