import fs from 'node:fs';
import path from 'node:path';
import type JSZip from 'jszip';
import type { Buffer } from 'node:buffer';

import type { ImageData } from '../types/interfaces.js';
import { ImageExtractionError } from '../types/errors.js';

export class ImageExtractor {
  private readonly outputDir: string;
  private imageCounter: number = 0;
  private readonly extractedImages = new Map<string, string>();

  constructor(outputDir: string = 'images') {
    this.outputDir = outputDir;
    
    // Create images directory if it doesn't exist
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * Extract images from a ZIP archive (DOCX, XLSX, PPTX)
   */
  async extractImagesFromZip(zip: JSZip, basePath: string = ''): Promise<readonly ImageData[]> {
    const images: Array<{
      path: string;
      file: JSZip.JSZipObject;
      basePath: string;
    }> = [];
    
    zip.forEach((relativePath, file) => {
      // Check for image files in common locations
      if (this.isImageFile(relativePath)) {
        images.push({
          path: relativePath,
          file: file,
          basePath: basePath
        });
      }
    });

    const extractedImages: ImageData[] = [];
    for (const img of images) {
      try {
        const imageData = await img.file.async('nodebuffer');
        const savedPath = await this.saveImage(imageData, img.path, img.basePath);
        if (savedPath) {
          extractedImages.push({
            originalPath: img.path,
            savedPath: savedPath,
            basePath: img.basePath,
            format: this.getImageFormat(img.path),
            size: imageData.length
          });
        }
      } catch (error: unknown) {
        console.warn(`Failed to extract image ${img.path}:`, error instanceof Error ? error.message : 'Unknown error');
      }
    }

    return extractedImages;
  }

  /**
   * Save an image buffer to disk
   */
  async saveImage(buffer: Buffer, originalPath: string, basePath: string = ''): Promise<string | null> {
    this.imageCounter++;
    const ext = path.extname(originalPath) || '.png';
    const filename = `image_${this.imageCounter}${ext}`;
    const fullPath = path.join(this.outputDir, filename);
    
    try {
      fs.writeFileSync(fullPath, buffer);
      
      // Store mapping for reference lookup
      const key = basePath + originalPath;
      this.extractedImages.set(key, filename);
      
      return filename;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new ImageExtractionError(`Failed to save image ${filename}: ${message}`, error as Error);
    }
  }

  /**
   * Check if a file path represents an image
   */
  isImageFile(filePath: string): boolean {
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.svg', '.emf', '.wmf'];
    const ext = path.extname(filePath).toLowerCase();
    return imageExtensions.includes(ext) || 
           filePath.includes('/media/') || 
           filePath.includes('/images/') ||
           filePath.includes('\\media\\') || 
           filePath.includes('\\images\\');
  }

  /**
   * Get image format from file extension
   */
  private getImageFormat(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    return ext.startsWith('.') ? ext.slice(1) : 'unknown';
  }

  /**
   * Get markdown reference for an image by its original path
   */
  getImageReference(originalPath: string, basePath: string = ''): string | null {
    const key = basePath + originalPath;
    const savedFilename = this.extractedImages.get(key);
    if (savedFilename) {
      return `![Image](${this.outputDir}/${savedFilename})`;
    }
    return null;
  }

  /**
   * Create markdown image reference
   */
  getImageMarkdown(description: string = 'Image', imagePath?: string): string {
    if (imagePath) {
      return `![${description}](${this.outputDir}/${imagePath})`;
    }
    return `![${description}](image-not-found)`;
  }

  /**
   * Reset the image counter and clear extracted images map
   */
  reset(): void {
    this.imageCounter = 0;
    this.extractedImages.clear();
  }

  /**
   * Get the output directory for images
   */
  get imageDirectory(): string {
    return this.outputDir;
  }

  /**
   * Get the current image counter
   */
  get currentImageCount(): number {
    return this.imageCounter;
  }

  /**
   * Get all extracted image mappings
   */
  get extractedImageMappings(): ReadonlyMap<string, string> {
    return this.extractedImages;
  }
}