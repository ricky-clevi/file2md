import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ImageExtractor } from './utils/image-extractor.js';
import { ChartExtractor } from './utils/chart-extractor.js';
import {
  withResourceMonitoring,
  validateBuffer,
  createResourceConfig,
  checkResources
} from './utils/resource-monitor.js';
import { loadArchive, type Archive } from './utils/zip-security.js';
import {
  type ConvertInput,
  type ConvertOptions,
  type ConversionResult,
  ConversionError,
  FileNotFoundError,
  InvalidFileError,
  UnsupportedFormatError,
  ResourceLimitError,
  SUPPORTED_MIME_TYPES
} from './types/index.js';

function validateOptions(options: ConvertOptions): void {
  if (!options || typeof options !== 'object' || Array.isArray(options))
    throw new InvalidFileError('Options must be an object');
  for (const name of [
    'maxPages',
    'maxFileSize',
    'maxMemoryUsage',
    'timeout',
    'maxExtractedFiles',
    'maxExtractedSize',
    'maxIndividualFileSize'
  ] as const) {
    const value = options[name];
    if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0))
      throw new InvalidFileError(`${name} must be a positive safe integer`);
  }
  for (const name of [
    'preserveLayout',
    'extractCharts',
    'extractImages',
    'enableXXEProtection',
    'enablePathValidation'
  ] as const) {
    if (options[name] !== undefined && typeof options[name] !== 'boolean')
      throw new InvalidFileError(`${name} must be a boolean`);
  }
}
async function readInput(
  input: ConvertInput,
  maximum: number
): Promise<Buffer> {
  if (Buffer.isBuffer(input)) return input;
  if (typeof input !== 'string')
    throw new InvalidFileError('Input must be a file path or Buffer');
  try {
    const handle = await fs.open(input, 'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile())
        throw new InvalidFileError('Input must be a regular file');
      if (stat.size > maximum)
        throw new ResourceLimitError('file size', maximum, stat.size);
      const chunks: Buffer[] = [];
      let length = 0;
      // Enforce the limit while reading as well, in case the file grows after stat.
      for await (const chunk of handle.createReadStream({ autoClose: false })) {
        checkResources();
        length += chunk.length;
        if (length > maximum)
          throw new ResourceLimitError('file size', maximum, length);
        chunks.push(chunk as Buffer);
      }
      return Buffer.concat(chunks, length);
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error instanceof ConversionError) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new FileNotFoundError(path.basename(input));
    throw new InvalidFileError('Could not read the input file', error as Error);
  }
}

/** Convert a local document to Markdown. Images are saved only when extracted. */
export async function convert(
  input: ConvertInput,
  options: ConvertOptions = {}
): Promise<ConversionResult> {
  validateOptions(options);
  return withResourceMonitoring(options, async (monitor) => {
    try {
      const buffer = await readInput(
        input,
        createResourceConfig(options).maxFileSize
      );
      validateBuffer(buffer, options);
      let format: keyof typeof SUPPORTED_MIME_TYPES;
      let archive: Archive | undefined;
      if (buffer.subarray(0, 1024).includes(Buffer.from('%PDF-')))
        format = 'PDF';
      else if (
        buffer
          .subarray(0, 8)
          .equals(
            Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
          ) &&
        buffer.includes(Buffer.from('HWP Document File'))
      )
        format = 'HWP';
      else if (buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 3, 4]))) {
        archive = await loadArchive(buffer, options);
        const candidates = [
          ['DOCX', 'word/document.xml'],
          ['XLSX', 'xl/workbook.xml'],
          ['PPTX', 'ppt/presentation.xml']
        ] as const;
        const zip = archive.zip;
        const detected = candidates.filter(([, file]) => zip.file(file));
        if (detected.length > 1)
          throw new InvalidFileError('Ambiguous document archive');
        if (detected.length === 1) format = detected[0][0];
        else if (
          archive.zip.file('Contents/content.hpf') &&
          archive.zip.file(/^Contents\/section\d+\.xml$/).length
        )
          format = 'HWPX';
        else throw new UnsupportedFormatError('ZIP archive');
      } else throw new UnsupportedFormatError('unknown');

      const outputDir = options.outputDir ?? options.imageDir ?? 'images';
      const images = new ImageExtractor(outputDir);
      const charts = new ChartExtractor(images);
      const parserOptions = { ...options, options };
      let result: {
        markdown: string;
        images?: readonly import('./types/interfaces.js').ImageData[];
        charts?: readonly import('./types/interfaces.js').ChartData[];
        metadata?: Record<string, unknown>;
      };
      let pageCount = 1;
      switch (format) {
        case 'PDF': {
          const { parsePdf } = await import('./parsers/pdf-parser.js');
          const parsed = await parsePdf(buffer, parserOptions);
          result = parsed;
          pageCount = parsed.pageCount;
          break;
        }
        case 'DOCX': {
          const { parseDocx } = await import('./parsers/docx-parser.js');
          result = await parseDocx(
            buffer,
            images,
            charts,
            parserOptions,
            archive
          );
          break;
        }
        case 'XLSX': {
          const { parseXlsx } = await import('./parsers/xlsx-parser.js');
          const parsed = await parseXlsx(
            buffer,
            images,
            charts,
            parserOptions,
            archive
          );
          result = parsed;
          pageCount = parsed.sheetCount;
          break;
        }
        case 'PPTX': {
          const { parsePptx } = await import('./parsers/pptx-parser.js');
          const parsed = await parsePptx(
            buffer,
            images,
            charts,
            parserOptions,
            archive
          );
          result = parsed;
          pageCount = parsed.slideCount;
          break;
        }
        case 'HWP':
        case 'HWPX': {
          const { parseHwp } = await import('./parsers/hwp-parser.js');
          result = await parseHwp(
            buffer,
            images,
            charts,
            parserOptions,
            archive
          );
          break;
        }
      }
      monitor.performCheck();
      const stats = monitor.getResourceStats();
      return {
        markdown: result.markdown,
        images: result.images ?? [],
        charts: result.charts ?? [],
        metadata: {
          fileType: format,
          mimeType: SUPPORTED_MIME_TYPES[format],
          pageCount,
          imageCount: result.images?.length ?? 0,
          chartCount: result.charts?.length ?? 0,
          processingTime: stats.elapsedTime,
          additional: {
            ...result.metadata,
            security: {
              memoryUsage: stats.memoryUsage,
              memoryDelta: stats.memoryDelta,
              resourceChecks: 'passed',
              securityFeatures: {
                zipBombProtection: !!archive,
                pathTraversalProtection: options.enablePathValidation !== false,
                xxeProtection: true,
                resourceLimits: true
              }
            }
          }
        }
      };
    } catch (error) {
      if (error instanceof ConversionError) throw error;
      throw new InvalidFileError('Conversion failed', error as Error);
    }
  });
}

export * from './types/index.js';
export { ImageExtractor } from './utils/image-extractor.js';
export { ChartExtractor } from './utils/chart-extractor.js';
export { LayoutParser } from './utils/layout-parser.js';
export { ResourceMonitor } from './utils/resource-monitor.js';
export { SecureZipExtractor } from './utils/zip-security.js';
export {
  parseXmlSecure,
  parseXmlFastSecure
} from './utils/secure-xml-parser.js';
