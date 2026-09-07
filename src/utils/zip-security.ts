import type { Readable } from 'node:stream';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import {
  SecurityError,
  ResourceLimitError,
  PathTraversalError,
  MaliciousContentError
} from '../types/errors.js';
import type { ConvertOptions } from '../types/interfaces.js';
import { checkResources } from './resource-monitor.js';

export interface ZipSecurityConfig {
  readonly maxExtractedSize: number;
  readonly maxFiles: number;
  readonly maxFileSize: number;
  readonly maxCompressionRatio: number;
  readonly validatePaths: boolean;
}
export const DEFAULT_ZIP_SECURITY_CONFIG: ZipSecurityConfig = {
  maxExtractedSize: 500 * 1024 * 1024,
  maxFiles: 1000,
  maxFileSize: 50 * 1024 * 1024,
  maxCompressionRatio: 100,
  validatePaths: true
};
export const STRICT_ZIP_SECURITY_CONFIG: ZipSecurityConfig = {
  maxExtractedSize: 100 * 1024 * 1024,
  maxFiles: 500,
  maxFileSize: 10 * 1024 * 1024,
  maxCompressionRatio: 50,
  validatePaths: true
};
export function createZipSecurityConfig(
  options: ConvertOptions
): ZipSecurityConfig {
  return {
    maxExtractedSize:
      options.maxExtractedSize ?? DEFAULT_ZIP_SECURITY_CONFIG.maxExtractedSize,
    maxFiles: options.maxExtractedFiles ?? DEFAULT_ZIP_SECURITY_CONFIG.maxFiles,
    maxFileSize:
      options.maxIndividualFileSize ?? DEFAULT_ZIP_SECURITY_CONFIG.maxFileSize,
    maxCompressionRatio: DEFAULT_ZIP_SECURITY_CONFIG.maxCompressionRatio,
    validatePaths: options.enablePathValidation !== false
  };
}
export function sanitizeFilename(filename: string): string {
  if (!filename || typeof filename !== 'string')
    throw new PathTraversalError('Invalid filename');
  const base = path.posix.basename(filename.replace(/\\/g, '/'));
  const safe = [...base]
    .map((c) =>
      c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 || /[<>:"/\\|?*]/.test(c)
        ? '_'
        : c
    )
    .join('')
    .replace(/^\.+|[. ]+$/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 180);
  let bounded = '';
  for (const character of safe) {
    if (Buffer.byteLength(bounded + character) > 120) break;
    bounded += character;
  }
  return bounded &&
    !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(bounded)
    ? bounded
    : `image-${randomUUID()}`;
}
export function validateFilePath(filename: string): void {
  if (
    !filename ||
    typeof filename !== 'string' ||
    [...filename].some((c) => c.charCodeAt(0) < 32)
  ) {
    throw new PathTraversalError('Invalid archive path');
  }
  const normalized = filename.replace(/\\/g, '/');
  if (
    normalized.startsWith('/') ||
    /^[a-z]:/i.test(normalized) ||
    normalized
      .split('/')
      .some(
        (segment) =>
          segment === '..' ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment) ||
          segment.includes(':')
      )
  ) {
    throw new PathTraversalError(filename);
  }
}

function limit(resource: string, actual: number, maximum: number): void {
  if (!Number.isFinite(maximum) || maximum <= 0)
    throw new SecurityError(`Invalid limit for ${resource}`, 'INVALID_LIMIT');
  if (actual > maximum) throw new ResourceLimitError(resource, maximum, actual);
}

// JSZip 3.x retains central-directory sizes on loaded entries. Keep this optional:
// programmatically constructed entries use the bounded stream fallback below.
function sizes(
  file: JSZip.JSZipObject
): { compressedSize: number; uncompressedSize: number } | undefined {
  const data = (
    file as unknown as {
      _data?: { compressedSize?: number; uncompressedSize?: number };
    }
  )._data;
  if (
    typeof data?.compressedSize === 'number' &&
    typeof data.uncompressedSize === 'number'
  ) {
    if (
      !Number.isSafeInteger(data.compressedSize) ||
      !Number.isSafeInteger(data.uncompressedSize) ||
      data.compressedSize < 0 ||
      data.uncompressedSize < 0
    ) {
      throw new SecurityError('Invalid ZIP entry size', 'INVALID_ARCHIVE');
    }
    return {
      compressedSize: data.compressedSize,
      uncompressedSize: data.uncompressedSize
    };
  }
  return undefined;
}

