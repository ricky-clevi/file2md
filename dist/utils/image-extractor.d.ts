import type JSZip from 'jszip';
import type { Buffer } from 'node:buffer';
import type { ImageData } from '../types/interfaces.js';
export declare class ImageExtractor {
    private readonly outputDir;
    private imageCounter;
    private readonly extractedImages;
    constructor(outputDir?: string);
    /**
     * Extract images from a ZIP archive (DOCX, XLSX, PPTX)
     */
    extractImagesFromZip(zip: JSZip, basePath?: string): Promise<readonly ImageData[]>;
    /**
     * Save an image buffer to disk
     */
    saveImage(buffer: Buffer, originalPath: string, basePath?: string): Promise<string | null>;
    /**
     * Check if a file path represents an image
     */
    isImageFile(filePath: string): boolean;
    /**
     * Get image format from file extension
     */
    private getImageFormat;
    /**
     * Get markdown reference for an image by its original path
     */
    getImageReference(originalPath: string, basePath?: string): string | null;
    /**
     * Create markdown image reference
     */
    getImageMarkdown(description?: string, imagePath?: string): string;
    /**
     * Reset the image counter and clear extracted images map
     */
    reset(): void;
    /**
     * Get the output directory for images
     */
    get imageDirectory(): string;
    /**
     * Get the current image counter
     */
    get currentImageCount(): number;
    /**
     * Get all extracted image mappings
     */
    get extractedImageMappings(): ReadonlyMap<string, string>;
}
//# sourceMappingURL=image-extractor.d.ts.map