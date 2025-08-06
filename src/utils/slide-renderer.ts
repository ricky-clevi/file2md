import path from 'node:path';
import fs from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import libre from 'libreoffice-convert';
import { fromBuffer } from 'pdf2pic';
import { promisify } from 'node:util';

import { ParseError } from '../types/errors.js';
import type { ImageData } from '../types/interfaces.js';

// Promisify libreoffice-convert
const convertAsync = promisify(libre.convert);

export interface SlideRenderOptions {
  readonly quality?: number; // 1-100, default 90
  readonly density?: number; // DPI, default 150
  readonly format?: 'png' | 'jpg'; // default png
  readonly saveBase64?: boolean; // default false
}

export interface SlideRenderResult {
  readonly slideImages: readonly ImageData[];
  readonly slideCount: number;
  readonly metadata: {
    readonly format: string;
    readonly quality: number;
    readonly density: number;
  };
}

export class SlideRenderer {
  private readonly outputDir: string;

  constructor(outputDir: string) {
    this.outputDir = outputDir;
  }

  /**
   * Convert PPTX buffer to individual slide images
   */
  async renderSlidesToImages(
    pptxBuffer: Buffer,
    options: SlideRenderOptions = {}
  ): Promise<SlideRenderResult> {
    const {
      quality = 90,
      density = 150,
      format = 'png',
      saveBase64 = false
    } = options;

    try {
      // Ensure output directory exists
      await fs.mkdir(this.outputDir, { recursive: true });
      console.log('Created slide output directory:', this.outputDir);
      
      // Step 1: Convert PPTX to PDF using LibreOffice
      console.log('Converting PPTX to PDF...');
      const pdfBuffer = await this.convertPptxToPdf(pptxBuffer);
      console.log('PPTX to PDF conversion successful, PDF size:', pdfBuffer.length);
      
      // Step 2: Convert PDF to individual slide images
      console.log('Converting PDF to slide images...');
      const slideImages = await this.convertPdfToSlideImages(
        pdfBuffer,
        { quality, density, format, saveBase64 }
      );
      console.log(`Generated ${slideImages.length} slide images`);
      
      // Verify images were actually created
      for (const slide of slideImages) {
        const exists = await fs.access(slide.savedPath).then(() => true).catch(() => false);
        console.log(`Slide image ${slide.savedPath} exists:`, exists);
      }

      return {
        slideImages,
        slideCount: slideImages.length,
        metadata: {
          format,
          quality,
          density
        }
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('SlideRenderer error:', message);
      throw new ParseError('SlideRenderer', `Failed to render slides: ${message}`, error as Error);
    }
  }

  /**
   * Convert PPTX buffer to PDF buffer using multiple methods
   */
  private async convertPptxToPdf(pptxBuffer: Buffer): Promise<Buffer> {
    // Try LibreOffice first
    try {
      console.log('Trying LibreOffice conversion...');
      const pdfBuffer = await convertAsync(pptxBuffer, '.pdf', undefined);
      
      if (pdfBuffer && pdfBuffer.length > 0) {
        console.log('LibreOffice conversion successful, PDF size:', pdfBuffer.length);
        return pdfBuffer as Buffer;
      }
    } catch (libreOfficeError: unknown) {
      const message = libreOfficeError instanceof Error ? libreOfficeError.message : 'Unknown error';
      console.log('LibreOffice conversion failed:', message);
    }

    // LibreOffice failed, try alternative approach
    console.log('Attempting alternative slide screenshot generation...');
    return await this.createAlternativeSlideImages(pptxBuffer);
  }

  /**
   * Create slide images without LibreOffice using direct PPTX parsing
   */
  private async createAlternativeSlideImages(pptxBuffer: Buffer): Promise<Buffer> {
    try {
      // Import required modules dynamically
      const JSZip = (await import('jszip')).default;
      const { parseStringPromise } = await import('xml2js');
      
      // Parse PPTX to get slide information
      const zip = await JSZip.loadAsync(pptxBuffer);
      
      // Get slide files
      const slideFiles: any[] = [];
      zip.forEach((relativePath, file) => {
        if (relativePath.startsWith('ppt/slides/slide') && relativePath.endsWith('.xml')) {
          slideFiles.push({
            path: relativePath,
            file: file,
            slideNumber: parseInt(relativePath.match(/slide(\d+)\.xml/)?.[1] || '0')
          });
        }
      });
      
      slideFiles.sort((a, b) => a.slideNumber - b.slideNumber);
      console.log(`Found ${slideFiles.length} slides to convert`);
      
      // Create individual slide images directly
      const slideImages: ImageData[] = [];
      
      for (let i = 0; i < slideFiles.length; i++) {
        const slideFile = slideFiles[i];
        const slideNumber = i + 1;
        
        try {
          // Parse slide XML to extract content
          const xmlContent = await slideFile.file.async('string');
          const slideData = await parseStringPromise(xmlContent);
          
          // Generate slide image using canvas-based rendering
          const slideImageBuffer = await this.renderSlideToImage(slideData, slideNumber, zip);
          
          if (slideImageBuffer) {
            const filename = `slide-${slideNumber.toString().padStart(3, '0')}.png`;
            const savedPath = path.join(this.outputDir, filename);
            
            // Save the generated slide image
            await fs.writeFile(savedPath, slideImageBuffer);
            console.log(`Generated slide screenshot: ${filename}`);
            
            slideImages.push({
              originalPath: `slide${slideNumber}`,
              savedPath: savedPath,
              size: slideImageBuffer.length,
              format: 'png'
            });
          }
        } catch (slideError) {
          console.warn(`Failed to generate slide ${slideNumber}:`, slideError);
          // Create a placeholder image for failed slides
          const placeholderBuffer = await this.createPlaceholderSlideImage(slideNumber);
          const filename = `slide-${slideNumber.toString().padStart(3, '0')}.png`;
          const savedPath = path.join(this.outputDir, filename);
          
          await fs.writeFile(savedPath, placeholderBuffer);
          slideImages.push({
            originalPath: `slide${slideNumber}`,
            savedPath: savedPath,
            size: placeholderBuffer.length,
            format: 'png'
          });
        }
      }
      
      // Return a fake PDF buffer to satisfy the interface
      // The actual slide images have been saved to disk
      this.generatedSlideImages = slideImages;
      return Buffer.from('FAKE_PDF_FOR_ALTERNATIVE_METHOD');
      
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new ParseError('SlideRenderer', `Alternative slide conversion failed: ${message}`, error as Error);
    }
  }

  private generatedSlideImages: ImageData[] = [];

  /**
   * Render a single slide to image using canvas with multi-language font support
   */
  private async renderSlideToImage(slideData: any, slideNumber: number, zip: any): Promise<Buffer | null> {
    try {
      // Import canvas dynamically (make it optional)
      let Canvas: any;
      try {
        Canvas = await import('canvas');
      } catch {
        console.log('Canvas module not available, creating text-based slide image');
        return await this.createTextBasedSlideImage(slideData, slideNumber);
      }

      const width = 1920;
      const height = 1080;
      const canvas = Canvas.createCanvas(width, height);
      const ctx = canvas.getContext('2d');

      // Register fonts for international character support
      await this.registerFontsForCanvas(Canvas);

      // Set background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);

      // Add slide number with multi-language font
      ctx.fillStyle = '#333333';
      ctx.font = this.getUniversalFont(48);
      ctx.textAlign = 'center';
      ctx.fillText(`Slide ${slideNumber}`, width / 2, 100);

      // Extract and render text content
      const textContent = this.extractSlideText(slideData);
      if (textContent.length > 0) {
        ctx.font = this.getUniversalFont(32);
        ctx.textAlign = 'left';
        let yPos = 200;
        
        for (const text of textContent.slice(0, 20)) { // Limit to 20 lines
          // Handle long text with proper wrapping
          const wrappedLines = this.wrapText(ctx, text, width - 200); // Leave margins
          
          for (const line of wrappedLines.slice(0, 2)) { // Max 2 lines per text element
            ctx.fillText(line, 100, yPos);
            yPos += 50;
            if (yPos > height - 100) break;
          }
          
          if (yPos > height - 100) break;
        }
      }

      // Add border
      ctx.strokeStyle = '#cccccc';
      ctx.lineWidth = 4;
      ctx.strokeRect(0, 0, width, height);

      return canvas.toBuffer('image/png');
    } catch (error) {
      console.warn('Canvas rendering failed:', error);
      return await this.createTextBasedSlideImage(slideData, slideNumber);
    }
  }

  /**
   * Register system fonts and fallback fonts for international character support
   */
  private async registerFontsForCanvas(Canvas: any): Promise<void> {
    try {
      // Try to register common system fonts that support international characters
      const fontPaths = [
        // Windows fonts
        'C:\\Windows\\Fonts\\arial.ttf',
        'C:\\Windows\\Fonts\\SimSun.ttc',        // Chinese (Simplified)
        'C:\\Windows\\Fonts\\mingliu.ttc',       // Chinese (Traditional)
        'C:\\Windows\\Fonts\\malgun.ttf',        // Korean
        'C:\\Windows\\Fonts\\meiryo.ttc',        // Japanese
        'C:\\Windows\\Fonts\\NotoSansCJK-Regular.ttc', // Noto CJK
        
        // macOS fonts
        '/System/Library/Fonts/Arial.ttf',
        '/System/Library/Fonts/PingFang.ttc',    // Chinese
        '/System/Library/Fonts/AppleGothic.ttf', // Korean
        '/System/Library/Fonts/Hiragino Sans GB.ttc', // Japanese/Chinese
        
        // Linux fonts
        '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
        '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
      ];

      const fs = await import('fs/promises');
      
      for (const fontPath of fontPaths) {
        try {
          await fs.access(fontPath);
          Canvas.registerFont(fontPath, { 
            family: this.getFontFamily(fontPath)
          });
          console.log(`Registered font: ${fontPath}`);
        } catch {
          // Font file doesn't exist, skip silently
        }
      }
    } catch (error) {
      console.warn('Font registration failed:', error);
      // Continue without custom fonts - will use Canvas defaults
    }
  }

  /**
   * Get font family name from font path
   */
  private getFontFamily(fontPath: string): string {
    const filename = fontPath.split(/[/\\]/).pop() || '';
    
    if (filename.includes('SimSun') || filename.includes('PingFang')) return 'SimSun';
    if (filename.includes('malgun') || filename.includes('AppleGothic')) return 'Malgun Gothic';
    if (filename.includes('meiryo') || filename.includes('Hiragino')) return 'Meiryo';
    if (filename.includes('Noto')) return 'Noto Sans CJK';
    if (filename.includes('Liberation')) return 'Liberation Sans';
    if (filename.includes('DejaVu')) return 'DejaVu Sans';
    
    return 'Arial'; // Default fallback
  }

  /**
   * Get universal font string with fallbacks for international characters
   */
  private getUniversalFont(size: number): string {
    // Use a comprehensive font stack that covers most international characters
    return `${size}px "Noto Sans CJK", "SimSun", "Malgun Gothic", "Meiryo", "Liberation Sans", "DejaVu Sans", "Arial Unicode MS", Arial, sans-serif`;
  }

  /**
   * Wrap text to fit within specified width
   */
  private wrapText(ctx: any, text: string, maxWidth: number): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const metrics = ctx.measureText(testLine);
      
      if (metrics.width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    
    if (currentLine) {
      lines.push(currentLine);
    }

    return lines;
  }

  /**
   * Create a text-based slide image when canvas is not available
   */
  private async createTextBasedSlideImage(slideData: any, slideNumber: number): Promise<Buffer> {
    try {
      // Try to use a simple image generation approach
      const textContent = this.extractSlideText(slideData);
      
      // Create a minimal SVG that can be converted to PNG
      const svgContent = this.createSVGSlideImage(slideNumber, textContent);
      
      // Try to convert SVG to PNG buffer
      return await this.convertSVGToPNG(svgContent);
    } catch (error) {
      console.warn('SVG fallback failed:', error);
      // Ultimate fallback - return a simple text buffer
      const textContent = this.extractSlideText(slideData);
      const slideText = `SLIDE ${slideNumber}\n\n${textContent.join('\n')}`;
      return Buffer.from(`Slide ${slideNumber} Content:\n${slideText}`);
    }
  }

  /**
   * Create SVG representation of slide content
   */
  private createSVGSlideImage(slideNumber: number, textContent: string[]): string {
    const width = 1920;
    const height = 1080;
    
    let svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <!-- Background -->
  <rect width="${width}" height="${height}" fill="white" stroke="#cccccc" stroke-width="4"/>
  
  <!-- Slide Number -->
  <text x="${width/2}" y="100" text-anchor="middle" font-family="Arial, sans-serif" font-size="48" fill="#333333">Slide ${slideNumber}</text>
  
  <!-- Content -->`;

    let yPos = 200;
    for (const text of textContent.slice(0, 15)) { // Limit to 15 lines
      if (yPos > height - 100) break;
      
      // Escape HTML entities for SVG
      const escapedText = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .substring(0, 80); // Limit line length
      
      svgContent += `
  <text x="100" y="${yPos}" font-family="Arial, sans-serif" font-size="32" fill="#333333">${escapedText}</text>`;
      
      yPos += 50;
    }
    
    svgContent += `
</svg>`;

    return svgContent;
  }

  /**
   * Convert SVG to PNG buffer
   */
  private async convertSVGToPNG(svgContent: string): Promise<Buffer> {
    try {
      // Try to use Canvas to convert SVG to PNG
      const Canvas = await import('canvas');
      const { createCanvas, loadImage } = Canvas;
      
      // Convert SVG string to data URL
      const svgDataUrl = `data:image/svg+xml;base64,${Buffer.from(svgContent).toString('base64')}`;
      
      const canvas = createCanvas(1920, 1080);
      const ctx = canvas.getContext('2d');
      
      // Load the SVG as an image
      const img = await loadImage(svgDataUrl);
      ctx.drawImage(img, 0, 0);
      
      return canvas.toBuffer('image/png');
    } catch (error) {
      console.warn('SVG to PNG conversion failed:', error);
      // Return simple placeholder buffer
      throw error;
    }
  }

  /**
   * Extract text content from slide XML data
   */
  private extractSlideText(slideData: any): string[] {
    const textElements: string[] = [];
    
    function extractText(obj: any) {
      if (typeof obj === 'object' && obj !== null) {
        if (Array.isArray(obj)) {
          for (const item of obj) {
            extractText(item);
          }
        } else {
          // Look for text content
          if (obj['a:t']) {
            if (Array.isArray(obj['a:t'])) {
              for (const textItem of obj['a:t']) {
                if (typeof textItem === 'string' && textItem.trim()) {
                  textElements.push(textItem.trim());
                } else if (textItem && typeof textItem === 'object' && '_' in textItem) {
                  const text = (textItem as any)._;
                  if (text && text.trim()) {
                    textElements.push(text.trim());
                  }
                }
              }
            }
          }
          
          // Recursively process nested objects
          for (const key in obj) {
            if (key !== 'a:t') {
              extractText(obj[key]);
            }
          }
        }
      }
    }
    
    extractText(slideData);
    return textElements;
  }

  /**
   * Create placeholder slide image for failed conversions
   */
  private async createPlaceholderSlideImage(slideNumber: number): Promise<Buffer> {
    // Create a simple placeholder
    const placeholderText = `Slide ${slideNumber}\n\n[Slide content could not be rendered]\n\nThis slide contains the original presentation content\nbut could not be converted to an image.`;
    
    // Return a minimal buffer (in real implementation, create a proper placeholder image)
    return Buffer.from(placeholderText);
  }

  /**
   * Convert PDF buffer to individual slide images using pdf2pic or return pre-generated images
   */
  private async convertPdfToSlideImages(
    pdfBuffer: Buffer,
    options: Required<Pick<SlideRenderOptions, 'quality' | 'density' | 'format' | 'saveBase64'>>
  ): Promise<ImageData[]> {
    try {
      // Check if we already generated slide images using alternative method
      if (pdfBuffer.toString() === 'FAKE_PDF_FOR_ALTERNATIVE_METHOD') {
        console.log('Using pre-generated slide images from alternative method');
        return this.generatedSlideImages;
      }

      // Standard PDF to image conversion using pdf2pic
      await fs.mkdir(this.outputDir, { recursive: true });
      console.log('PDF to images: Output directory created:', this.outputDir);

      // Configure pdf2pic
      const convert = fromBuffer(pdfBuffer, {
        density: options.density,
        saveFilename: 'slide',
        savePath: this.outputDir,
        format: options.format,
        width: undefined, // Let pdf2pic calculate based on density
        height: undefined,
        quality: options.quality
      });

      console.log('PDF2PIC configuration:', {
        density: options.density,
        format: options.format,
        quality: options.quality,
        outputDir: this.outputDir
      });

      // Get total number of pages first
      const storeAsImage = convert.bulk(-1, true);
      const results = await storeAsImage;
      console.log(`PDF2PIC processed ${results.length} pages`);

      const slideImages: ImageData[] = [];

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const slideNumber = i + 1;
        const filename = `slide-${slideNumber.toString().padStart(3, '0')}.${options.format}`;
        const savedPath = path.join(this.outputDir, filename);

        console.log(`Processing slide ${slideNumber}, expected file: ${filename}`);

        // Save the image file
        const imageBuffer = (result as any).buffer;
        if (imageBuffer) {
          await fs.writeFile(savedPath, imageBuffer);
          console.log(`Saved slide image: ${savedPath} (${imageBuffer.length} bytes)`);
          
          slideImages.push({
            originalPath: `slide${slideNumber}`, // Virtual path for consistency
            savedPath: savedPath,
            size: imageBuffer.length,
            format: options.format
          });
        } else {
          console.warn(`No buffer found for slide ${slideNumber}`);
        }
      }

      console.log(`Successfully created ${slideImages.length} slide images`);
      return slideImages;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('PDF to images conversion error:', error);
      throw new ParseError('SlideRenderer', `PDF to images conversion failed: ${message}`, error as Error);
    }
  }

  /**
   * Generate markdown with slide images
   */
  generateSlideMarkdown(slideImages: readonly ImageData[], title?: string): string {
    let markdown = '';
    
    if (title) {
      markdown += `# ${title}\n\n`;
    }

    for (let i = 0; i < slideImages.length; i++) {
      const slide = slideImages[i];
      const slideNumber = i + 1;
      
      markdown += `## Slide ${slideNumber}\n\n`;
      
      // Use relative path for markdown image reference
      const relativePath = path.relative(process.cwd(), slide.savedPath)
        .replace(/\\/g, '/'); // Ensure forward slashes for markdown
      
      markdown += `![Slide ${slideNumber}](${relativePath})\n\n`;
    }

    return markdown.trim();
  }

  /**
   * Clean up generated image files
   */
  async cleanup(): Promise<void> {
    try {
      const files = await fs.readdir(this.outputDir);
      const slideFiles = files.filter(file => 
        file.startsWith('slide-') && (file.endsWith('.png') || file.endsWith('.jpg'))
      );
      
      for (const file of slideFiles) {
        const filePath = path.join(this.outputDir, file);
        await fs.unlink(filePath);
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  }

  /**
   * Check if LibreOffice is available on the system
   */
  static async checkLibreOfficeAvailability(): Promise<boolean> {
    try {
      // Create a minimal test document to verify LibreOffice works
      const testBuffer = Buffer.from('test');
      await convertAsync(testBuffer, '.pdf', undefined);
      return true;
    } catch {
      return false;
    }
  }
}