async function readBounded(
  file: JSZip.JSZipObject,
  maximum: number,
  collect: boolean
): Promise<{ size: number; data: Buffer }> {
  return new Promise((resolve, reject) => {
    const stream = file.nodeStream('nodebuffer') as Readable;
    const chunks: Buffer[] = [];
    let size = 0;
    stream.on('error', reject);
    stream.on('data', (chunk: Buffer) => {
      try {
        checkResources();
        size += chunk.length;
        limit('extracted file size', size, maximum);
        if (collect) chunks.push(chunk);
      } catch (error) {
        stream.pause();
        stream.destroy();
        reject(error);
      }
    });
    stream.on('end', () =>
      resolve({
        size,
        data: collect ? Buffer.concat(chunks, size) : Buffer.alloc(0)
      })
    );
  });
}

export async function validateZipArchive(
  zip: JSZip,
  config: ZipSecurityConfig
): Promise<void> {
  let total = 0;
  let count = 0;
  // Validate every original name; JSZip normalizes traversal out of file.name.
  for (const [name, file] of Object.entries(zip.files)) {
    checkResources();
    if (config.validatePaths) {
      validateFilePath(name);
      const original = (
        file as JSZip.JSZipObject & { unsafeOriginalName?: string }
      ).unsafeOriginalName;
      if (original) validateFilePath(original);
    }
    limit('archive file count', ++count, config.maxFiles);
    if (file.dir) continue;
    const info = sizes(file);
    const size =
      info?.uncompressedSize ??
      (
        await readBounded(
          file,
          Math.min(config.maxFileSize, config.maxExtractedSize - total),
          false
        )
      ).size;
    limit('individual file size', size, config.maxFileSize);
    total += size;
    limit('total extracted size', total, config.maxExtractedSize);
    if (
      info &&
      size > 0 &&
      size / Math.max(info.compressedSize, 1) > config.maxCompressionRatio
    ) {
      throw new MaliciousContentError(
        'ZIP archive',
        `Compression ratio exceeds ${config.maxCompressionRatio}:1`
      );
    }
  }
}

export async function secureExtractFile(
  file: JSZip.JSZipObject,
  filename: string,
  config: ZipSecurityConfig
): Promise<Buffer> {
  if (config.validatePaths) validateFilePath(filename);
  return (await readBounded(file, config.maxFileSize, true)).data;
}

export class SecureZipExtractor {
  private files = new Set<JSZip.JSZipObject>();
  private pending = new Map<JSZip.JSZipObject, Promise<Buffer>>();
  private extractedSize = 0;
  constructor(private readonly config: ZipSecurityConfig) {}
  async validate(zip: JSZip): Promise<void> {
    this.files.clear();
    this.pending.clear();
    this.extractedSize = 0;
    await validateZipArchive(zip, this.config);
    this.files = new Set(Object.values(zip.files));
  }
  async extractFile(
    file: JSZip.JSZipObject,
    filename: string
  ): Promise<Buffer> {
    if (!this.files.has(file))
      throw new SecurityError(
        'Entry is not part of the validated archive',
        'NOT_VALIDATED'
      );
    checkResources();
    if (!this.pending.has(file)) {
      this.pending.set(
        file,
        (async () => {
          const data = await secureExtractFile(file, filename, this.config);
          this.extractedSize += data.length;
          limit(
            'total extracted size',
            this.extractedSize,
            this.config.maxExtractedSize
          );
          return data;
        })()
      );
    }
    const result = this.pending.get(file);
    if (!result) throw new SecurityError('Missing extraction result');
    return result;
  }
  sanitizeFilename(filename: string): string {
    return sanitizeFilename(filename);
  }
  isPathSafe(filename: string): boolean {
    try {
      if (this.config.validatePaths) validateFilePath(filename);
      return true;
    } catch {
      return false;
    }
  }
}
export interface Archive {
  zip: JSZip;
  extractor: SecureZipExtractor;
}
export async function loadArchive(
  buffer: Buffer,
  options: ConvertOptions = {}
): Promise<Archive> {
  const zip = await JSZip.loadAsync(buffer);
  const extractor = new SecureZipExtractor(createZipSecurityConfig(options));
  await extractor.validate(zip);
  return { zip, extractor };
}
