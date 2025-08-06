import path from 'node:path';
import fs from 'node:fs/promises';
import { Buffer } from 'node:buffer';

import { ParseError } from '../types/errors.js';
import type { ImageData } from '../types/interfaces.js';
import type { SlideLayout } from './pptx-visual-parser.js';

export interface PuppeteerRenderOptions {
  readonly width?: number; // Default 1920
  readonly height?: number; // Default 1080
  readonly quality?: number; // 1-100, default 90
  readonly format?: 'png' | 'jpeg'; // default png
  readonly deviceScaleFactor?: number; // Default 2 for high DPI
  readonly timeout?: number; // Default 30000ms
  readonly headless?: boolean; // Default true
}

export interface PuppeteerRenderResult {
  readonly slideImages: readonly ImageData[];
  readonly slideCount: number;
  readonly metadata: {
    readonly renderMethod: 'puppeteer';
    readonly width: number;
    readonly height: number;
    readonly quality: number;
    readonly format: string;
  };
}

// Type definition for dynamic Puppeteer import
interface PuppeteerModule {
  launch: (options?: any) => Promise<any>;
  // Add other Puppeteer methods as needed
}

export class PuppeteerRenderer {
  private readonly outputDir: string;
  private puppeteer: PuppeteerModule | null = null;
  private browser: any = null;

  constructor(outputDir: string) {
    this.outputDir = outputDir;
  }

  /**
   * Initialize Puppeteer (lazy loading to avoid dependency issues)
   */
  private async initializePuppeteer(): Promise<void> {
    if (this.puppeteer) {
      return;
    }

    try {
      const puppeteerModule = await Function('return import("puppeteer")')();
      this.puppeteer = puppeteerModule as PuppeteerModule;
      console.log('Puppeteer initialized successfully');
    } catch (error) {
      throw new ParseError('PuppeteerRenderer', 'Puppeteer not available. Install with: npm install puppeteer', error as Error);
    }
  }

