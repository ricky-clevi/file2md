import { promises as fs } from 'node:fs';
import { Buffer } from 'node:buffer';
import fileType from 'file-type';

import { ImageExtractor } from './utils/image-extractor.js';
import { ChartExtractor } from './utils/chart-extractor.js';
import { parsePdf } from './parsers/pdf-parser.js';
import { parseDocx } from './parsers/docx-parser.js';
import { parseXlsx } from './parsers/xlsx-parser.js';
import { parsePptx } from './parsers/pptx-parser.js';
import { parseHwp } from './parsers/hwp-parser.js';

// Security utilities
import { withResourceMonitoring, validateBuffer, createResourceMonitor } from './utils/resource-monitor.js';
import { createSecureXmlParser } from './utils/secure-xml-parser.js';
import { createZipSecurityConfig } from './utils/zip-security.js';

import {
  type ConvertInput,
  type ConvertOptions,
  type ConversionResult,
  type DocumentMetadata,
  type SupportedMimeType,
  FileNotFoundError,
  UnsupportedFormatError,
  InvalidFileError,
  SecurityError,
  ResourceLimitError,
  SUPPORTED_MIME_TYPES
} from './types/index.js';

/**
 * Detect HWP format based on file signature
 */
function detectHwpFormat(buffer: Buffer): 'hwp' | 'hwpx' | 'unknown' {
  if (buffer.length < 4) {
    return 'unknown';
  }

  // Check for CFB/OLE2 signature (HWP binary format)
  if (buffer.length >= 8) {
    const cfbSignature = buffer.subarray(0, 8);
    const expectedCfb = Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]);
    if (cfbSignature.equals(expectedCfb)) {
      return 'hwp';
    }
  }
  
  // Check for ZIP signature (HWPX format)
  const zipSignature = buffer.subarray(0, 4);
  const expectedZip = Buffer.from([0x50, 0x4B, 0x03, 0x04]);
  if (zipSignature.equals(expectedZip)) {
    return 'hwpx';
  }
  
  return 'unknown';
}

/**
 * Convert a document (PDF, DOCX, XLSX, PPTX, HWP, HWPX) to Markdown format
 * 
 * @param input - File path (string) or Buffer containing the document data
 * @param options - Conversion options
 * @returns Promise resolving to conversion result with markdown and metadata
 * 
 * @throws {FileNotFoundError} When file path doesn't exist
 * @throws {UnsupportedFormatError} When file format is not supported
 * @throws {InvalidFileError} When file is corrupted or invalid
 * @throws {ParseError} When document parsing fails
 * @throws {SecurityError} When security violations are detected
 * @throws {ResourceLimitError} When resource limits are exceeded
 * 
 * @example
 * ```typescript
 * // Convert from file path
 * const result = await convert('./document.pdf');
 * console.log(result.markdown);
 * 
 * // Convert from buffer with options
 * const buffer = await fs.readFile('./document.docx');
 * const result = await convert(buffer, {
 *   imageDir: 'extracted-images',
 *   preserveLayout: true
 * });
 * ```
 */
