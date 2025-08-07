import JSZip from 'jszip';
import { parseStringPromise } from 'xml2js';
import type { Buffer } from 'node:buffer';

import type { ImageExtractor } from '../utils/image-extractor.js';
import type { ChartExtractor } from '../utils/chart-extractor.js';
import { PptxVisualParser, type SlideLayout } from '../utils/pptx-visual-parser.js';
import { ParseError } from '../types/errors.js';
import type { 
  ImageData, 
  ChartData
} from '../types/interfaces.js';

export interface PptxParseOptions {
  readonly preserveLayout?: boolean;
  readonly extractImages?: boolean;
  readonly extractCharts?: boolean;
  readonly useVisualParser?: boolean; // Enhanced visual parsing for better layout understanding
}

export interface PptxParseResult {
  readonly markdown: string;
  readonly images: readonly ImageData[];
  readonly charts: readonly ChartData[];
  readonly slideCount: number;
  readonly metadata: Record<string, unknown>;
  readonly visualLayouts?: readonly SlideLayout[]; // Enhanced visual information
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
    return await parsePptxToMarkdown(
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
 * Parse PPTX to markdown without image generation
 */
async function parsePptxToMarkdown(
  buffer: Buffer,
  imageExtractor: ImageExtractor,
  chartExtractor: ChartExtractor,
  options: PptxParseOptions
): Promise<PptxParseResult> {
  const zip = await JSZip.loadAsync(buffer);
  
  // Enhanced visual parsing if requested (for text extraction)
  let visualLayouts: SlideLayout[] | undefined;
  if (options.useVisualParser !== false) {
    try {
      const visualParser = new PptxVisualParser();
      const readonlyLayouts = await visualParser.parseVisualElements(buffer);
      visualLayouts = [...readonlyLayouts];
      console.log(`Visual parser extracted ${visualLayouts.length} slide layouts`);
    } catch (visualError) {
      console.warn('Visual parsing failed, continuing with standard processing:', visualError);
    }
  }
  
  // Extract embedded images metadata only (not for slide screenshots)
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
        file
      });
    }
  });
  
  slideFiles.sort((a, b) => {
    const aNum = parseInt(a.path.match(/slide(\d+)\.xml/)?.[1] || '0', 10);
    const bNum = parseInt(b.path.match(/slide(\d+)\.xml/)?.[1] || '0', 10);
    return aNum - bNum;
  });
  
  // Extract title from PPTX metadata
  const title = await extractPptxTitle(buffer);
  
  let markdown = '';
  
  if (title) {
    markdown += `# ${title}\n\n`;
  }
  
  // Use visual layouts for enhanced text extraction if available
  if (visualLayouts && visualLayouts.length === slideFiles.length) {
    for (let i = 0; i < slideFiles.length; i++) {
      const slideFile = slideFiles[i];
      const slideNumber = i + 1;
      const layout = visualLayouts[i];
      
      if (layout?.title) {
        markdown += `## Slide ${slideNumber}: ${layout.title}\n\n`;
      } else {
        markdown += `## Slide ${slideNumber}\n\n`;
      }
      
      // Extract text from visual layout
      const textElements = layout.elements.filter(e => e.type === 'text');
      if (textElements.length > 0) {
        textElements.forEach((element) => {
          if (element.type === 'text' && (element.content as { text: string })?.text) {
            const textContent = (element.content as { text: string }).text.trim();
            if (textContent) {
              markdown += `${textContent}\n\n`;
            }
          }
        });
      } else {
        // Fallback to XML extraction if no text in visual layout
        const xmlContent = await slideFile.file.async('string');
        const slideContent = await extractSlideTextContent(xmlContent);
        if (slideContent.trim()) {
          markdown += `${slideContent}\n\n`;
        } else {
          markdown += '*No content*\n\n';
        }
      }
      
      // Add metadata about other elements
      const imageElements = layout.elements.filter(e => e.type === 'image');
      const chartElements = layout.elements.filter(e => e.type === 'chart');
      const tableElements = layout.elements.filter(e => e.type === 'table');
      
      if (imageElements.length > 0 || chartElements.length > 0 || tableElements.length > 0) {
        markdown += '### Slide Elements\n\n';
        if (imageElements.length > 0) {
          markdown += `- ${imageElements.length} image(s)\n`;
        }
        if (chartElements.length > 0) {
          markdown += `- ${chartElements.length} chart(s)\n`;
        }
        if (tableElements.length > 0) {
          markdown += `- ${tableElements.length} table(s)\n`;
        }
        markdown += '\n';
      }
    }
  } else {
    // Standard text extraction without visual layouts
    for (let i = 0; i < slideFiles.length; i++) {
      const slideFile = slideFiles[i];
      const slideNumber = i + 1;
      
      markdown += `## Slide ${slideNumber}\n\n`;
      
      const xmlContent = await slideFile.file.async('string');
      const slideContent = await extractSlideTextContent(xmlContent);
      
      if (slideContent.trim()) {
        markdown += `${slideContent}\n\n`;
      } else {
        markdown += '*No content*\n\n';
      }
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
      renderMethod: 'text-extraction',
      hasVisualLayouts: visualLayouts !== undefined
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
      const result = await parseStringPromise(corePropsContent) as { 'cp:coreProperties'?: { 'dc:title'?: string[] }[] };
      
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
 * Extract text content from slide XML
 */
async function extractSlideTextContent(
  xmlContent: string
): Promise<string> {
  try {
    const result = await parseStringPromise(xmlContent);
    
    // Simple text extraction function
    function extractText(obj: unknown): string {
      let text = '';
      
      if (typeof obj === 'object' && obj !== null) {
        if (Array.isArray(obj)) {
          for (const item of obj) {
            text += extractText(item);
          }
        } else {
          // Extract text content
          if ((obj as { 'a:t'?: (string | { _: string })[] })['a:t']) {
            if (Array.isArray((obj as { 'a:t': (string | { _: string })[] })['a:t'])) {
              for (const textItem of (obj as { 'a:t': (string | { _: string })[] })['a:t']) {
                if (typeof textItem === 'string') {
                  text += `${textItem} `; 
                } else if (textItem && typeof textItem === 'object' && '_' in textItem) {
                  text += `${(textItem as { _: string })._} `; 
                }
              }
            }
          }
          
          // Recursively process nested objects
          for (const key in (obj as Record<string, unknown>)) {
            if (key !== 'a:t') {
              text += extractText((obj as Record<string, unknown>)[key]);
            }
          }
        }
      }
      
      return text;
    }
    
    // Extract all text content
    const textContent = extractText(result).trim();
    return textContent;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new ParseError('PPTX', `Failed to extract text content from slide: ${message}`, error as Error);
  }
}
