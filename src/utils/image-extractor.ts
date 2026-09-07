import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type JSZip from 'jszip';
import type { ImageData, ConvertOptions } from '../types/interfaces.js';
import { ImageExtractionError, SecurityError } from '../types/errors.js';
import {
  SecureZipExtractor,
  createZipSecurityConfig,
  sanitizeFilename
} from './zip-security.js';
import { escapeHtml, markdownUrl } from './markdown.js';
import { checkResources } from './resource-monitor.js';

const imageExtensions = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.webp',
  '.bmp',
  '.tif',
  '.tiff',
  '.avif',
  '.emf',
  '.wmf'
]);
const convertedExtensions = new Set(['.tif', '.tiff', '.avif']);

export class ImageExtractor {
  private readonly outputDir: string;
  private imageCounter = 0;
  private readonly extractedImages = new Map<string, string>();
  constructor(outputDir = 'images') {
    if (
      typeof outputDir !== 'string' ||
      !outputDir.trim() ||
      outputDir.includes('\0')
    ) {
      throw new SecurityError(
        'Invalid output directory',
        'INVALID_OUTPUT_PATH'
      );
    }
    // The output directory is caller-owned configuration, never a path from the document.
    this.outputDir = path.normalize(outputDir);
  }
  async extractImagesFromZip(
    zip: JSZip,
    basePath = '',
    options: ConvertOptions = {},
    extractor?: SecureZipExtractor
  ): Promise<readonly ImageData[]> {
    const secure =
      extractor ?? new SecureZipExtractor(createZipSecurityConfig(options));
    if (!extractor) await secure.validate(zip);
    const result: ImageData[] = [];
    for (const [filename, file] of Object.entries(zip.files)) {
      if (
        file.dir ||
        !filename.startsWith(basePath) ||
        !this.isImageFile(filename)
      )
        continue;
      const data = await secure.extractFile(file, filename);
      const savedPath = await this.saveImage(data, filename, basePath);
      if (savedPath) {
        const stat = await fs.stat(savedPath);
        result.push({
          originalPath: filename,
          savedPath,
          basePath,
          format: path.extname(savedPath).slice(1),
          size: stat.size
        });
      }
    }
    return result;
  }
  async saveImage(
    buffer: Buffer,
    originalPath: string,
    basePath = ''
  ): Promise<string | null> {
    checkResources();
    let extension = path.extname(originalPath).toLowerCase() || '.bin';
    let data = buffer;
    try {
      if (convertedExtensions.has(extension)) {
        const { default: sharp } = await import('sharp');
        data = await sharp(buffer, { limitInputPixels: 40_000_000 })
          .png()
          .toBuffer();
        extension = '.png';
      }
      // Keep unsupported formats honest: do not relabel WMF/EMF/BMP as PNG.
      checkResources();
      const basename = sanitizeFilename(
        path.basename(originalPath, path.extname(originalPath))
      );
      const digest = createHash('sha256').update(data).digest('hex');
      const filename = `${basename}-${digest}${extension}`;
      await fs.mkdir(this.outputDir, { recursive: true });
      checkResources();
      const fullPath = path.resolve(this.outputDir, filename);
      // Exclusive creation prevents overwriting existing files or following a file symlink.
      try {
        await fs.writeFile(fullPath, data, { flag: 'wx' });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const stat = await fs.lstat(fullPath);
        if (
          !stat.isFile() ||
          stat.isSymbolicLink() ||
          !data.equals(await fs.readFile(fullPath))
        ) {
          throw new ImageExtractionError(
            'An incompatible file already exists at the output path'
          );
        }
      }
      this.imageCounter++;
      this.extractedImages.set(originalPath, filename);
      this.extractedImages.set(basePath + originalPath, filename);
      return fullPath;
    } catch (error) {
      if (
        error instanceof SecurityError ||
        error instanceof ImageExtractionError
      )
        throw error;
      throw new ImageExtractionError(
        `Could not save ${path.basename(originalPath)}`,
        error as Error
      );
    }
  }
  isImageFile(filename: string): boolean {
    return imageExtensions.has(path.extname(filename).toLowerCase());
  }
  getImageReference(originalPath: string, basePath = ''): string | null {
    const filename =
      this.extractedImages.get(originalPath) ??
      this.extractedImages.get(basePath + originalPath);
    return filename
      ? `![Image](${markdownUrl(path.join(this.outputDir, filename))})`
      : null;
  }
  getImageMarkdown(description = 'Image', imagePath?: string): string {
    if (!imagePath) return '';
    const source = path.join(this.outputDir, path.basename(imagePath));
    return `<img src="${escapeHtml(markdownUrl(source))}" alt="${escapeHtml(description)}" style="max-width:100%;height:auto" />`;
  }
  reset(): void {
    this.imageCounter = 0;
    this.extractedImages.clear();
  }
  get imageDirectory(): string {
    return this.outputDir;
  }
  get currentImageCount(): number {
    return this.imageCounter;
  }
  get extractedImageMappings(): ReadonlyMap<string, string> {
    return this.extractedImages;
  }
}
