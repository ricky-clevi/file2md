import JSZip from 'jszip';
import { parseStringPromise } from 'xml2js';
import path from 'node:path';
import type { Buffer } from 'node:buffer';

import type { ImageExtractor } from '../utils/image-extractor.js';
import type { ChartExtractor } from '../utils/chart-extractor.js';
import { SlideRenderer, type SlideRenderOptions } from '../utils/slide-renderer.js';
import { ParseError } from '../types/errors.js';
import type { 
  ImageData, 
  ChartData
} from '../types/interfaces.js';

export interface PptxParseOptions {
  readonly preserveLayout?: boolean;
  readonly extractImages?: boolean;
  readonly extractCharts?: boolean;
  readonly useSlideScreenshots?: boolean; // New option for slide-based rendering
  readonly slideRenderOptions?: SlideRenderOptions;
  readonly outputDir?: string;
}

export interface PptxParseResult {
  readonly markdown: string;
  readonly images: readonly ImageData[];
  readonly charts: readonly ChartData[];
  readonly slideCount: number;
  readonly metadata: Record<string, unknown>;
}

interface SlideFile {
  readonly path: string;
  readonly file: JSZip.JSZipObject;
}

/**
 * Parse PPTX buffer and convert to markdown with layout preservation
 */
export async function parsePptx(
  buffer: Buffer,
  imageExtractor: ImageExtractor,
  chartExtractor: ChartExtractor,
  options: PptxParseOptions = {}
): Promise<PptxParseResult> {
  try {
    // Check if slide screenshots are requested (new default behavior)
    if (options.useSlideScreenshots !== false) {
      return await parsePptxWithSlideScreenshots(
        buffer,
        imageExtractor,
        chartExtractor,
        options
      );
    }

    // Fallback to legacy layout parsing if slide screenshots are disabled
    return await parsePptxLegacyMode(
      buffer,
      imageExtractor,
      chartExtractor,
      options
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new ParseError('PPTX', message, error as Error);
  }
}

/**
 * New slide screenshot-based parsing (recommended)
 */
async function parsePptxWithSlideScreenshots(
  buffer: Buffer,
  imageExtractor: ImageExtractor,
  chartExtractor: ChartExtractor,
  options: PptxParseOptions
): Promise<PptxParseResult> {
  const outputDir = options.outputDir || './images';
  const slideRenderer = new SlideRenderer(outputDir);
  
  try {
    // Convert PPTX to slide images
    const renderResult = await slideRenderer.renderSlidesToImages(
      buffer,
      options.slideRenderOptions
    );
    
    // Extract title from PPTX metadata for better markdown generation
    const title = await extractPptxTitle(buffer);
    
    // Generate markdown with slide images
    const markdown = slideRenderer.generateSlideMarkdown(
      renderResult.slideImages,
      title
    );
    
    // Still extract charts if requested (need to load zip for chart extraction)
    let extractedCharts: readonly any[] = [];
    if (options.extractCharts !== false) {
      try {
        const zip = await JSZip.loadAsync(buffer);
        extractedCharts = await chartExtractor.extractChartsFromZip(zip, 'ppt/');
      } catch {
        // Ignore chart extraction errors
      }
    }
    
    return {
      markdown,
      images: renderResult.slideImages,
      charts: extractedCharts.map(chart => chart.data),
      slideCount: renderResult.slideCount,
      metadata: {
        totalSlides: renderResult.slideCount,
        hasImages: renderResult.slideImages.length > 0,
        hasCharts: extractedCharts.length > 0,
        renderMethod: 'slide-screenshots',
        ...renderResult.metadata
      }
    };
  } catch (error: unknown) {
    // If slide rendering fails, fall back to legacy mode
    console.warn('Slide screenshot rendering failed, falling back to legacy mode:', error);
    return await parsePptxLegacyMode(buffer, imageExtractor, chartExtractor, options);
  }
}

/**
 * Legacy layout parsing mode (fallback)
 */
async function parsePptxLegacyMode(
  buffer: Buffer,
  imageExtractor: ImageExtractor,
  chartExtractor: ChartExtractor,
  options: PptxParseOptions
): Promise<PptxParseResult> {
  const zip = await JSZip.loadAsync(buffer);
  
  // Extract images first
  const extractedImages = options.extractImages !== false 
    ? await imageExtractor.extractImagesFromZip(zip, 'ppt/')
    : [];
  
  // Extract charts if enabled
  const extractedCharts = options.extractCharts !== false
    ? await chartExtractor.extractChartsFromZip(zip, 'ppt/')
    : [];
  
  const slideFiles: SlideFile[] = [];
  zip.forEach((relativePath, file) => {
    if (relativePath.startsWith('ppt/slides/slide') && relativePath.endsWith('.xml')) {
      slideFiles.push({
        path: relativePath,
        file: file
      });
    }
  });
  
  slideFiles.sort((a, b) => {
    const aNum = parseInt(a.path.match(/slide(\d+)\.xml/)?.[1] || '0');
    const bNum = parseInt(b.path.match(/slide(\d+)\.xml/)?.[1] || '0');
    return aNum - bNum;
  });
  
  let markdown = '';
  
  for (let i = 0; i < slideFiles.length; i++) {
    const slideFile = slideFiles[i];
    const slideNumber = i + 1;
    
    markdown += `## Slide ${slideNumber}\n\n`;
    
    const xmlContent = await slideFile.file.async('string');
    const slideContent = await extractLegacySlideContent(
      xmlContent, 
      imageExtractor, 
      extractedImages, 
      slideNumber
    );
    
    if (slideContent.trim()) {
      markdown += slideContent + '\n\n';
    } else {
      markdown += '*No content*\n\n';
    }
  }
  
  return {
    markdown: markdown.trim(),
    images: extractedImages,
    charts: extractedCharts.map(chart => chart.data),
    slideCount: slideFiles.length,
    metadata: {
      totalSlides: slideFiles.length,
      hasImages: extractedImages.length > 0,
      hasCharts: extractedCharts.length > 0,
      renderMethod: 'legacy-layout-parsing'
    }
  };
}

/**
 * Extract PPTX title from document properties
 */
async function extractPptxTitle(buffer: Buffer): Promise<string | undefined> {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const corePropsFile = zip.file('docProps/core.xml');
    
    if (corePropsFile) {
      const corePropsContent = await corePropsFile.async('string');
      const result = await parseStringPromise(corePropsContent) as any;
      
      // Try to extract title from core properties
      const title = result?.['cp:coreProperties']?.[0]?.['dc:title']?.[0];
      if (title && typeof title === 'string' && title.trim()) {
        return title.trim();
      }
    }
  } catch {
    // Ignore errors and return undefined
  }
  
  return undefined;
}