  /**
   * Launch browser instance
   */
  private async launchBrowser(options: PuppeteerRenderOptions): Promise<void> {
    if (this.browser) {
      return;
    }

    await this.initializePuppeteer();

    try {
      this.browser = await this.puppeteer.launch({
        headless: options.headless !== false ? 'new' : false,
        defaultViewport: {
          width: options.width || 1920,
          height: options.height || 1080,
          deviceScaleFactor: options.deviceScaleFactor || 2
        },
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor',
          '--font-render-hinting=none'
        ]
      });
      
      console.log('Puppeteer browser launched successfully');
    } catch (error) {
      throw new ParseError('PuppeteerRenderer', 'Failed to launch Puppeteer browser', error as Error);
    }
  }

  /**
   * Render slides using visual layouts in browser
   */
  async renderSlidesFromLayouts(
    visualLayouts: readonly SlideLayout[],
    options: PuppeteerRenderOptions = {}
  ): Promise<PuppeteerRenderResult> {
    const {
      width = 1920,
      height = 1080,
      quality = 90,
      format = 'png',
      deviceScaleFactor = 2,
      timeout = 30000
    } = options;

    try {
      // Ensure output directory exists
      await fs.mkdir(this.outputDir, { recursive: true });
      console.log('Created Puppeteer output directory:', this.outputDir);

      // Launch browser
      await this.launchBrowser(options);

      // Create a new page
      const page = await this.browser.newPage();
      await page.setViewport({ width, height, deviceScaleFactor });

      const slideImages: ImageData[] = [];

      // Render each slide
      for (let i = 0; i < visualLayouts.length; i++) {
        const layout = visualLayouts[i];
        const slideNumber = i + 1;

        try {
          console.log(`Rendering slide ${slideNumber} with Puppeteer...`);

          // Generate HTML for this slide
          const slideHtml = this.generateSlideHtml(layout, { width, height });

          // Load HTML content
          await page.setContent(slideHtml, {
            waitUntil: 'networkidle0',
            timeout
          });

          // Wait for any fonts to load
          await page.waitForTimeout(1000);

          // Take screenshot
          const filename = `slide-${slideNumber.toString().padStart(3, '0')}.${format}`;
          const savedPath = path.join(this.outputDir, filename);

          const screenshotBuffer = await page.screenshot({
            path: savedPath,
            type: format,
            quality: format === 'jpeg' ? quality : undefined,
            fullPage: false,
            clip: {
              x: 0,
              y: 0,
              width,
              height
            }
          });

          // Verify file was created
          const stats = await fs.stat(savedPath);
          console.log(`Puppeteer rendered slide ${slideNumber}: ${savedPath} (${stats.size} bytes)`);

          slideImages.push({
            originalPath: `slide${slideNumber}`,
            savedPath,
            size: stats.size,
            format
          });

        } catch (slideError) {
          console.warn(`Failed to render slide ${slideNumber} with Puppeteer:`, slideError);
          // Continue with other slides
        }
      }

      await page.close();

      return {
        slideImages,
        slideCount: slideImages.length,
        metadata: {
          renderMethod: 'puppeteer',
          width,
          height,
          quality,
          format
        }
      };

    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new ParseError('PuppeteerRenderer', `Puppeteer rendering failed: ${message}`, error as Error);
    }
  }

  /**
   * Generate HTML content for a slide
   */
  private generateSlideHtml(layout: SlideLayout, dimensions: { width: number; height: number }): string {
    const { width, height } = dimensions;

    // Convert EMU to pixels (1 EMU = 1/914400 inches, assume 96 DPI)
    const emuToPixels = (emu: number) => Math.round(emu / 914400 * 96);

    const slideWidth = emuToPixels(layout.dimensions.width);
    const slideHeight = emuToPixels(layout.dimensions.height);

    // Scale factor to fit slide into viewport
    const scaleX = width / slideWidth;
    const scaleY = height / slideHeight;
    const scale = Math.min(scaleX, scaleY);

    const scaledWidth = slideWidth * scale;
    const scaledHeight = slideHeight * scale;

    let elementsHtml = '';

    // Render each element
    for (const element of layout.elements) {
      const elementHtml = this.renderElement(element, scale);
      if (elementHtml) {
        elementsHtml += elementHtml;
      }
    }

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Slide ${layout.slideNumber}</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Arial:wght@400;700&family=Helvetica:wght@400;700&family=Times+New+Roman:wght@400;700&family=Calibri:wght@400;700&display=swap');
        
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            width: ${width}px;
            height: ${height}px;
            background: ${layout.background?.color || '#FFFFFF'};
            font-family: 'Calibri', 'Arial', sans-serif;
            overflow: hidden;
            position: relative;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        .slide-container {
            width: ${scaledWidth}px;
            height: ${scaledHeight}px;
            position: relative;
            background: ${layout.background?.color || '#FFFFFF'};
            border: 1px solid #e0e0e0;
        }
        
        .slide-element {
            position: absolute;
            overflow: hidden;
        }
        
        .text-element {
            font-size: 16px;
            line-height: 1.2;
            color: #000000;
            word-wrap: break-word;
            display: flex;
            align-items: center;
            padding: 4px;
        }
        
        .shape-element {
            border: 1px solid #666666;
            background: #f0f0f0;
        }
        
        .image-placeholder {
            background: linear-gradient(45deg, #f0f0f0 25%, transparent 25%), 
                        linear-gradient(-45deg, #f0f0f0 25%, transparent 25%),
                        linear-gradient(45deg, transparent 75%, #f0f0f0 75%), 
                        linear-gradient(-45deg, transparent 75%, #f0f0f0 75%);
            background-size: 20px 20px;
            background-position: 0 0, 0 10px, 10px -10px, -10px 0px;
            border: 2px dashed #ccc;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #666;
            font-size: 14px;
        }
        
        .chart-placeholder {
            background: linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%);
            border: 2px solid #2196f3;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #1976d2;
            font-size: 14px;
            font-weight: bold;
        }
        
        .table-element {
            border: 1px solid #ccc;
            background: #fff;
        }
        
        .table-element table {
            width: 100%;
            height: 100%;
            border-collapse: collapse;
        }
        
        .table-element td {
            border: 1px solid #ddd;
            padding: 4px 8px;
            font-size: 12px;
            vertical-align: top;
        }
    </style>
</head>
<body>
    <div class="slide-container">
        ${elementsHtml}
    </div>
</body>
</html>`;
  }

  /**
   * Render individual element to HTML
   */
  private renderElement(element: any, scale: number): string {
    const emuToPixels = (emu: number) => Math.round(emu / 914400 * 96 * scale);
    
    const left = emuToPixels(element.position.x);
    const top = emuToPixels(element.position.y);
    const width = emuToPixels(element.size.width);
    const height = emuToPixels(element.size.height);

    const baseStyle = `left: ${left}px; top: ${top}px; width: ${width}px; height: ${height}px;`;

    switch (element.type) {
      case 'text':
        const textContent = element.content?.text || '';
        const fontSize = Math.max(10, Math.min(24, width / 20)); // Responsive font size
        return `
          <div class="slide-element text-element" style="${baseStyle} font-size: ${fontSize}px;">
            ${this.escapeHtml(textContent)}
          </div>
        `;

      case 'shape':
        return `
          <div class="slide-element shape-element" style="${baseStyle}">
            <div style="width: 100%; height: 100%; background: ${element.style?.fill || '#f0f0f0'};"></div>
          </div>
        `;

      case 'image':
        return `
          <div class="slide-element image-placeholder" style="${baseStyle}">
            📷 Image
          </div>
        `;

      case 'chart':
        const chartType = element.content?.chartType || 'Chart';
        return `
          <div class="slide-element chart-placeholder" style="${baseStyle}">
            📊 ${this.escapeHtml(chartType)}
          </div>
        `;

      case 'table':
        const rows = element.content?.rows || [];
        let tableHtml = '<table>';
        
        for (const row of rows.slice(0, 10)) { // Limit rows for performance
          tableHtml += '<tr>';
          for (const cell of row.cells.slice(0, 6)) { // Limit columns
            tableHtml += `<td>${this.escapeHtml(cell.text || '')}</td>`;
          }
          tableHtml += '</tr>';
        }
        
        tableHtml += '</table>';
        
        return `
          <div class="slide-element table-element" style="${baseStyle}">
            ${tableHtml}
          </div>
        `;

      case 'group':
        // Render child elements
        let groupHtml = '';
        if (element.children && Array.isArray(element.children)) {
          for (const child of element.children) {
            // Adjust child positions relative to group
            const adjustedChild = {
              ...child,
              position: {
                x: child.position.x + element.position.x,
                y: child.position.y + element.position.y,
                z: child.position.z
              }
            };
            groupHtml += this.renderElement(adjustedChild, scale);
          }
        }
        return groupHtml;

      default:
        return `
          <div class="slide-element" style="${baseStyle} border: 1px dashed #ccc; background: #fafafa;">
            <div style="padding: 4px; font-size: 12px; color: #666;">
              ${element.type || 'Unknown'}
            </div>
          </div>
        `;
    }
  }

  /**
   * Escape HTML characters
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Check if Puppeteer is available
   */
  static async isAvailable(): Promise<boolean> {
    try {
      await Function('return import("puppeteer")')();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Close browser instance
   */
  async close(): Promise<void> {
    if (this.browser) {
      try {
        await this.browser.close();
        this.browser = null;
        console.log('Puppeteer browser closed');
      } catch (error) {
        console.warn('Error closing Puppeteer browser:', error);
      }
    }
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    await this.close();
  }
}