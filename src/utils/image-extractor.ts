import fs from 'node:fs';
import path from 'node:path';
import type JSZip from 'jszip';
import type { Buffer } from 'node:buffer';

import type { ImageData } from '../types/interfaces.js';
import { ImageExtractionError } from '../types/errors.js';

// Web-compatible image formats
const WEB_COMPATIBLE_FORMATS = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'];
// Formats that Sharp can convert
const SHARP_CONVERTIBLE_FORMATS = ['.bmp', '.tiff', '.tif', '.webp', '.avif'];
// Formats that need special handling (not supported by Sharp)
const NON_CONVERTIBLE_FORMATS = ['.wmf', '.emf'];

export class ImageExtractor {
  private readonly outputDir: string;
  private imageCounter: number = 0;
  private readonly extractedImages = new Map<string, string>();

  constructor(outputDir: string = 'images') {
    this.outputDir = outputDir;
    
    // Reset counter to ensure fresh start
    this.reset();
    
    // Create images directory if it doesn't exist
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * Extract images from a ZIP archive (DOCX, XLSX, PPTX)
   */
  async extractImagesFromZip(zip: JSZip, basePath: string = ''): Promise<readonly ImageData[]> {
    const images: {
      path: string;
      file: JSZip.JSZipObject;
      basePath: string;
    }[] = [];
    
    zip.forEach((relativePath, file) => {
      // Check for image files in common locations
      if (this.isImageFile(relativePath)) {
        images.push({
          path: relativePath,
          file,
          basePath
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
            savedPath,
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
   * Save an image buffer to disk, converting to web-compatible format if needed
   */
  async saveImage(buffer: Buffer, originalPath: string, basePath: string = ''): Promise<string | null> {
    this.imageCounter++;
    const originalExt = path.extname(originalPath).toLowerCase() || '.png';
        
    let finalBuffer = buffer;
    let finalExt = originalExt;
    
    try {
      // Check if we need to convert the image format
      if (WEB_COMPATIBLE_FORMATS.includes(originalExt)) {
        // Already web-compatible, use as-is
      } else if (SHARP_CONVERTIBLE_FORMATS.includes(originalExt)) {
        // Convert using Sharp
        finalBuffer = await this.convertImageToWebFormat(buffer);
        finalExt = '.png';
      } else if (NON_CONVERTIBLE_FORMATS.includes(originalExt)) {
        finalExt = '.png';
      } else {
        try {
          finalBuffer = await this.convertImageToWebFormat(buffer);
          finalExt = '.png';
        } catch (conversionError: unknown) {
          console.warn(`Sharp conversion failed for ${originalExt}, using original buffer with PNG extension:`, conversionError instanceof Error ? conversionError.message : 'Unknown error');
          finalExt = '.png';
        }
      }
      
      // Use the provided filename if it has an extension, otherwise generate one
      const providedName = path.basename(originalPath);
      const hasExtension = path.extname(providedName);
      const filename = hasExtension ? providedName : `image_${this.imageCounter}${finalExt}`;
      const fullPath = path.join(this.outputDir, filename);
            
      fs.writeFileSync(fullPath, finalBuffer);
      
      // Store mapping for reference lookup
      const key = basePath + originalPath;
      this.extractedImages.set(key, filename);
            
      // Return the full absolute path, not just the filename
      return path.resolve(fullPath);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new ImageExtractionError(`Failed to save image: ${message}`, error as Error);
    }
  }
  
  /**
   * Convert image buffer to web-compatible format using Sharp
   */
  private async convertImageToWebFormat(buffer: Buffer): Promise<Buffer> {
    try {
      // Dynamic import Sharp to handle potential loading issues
      const sharp = await import('sharp');
            
      // Convert to PNG with good compression
      const convertedBuffer = await sharp.default(buffer)
        .png({
          quality: 90,
          compressionLevel: 6,
        })
        .toBuffer();
        
      return convertedBuffer;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new ImageExtractionError(`Sharp conversion failed: ${message}`, error as Error);
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
           filePath.includes('/media/') || 
           filePath.includes('/images/');
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
   * Create markdown image reference using HTML img tag for better compatibility
   */
  getImageMarkdown(description: string = 'Image', imagePath?: string): string {
    if (imagePath) {
      // Use relative path - just the directory name, not the full path
      const relativePath = `./images/${imagePath}`;
      return `<img src="${relativePath}" alt="${description}" style="max-width:100%;height:auto" />`;
    }
    return `<img src="./image-not-found" alt="${description}" />`;
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