export async function convert(input: ConvertInput, options: ConvertOptions = {}): Promise<ConversionResult> {
  // Use resource monitoring for the entire conversion process
  return withResourceMonitoring(options, async (monitor) => {
    const startTime = Date.now();
    
    try {
      let buffer: Buffer;
      
      // Handle input type with security validation
      if (typeof input === 'string') {
        try {
          buffer = await fs.readFile(input);
        } catch (error: unknown) {
          if ((error as { code: string })?.code === 'ENOENT') {
            throw new FileNotFoundError(input);
          }
          // Sanitize error message to prevent path disclosure
          throw new InvalidFileError('Failed to read file', error as Error);
        }
      } else if (Buffer.isBuffer(input)) {
        buffer = input;
      } else {
        throw new InvalidFileError('Input must be a file path (string) or Buffer');
      }

      // Validate buffer for security
      validateBuffer(buffer, options);
      
      // Validate file size against resource limits
      monitor.validateFileSize(buffer);
      
      // Perform initial resource check
      monitor.performCheck();

      // Detect file type
      let detectedType = await fileType.fromBuffer(buffer);
      
      // Enhanced HWP/HWPX detection if file-type module fails or detects CFB/ZIP
      if (!detectedType || detectedType.mime === 'application/x-cfb' || detectedType.mime === 'application/zip') {
        const hwpFormat = detectHwpFormat(buffer);
        if (hwpFormat !== 'unknown') {
          detectedType = {
            ...detectedType,
            ext: hwpFormat as fileType.FileExtension,
            mime: `application/x-${hwpFormat}` as fileType.MimeType
          };
        } else if (!detectedType) {
          throw new UnsupportedFormatError('unknown');
        }
        // If it's CFB/ZIP but not HWP/HWPX, let it continue with the original detection
      }

      // Validate supported format
      const supportedMimeTypes = Object.values(SUPPORTED_MIME_TYPES);
      if (!supportedMimeTypes.includes(detectedType.mime as SupportedMimeType)) {
        throw new UnsupportedFormatError(detectedType.mime);
      }

      // Setup extractors with security configuration
      const {
        imageDir = 'images',
        outputDir = imageDir,
        preserveLayout = true,
        extractCharts = true,
        extractImages = true,
        maxPages
      } = options;

      // Create secure extractors
      const imageExtractor = new ImageExtractor(outputDir);
      const chartExtractor = new ChartExtractor(imageExtractor);
      
      // Configure security settings (for future use by parsers)
      const zipSecurityConfig = createZipSecurityConfig(options);
      const secureXmlParser = createSecureXmlParser(options);
      
      // Periodically check resource usage during processing
      monitor.performCheck();

      // Parse document based on type
      let markdown: string;
      let images: readonly import('./types/interfaces.js').ImageData[] = [];
      let charts: readonly import('./types/interfaces.js').ChartData[] = [];
      let pageCount = 1;
      let additionalMetadata: Record<string, unknown> = {};

      switch (detectedType.mime as SupportedMimeType) {
        case SUPPORTED_MIME_TYPES.PDF: {
          // Check resources before PDF processing
          monitor.performCheck();
          
          const result = await parsePdf(buffer, { maxPages, preserveLayout });
          markdown = result.markdown;
          images = result.images || [];
          pageCount = result.pageCount || 1;
          additionalMetadata = result.metadata || {};
          
          // Check resources after PDF processing
          monitor.performCheck();
          break;
        }
        
        case SUPPORTED_MIME_TYPES.DOCX: {
          // Check resources before DOCX processing
          monitor.performCheck();
          
          const result = await parseDocx(buffer, imageExtractor, chartExtractor, { 
            preserveLayout, 
            extractImages, 
            extractCharts 
          });
          markdown = result.markdown;
          images = result.images || [];
          charts = result.charts || [];
          additionalMetadata = result.metadata || {};
          
          // Check resources after DOCX processing
          monitor.performCheck();
          break;
        }
        
        case SUPPORTED_MIME_TYPES.XLSX: {
          // Check resources before XLSX processing
          monitor.performCheck();
          
          const result = await parseXlsx(buffer, imageExtractor, chartExtractor, { 
            preserveLayout, 
            extractCharts 
          });
          markdown = result.markdown;
          charts = result.charts || [];
          pageCount = result.sheetCount || 1;
          additionalMetadata = result.metadata || {};
          
          // Check resources after XLSX processing
          monitor.performCheck();
          break;
        }
        
        case SUPPORTED_MIME_TYPES.PPTX: {
          // Check resources before PPTX processing
          monitor.performCheck();
          
          const result = await parsePptx(buffer, imageExtractor, chartExtractor, {
            preserveLayout,
            extractImages,
            extractCharts,
            outputDir
          });
          markdown = result.markdown;
          images = result.images || [];
          charts = result.charts || [];
          pageCount = result.slideCount || 1;
          additionalMetadata = result.metadata || {};
          
          // Check resources after PPTX processing
          monitor.performCheck();
          break;
        }
        
        case SUPPORTED_MIME_TYPES.HWP:
        case SUPPORTED_MIME_TYPES.HWPX: {
          // Check resources before HWP processing
          monitor.performCheck();
          
          const result = await parseHwp(buffer, imageExtractor, chartExtractor, {
            preserveLayout,
            extractImages,
            extractCharts
          });
          markdown = result.markdown;
          images = result.images || [];
          charts = result.charts || [];
          pageCount = 1; // Single document
          additionalMetadata = result.metadata || {};
          
          // Check resources after HWP processing
          monitor.performCheck();
          break;
        }
      
        default: {
          // This should never happen due to earlier validation, but TypeScript requires it
          const exhaustiveCheck: never = detectedType.mime as never;
          throw new UnsupportedFormatError(exhaustiveCheck);
        }
      }

      const endTime = Date.now();
      
      // Final resource check
      monitor.performCheck();
      
      // Get resource statistics for metadata
      const resourceStats = monitor.getResourceStats();

      // Build metadata with security information
      const metadata: DocumentMetadata = {
        fileType: detectedType.ext.toUpperCase(),
        mimeType: detectedType.mime,
        pageCount,
        imageCount: images.length,
        chartCount: charts.length,
        processingTime: endTime - startTime,
        additional: {
          ...additionalMetadata,
          security: {
            memoryUsage: resourceStats.memoryUsage,
            memoryDelta: resourceStats.memoryDelta,
            resourceChecks: 'passed',
            securityFeatures: {
              zipBombProtection: options.maxExtractedSize !== undefined || options.maxExtractedFiles !== undefined,
              pathTraversalProtection: options.enablePathValidation !== false,
              xxeProtection: options.enableXXEProtection !== false,
              resourceLimits: options.maxFileSize !== undefined || options.maxMemoryUsage !== undefined
            }
          }
        }
      };

      return {
        markdown,
        images,
        charts,
        metadata
      };

    } catch (error: unknown) {
      // Re-throw known security and file errors
      if (error instanceof FileNotFoundError || 
          error instanceof UnsupportedFormatError || 
          error instanceof InvalidFileError ||
          error instanceof SecurityError ||
          error instanceof ResourceLimitError) {
        throw error;
      }
      
      // Wrap unknown errors with sanitized messages
      throw new InvalidFileError('Conversion failed due to an internal error', error as Error);
    }
  });
}

// Export types for consumers
export type * from './types/index.js';

// Export utility classes for advanced usage
export { ImageExtractor } from './utils/image-extractor.js';
export { ChartExtractor } from './utils/chart-extractor.js';
export { LayoutParser } from './utils/layout-parser.js';

// Export security utilities for advanced usage
export { ResourceMonitor } from './utils/resource-monitor.js';
export { SecureZipExtractor } from './utils/zip-security.js';
export { parseXmlSecure, parseXmlFastSecure } from './utils/secure-xml-parser.js';