/**
 * Legacy slide content extraction (simplified version)
 */
async function extractLegacySlideContent(
  xmlContent: string,
  imageExtractor: ImageExtractor,
  extractedImages: readonly ImageData[],
  slideNumber: number
): Promise<string> {
  try {
    const result = await parseStringPromise(xmlContent) as any;
    let markdown = '';
    
    // Simple text extraction function
    function extractText(obj: any): string {
      let text = '';
      
      if (typeof obj === 'object' && obj !== null) {
        if (Array.isArray(obj)) {
          for (const item of obj) {
            text += extractText(item);
          }
        } else {
          // Extract text content
          if (obj['a:t']) {
            if (Array.isArray(obj['a:t'])) {
              for (const textItem of obj['a:t']) {
                if (typeof textItem === 'string') {
                  text += textItem + ' ';
                } else if (textItem && typeof textItem === 'object' && '_' in textItem) {
                  text += (textItem as any)._ + ' ';
                }
              }
            }
          }
          
          // Recursively process nested objects
          for (const key in obj) {
            if (key !== 'a:t') {
              text += extractText(obj[key]);
            }
          }
        }
      }
      
      return text;
    }
    
    // Extract all text content
    const textContent = extractText(result).trim();
    if (textContent) {
      markdown += textContent + '\n\n';
    }
    
    // Add any images for this slide
    const slideImages = extractedImages.filter(img => 
      img.originalPath.includes(`slide${slideNumber}`) ||
      (slideNumber === 1 && img.originalPath.includes('media/'))
    );
    
    for (const img of slideImages) {
      if (img.savedPath) {
        const filename = path.basename(img.savedPath);
        markdown += imageExtractor.getImageMarkdown(`Slide ${slideNumber} Image`, filename) + '\n\n';
      }
    }
    
    return markdown.trim();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new ParseError('PPTX', `Failed to extract legacy content from slide: ${message}`, error as Error);
  }
}