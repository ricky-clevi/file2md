import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import { JSDOM } from 'jsdom';
import path from 'node:path';
import { Buffer } from 'node:buffer';

import { setupBrowserPolyfills } from '../utils/browser-polyfills.js';
import type { ImageExtractor } from '../utils/image-extractor.js';
import type { ChartExtractor } from '../utils/chart-extractor.js';
import { ParseError } from '../types/errors.js';
import type { 
  ImageData, 
  ChartData
} from '../types/interfaces.js';

export interface HwpParseOptions {
  readonly preserveLayout?: boolean;
  readonly extractImages?: boolean;
  readonly extractCharts?: boolean;
}

export interface HwpParseResult {
  readonly markdown: string;
  readonly images: readonly ImageData[];
  readonly charts: readonly ChartData[];
  readonly metadata: Record<string, unknown>;
}

type HwpFormat = 'hwp' | 'hwpx' | 'unknown';

/**
 * Parse HWP or HWPX buffer and convert to markdown
 */
export async function parseHwp(
  buffer: Buffer,
  imageExtractor: ImageExtractor,
  chartExtractor: ChartExtractor,
  options: HwpParseOptions = {}
): Promise<HwpParseResult> {
  try {
    const format = detectHwpFormat(buffer);
    
    switch (format) {
      case 'hwp':
        return await parseHwpBinary(buffer, imageExtractor, chartExtractor, options);
      case 'hwpx':
        return await parseHwpxXml(buffer, imageExtractor, chartExtractor, options);
      default:
        throw new ParseError('HWP', 'Unsupported HWP format variant');
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new ParseError('HWP', message, error as Error);
  }
}

/**
 * Detect HWP format based on file signature
 */
function detectHwpFormat(buffer: Buffer): HwpFormat {
  if (buffer.length < 4) {
    return 'unknown';
  }

  // Check for CFB/OLE2 signature (HWP binary format)
  if (buffer.length >= 8) {
    const cfbSignature = buffer.subarray(0, 8);
    const expectedCfb = Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]);
    if (cfbSignature.equals(expectedCfb)) {
      return 'hwp';
    }
  }
  
  // Check for ZIP signature (HWPX format)
  const zipSignature = buffer.subarray(0, 4);
  const expectedZip = Buffer.from([0x50, 0x4B, 0x03, 0x04]);
  if (zipSignature.equals(expectedZip)) {
    return 'hwpx';
  }
  
  return 'unknown';
}

/**
 * Parse HWP binary format using hwp.js
 */
async function parseHwpBinary(
  buffer: Buffer,
  imageExtractor: ImageExtractor,
  _chartExtractor: ChartExtractor,
  options: HwpParseOptions
): Promise<HwpParseResult> {
  try {
    // Setup browser polyfills before importing hwp.js
    setupBrowserPolyfills();
    
    // Dynamic import of hwp.js to handle potential loading issues
    const { Viewer } = await import('hwp.js');
    
    // Convert Buffer to Uint8Array for hwp.js
    const uint8Array = new Uint8Array(buffer);
    
    // Create a virtual DOM environment for hwp.js
    const dom = new JSDOM('<!DOCTYPE html><html><body><div id="hwp-container"></div></body></html>', {
      pretendToBeVisual: true,
      resources: "usable"
    });
    const originalDocument = global.document;
    const originalWindow = global.window;
    const originalIntersectionObserver = global.IntersectionObserver;
    const originalResizeObserver = global.ResizeObserver;
    const originalMutationObserver = global.MutationObserver;
    
    // Set global DOM objects for hwp.js
    global.document = dom.window.document;
    global.window = dom.window as unknown as Window & typeof globalThis;
    
    // Ensure our polyfills are available in the DOM window as well
    if (!(dom.window as unknown as { IntersectionObserver: unknown }).IntersectionObserver) {
      (dom.window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = global.IntersectionObserver;
    }
    if (!(dom.window as unknown as { ResizeObserver: unknown }).ResizeObserver) {
      (dom.window as unknown as { ResizeObserver: unknown }).ResizeObserver = global.ResizeObserver;
    }
    if (!(dom.window as unknown as { MutationObserver: unknown }).MutationObserver) {
      (dom.window as unknown as { MutationObserver: unknown }).MutationObserver = global.MutationObserver;
    }
    
    try {
      const container = global.document.getElementById('hwp-container');
      if (!container) {
        throw new Error('Failed to create container element');
      }
      
      // Initialize hwp.js viewer
      new Viewer(container, uint8Array);
      
      // Wait for viewer to process the document
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Extract text content from the rendered DOM
      const textContent = extractTextFromViewer(container);
      
      // Parse images if requested
      const images = options.extractImages !== false ? 
        await extractHwpImages(container, imageExtractor) : [];
      
      // Convert to markdown
      const markdown = convertHwpContentToMarkdown(textContent);
      
      return {
        markdown,
        images,
        charts: [], // hwp.js doesn't directly expose chart data
        metadata: { 
          format: 'hwp', 
          parser: 'hwp.js',
          totalParagraphs: textContent.length
        }
      };
      
    } finally {
      // Restore global objects
      global.document = originalDocument;
      global.window = originalWindow;
      if (originalIntersectionObserver !== undefined) {
        global.IntersectionObserver = originalIntersectionObserver;
      }
      if (originalResizeObserver !== undefined) {
        global.ResizeObserver = originalResizeObserver;
      }
      if (originalMutationObserver !== undefined) {
        global.MutationObserver = originalMutationObserver;
      }
    }
    
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new ParseError('HWP', `Failed to parse HWP file with hwp.js: ${message}`, error as Error);
  }
}

/**
 * Parse HWPX XML format using JSZip and fast-xml-parser
 */
async function parseHwpxXml(
  buffer: Buffer,
  imageExtractor: ImageExtractor,
  _chartExtractor: ChartExtractor,
  options: HwpParseOptions
): Promise<HwpParseResult> {
  try {
    const zip = await JSZip.loadAsync(buffer);
    
    // Log all files in the ZIP for debugging
    const allFiles = Object.keys(zip.files);
    console.log('HWPX archive contains files:', allFiles);
    
    // Find main content files in HWPX (OWPML format)
    // HWPX structure typically has sections in Contents/section0.xml, section1.xml, etc.
    const contentFiles = [
      'Contents/section0.xml',
      'Contents/section1.xml',
      'Contents/content.hpf',
      'Contents/header.xml',
      'Contents/content.xml',
      'content.xml',
      'Contents/document.xml',
      'document.xml',
      'Contents/body.xml',
      'body.xml',
      'version.xml',
      'mimetype'
    ];
    
    // Try to find any section files
    const sectionFiles = allFiles.filter(f => f.match(/Contents\/section\d+\.xml/));
    if (sectionFiles.length > 0) {
      console.log('Found section files:', sectionFiles);
    }
    
    // Try to find XML files
    const xmlFiles = allFiles.filter(f => f.endsWith('.xml'));
    if (xmlFiles.length > 0) {
      console.log('Found XML files:', xmlFiles);
    }
    
    let contentFile = null;
    let contentFileName = '';
    
    // First try section files
    if (sectionFiles.length > 0) {
      contentFileName = sectionFiles[0];
      contentFile = zip.file(contentFileName);
    }
    
    // Then try our known content files
    if (!contentFile) {
      for (const fileName of contentFiles) {
        contentFile = zip.file(fileName);
        if (contentFile) {
          contentFileName = fileName;
          break;
        }
      }
    }
    
    // If still not found, try any XML file
    if (!contentFile && xmlFiles.length > 0) {
      for (const xmlFile of xmlFiles) {
        if (!xmlFile.includes('_rels') && !xmlFile.includes('meta')) {
          contentFile = zip.file(xmlFile);
          if (contentFile) {
            contentFileName = xmlFile;
            break;
          }
        }
      }
    }
    
    if (!contentFile) {
      // Create a more informative error message
      const fileList = allFiles.slice(0, 10).join(', ');
      const moreFiles = allFiles.length > 10 ? ` ... and ${allFiles.length - 10} more files` : '';
      throw new ParseError('HWPX', `No content XML file found in HWPX archive. Files found: ${fileList}${moreFiles}`);
    }
    
    // Parse all section files if multiple exist
    let allContent = '';
    
    if (sectionFiles.length > 0) {
      // Process all section files in order
      for (const sectionFileName of sectionFiles.sort()) {
        const sectionFile = zip.file(sectionFileName);
        if (sectionFile) {
          const xmlContent = await sectionFile.async('string');
          const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '@_', 
            textNodeName: '#text',
            parseAttributeValue: true,
            trimValues: true
          });
          
          const parsedXml = parser.parse(xmlContent);
          console.log(`Parsed HWPX section: ${sectionFileName}`);
          
          // Convert each section to markdown and combine
          const sectionMarkdown = convertOwpmlToMarkdown(parsedXml);
          if (sectionMarkdown && sectionMarkdown.trim()) {
            allContent += `${sectionMarkdown}\n\n`;
          }
        }
      }
    } else {
      // Parse single content file
      const xmlContent = await contentFile.async('string');
      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_', 
        textNodeName: '#text',
        parseAttributeValue: true,
        trimValues: true
      });
      
      const parsedXml = parser.parse(xmlContent);
      console.log(`Parsed HWPX XML from ${contentFileName}`);
      allContent = convertOwpmlToMarkdown(parsedXml);
    }
    
    // Extract images from ZIP if requested
    const images = options.extractImages !== false ? 
      await extractHwpxImages(zip, imageExtractor) : [];
    
    const markdown = allContent.trim() || '*No readable content found in HWPX file*';
    
    return {
      markdown,
      images,
      charts: [], // Basic implementation, can be enhanced later
      metadata: { 
        format: 'hwpx', 
        parser: 'jszip+fast-xml-parser',
        contentFile: contentFileName,
        zipEntries: Object.keys(zip.files).length
      }
    };
    
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new ParseError('HWPX', `Failed to parse HWPX file: ${message}`, error as Error);
  }
}

/**
 * Extract text content from hwp.js rendered DOM
 */
function extractTextFromViewer(container: Element): string[] {
  const paragraphs: string[] = [];
  
  // Look for various text-containing elements
  const textSelectors = [
    '[data-text]',
    '.hwp-text',
    'p',
    'div[style*="text"]',
    'span'
  ];
  
  for (const selector of textSelectors) {
    try {
      const elements = container.querySelectorAll(selector);
      elements.forEach(element => {
        const text = element.textContent?.trim();
        if (text && text.length > 0 && !paragraphs.includes(text)) {
          paragraphs.push(text);
        }
      });
      
      if (paragraphs.length > 0) break; // Use first successful selector
    } catch {
      continue; // Try next selector
    }
  }
  
  // Fallback: get all text content
  if (paragraphs.length === 0) {
    const allText = container.textContent?.trim();
    if (allText) {
      // Split by common paragraph separators
      const lines = allText.split(/\n\s*\n|\r\n\s*\r\n/);
      paragraphs.push(...lines.filter(line => line.trim().length > 0));
    }
  }
  
  return paragraphs;
}

/**
 * Extract images from HWP binary format
 */
async function extractHwpImages(
  container: Element,
  imageExtractor: ImageExtractor
): Promise<ImageData[]> {
  const images: ImageData[] = [];
  
  try {
    // Look for image elements in the rendered content
    const imgElements = container.querySelectorAll('img, canvas, [style*="background-image"]');
    
    imgElements.forEach((element, index) => {
      const src = element.getAttribute('src');
      if (src && src.startsWith('data:')) {
        // Handle base64 embedded images
        try {
          const matches = src.match(/data:image\/([^;]+);base64,(.+)/);
          if (matches) {
            const format = matches[1];
            const base64Data = matches[2];
            const imageBuffer = Buffer.from(base64Data, 'base64');
            
            const filename = `hwp-image-${index + 1}.${format}`;
            const imagePath = path.join(imageExtractor.imageDirectory, filename);
            
            // Note: This is a simplified approach
            // In a real implementation, you'd save the buffer to disk
            images.push({
              originalPath: `hwp-embedded-${index + 1}`,
              savedPath: imagePath,
              format,
              size: imageBuffer.length
            });
          }
        } catch (e) {
          console.warn(`Failed to process embedded image ${index + 1}:`, e);
        }
      }
    });
  } catch (e) {
    console.warn('Failed to extract images from HWP:', e);
  }
  
  return images;
}

/**
 * Extract images from HWPX ZIP archive
 */
async function extractHwpxImages(
  zip: JSZip,
  imageExtractor: ImageExtractor
): Promise<ImageData[]> {
  const images: ImageData[] = [];
  
  try {
    // Look for image files in the ZIP archive - typically in BinData folder
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff'];
    
    for (const [fileName, file] of Object.entries(zip.files)) {
      if (!file.dir && imageExtensions.some(ext => fileName.toLowerCase().endsWith(ext))) {
        try {
          const imageBuffer = await file.async('nodebuffer');
          const extension = path.extname(fileName).slice(1).toLowerCase();
          
          // Actually save the image to disk using imageExtractor
          // Pass originalPath and basePath (empty string for base)
          const savedPath = await imageExtractor.saveImage(imageBuffer, fileName, '');
          
          if (savedPath) {
            images.push({
              originalPath: fileName,
              savedPath,
              format: extension,
              size: imageBuffer.length
            });
            
            console.log(`Extracted and saved image: ${fileName} -> ${savedPath}`);
          }
          
        } catch (e) {
          console.warn(`Failed to extract image ${fileName}:`, e);
        }
      }
    }
  } catch (e) {
    console.warn('Failed to extract images from HWPX:', e);
  }
  
  return images;
}

/**
 * Convert HWP text content to markdown
 */
function convertHwpContentToMarkdown(textContent: string[]): string {
  if (textContent.length === 0) {
    return '*No content found*';
  }
  
  let markdown = '';
  
  textContent.forEach((paragraph, index) => {
    if (paragraph.trim().length === 0) return;
    
    // Simple heuristics for formatting
    if (paragraph.length < 50 && index === 0) {
      // Likely a title
      markdown += `# ${paragraph}\n\n`;
    } else if (paragraph.match(/^[0-9]+\./)) {
      // Numbered list item
      markdown += `${paragraph}\n`;
    } else if (paragraph.match(/^[-•]/)) {
      // Bullet list item
      markdown += `${paragraph}\n`;
    } else {
      // Regular paragraph
      markdown += `${paragraph}\n\n`;
    }
  });
  
  return markdown.trim();
}

/**
 * Convert OWPML structure to markdown
 */
function convertOwpmlToMarkdown(owpmlData: unknown): string {
  let markdown = '';
  
  try {
    // HWPX uses hp:p for paragraphs and hp:t for text
    // Navigate the structure to find text nodes
    const texts: string[] = [];
    
    // Extract all text content recursively, but only from text nodes
    extractTextNodes(owpmlData, texts);
    
    // Join extracted texts with proper spacing
    if (texts.length > 0) {
      markdown = texts
        .filter(text => text.trim().length > 0)
        .join('\n\n');
    }
    
    if (!markdown.trim()) {
      markdown = '*No readable content found in HWPX file*';
    }
    
  } catch (e) {
    console.warn('Error processing OWPML structure:', e);
    markdown = '*Error processing HWPX content*';
  }
  
  return markdown;
}

/**
 * Extract text nodes from OWPML structure
 */
function extractTextNodes(obj: unknown, texts: string[]): void {
  if (!obj) return;
  
  // If it's a string and looks like actual text (not XML attribute values)
  if (typeof obj === 'string') {
    // Filter out numeric-only strings, single words that look like attribute values
    const trimmed = obj.trim();
    if (trimmed && 
        !trimmed.match(/^[0-9\s.-]+$/) && // Skip pure numbers
        !trimmed.match(/^[A-Z_]+$/) && // Skip constants like "BOTH", "LEFT_ONLY"
        trimmed.length > 2 && // Skip very short strings
        !trimmed.includes('pixel') && // Skip image metadata
        !trimmed.startsWith('그림입니다') && // Skip image placeholders
        !trimmed.includes('원본 그림')) { // Skip image descriptions
      texts.push(trimmed);
    }
    return;
  }
  
  // If it's an array, process each item
  if (Array.isArray(obj)) {
    for (const item of obj) {
      extractTextNodes(item, texts);
    }
    return;
  }
  
  // If it's an object, look for text content
  if (typeof obj === 'object' && obj !== null) {
    // HWPX specific text node handling
    // Look for hp:p (paragraphs) and hp:t (text) nodes
    if ((obj as { 'hp:p'?: unknown })['hp:p']) {
      const paragraphs = Array.isArray((obj as { 'hp:p': unknown })['hp:p']) ? (obj as { 'hp:p': unknown[] })['hp:p'] : [(obj as { 'hp:p': unknown })['hp:p']];
      for (const para of paragraphs) {
        extractParagraphText(para, texts);
      }
    }
    
    // Also check for plain p nodes
    if ((obj as { p?: unknown }).p) {
      const paragraphs = Array.isArray((obj as { p: unknown }).p) ? (obj as { p: unknown[] }).p : [(obj as { p: unknown }).p];
      for (const para of paragraphs) {
        extractParagraphText(para, texts);
      }
    }
    
    // Check for TEXT nodes
    if ((obj as { TEXT?: unknown }).TEXT) {
      const textNodes = Array.isArray((obj as { TEXT: unknown }).TEXT) ? (obj as { TEXT: unknown[] }).TEXT : [(obj as { TEXT: unknown }).TEXT];
      for (const textNode of textNodes) {
        if ((textNode as { '#text'?: string })['#text']) {
          const text = (textNode as { '#text': string })['#text'].trim();
          if (text && !isMetadata(text)) {
            texts.push(text);
          }
        }
      }
    }
    
    // Recursively process all properties
    for (const [key, value] of Object.entries(obj)) {
      // Skip attribute keys and known metadata keys
      if (!key.startsWith('@_') && 
          !key.startsWith('_') &&
          key !== 'SECDEF' &&
          key !== 'DOCSUMMARY' &&
          key !== 'MAPPINGTABLE' &&
          key !== 'COMPATIBLE_DOCUMENT' &&
          key !== 'LAYOUTCOMPATIBILITY') {
        extractTextNodes(value, texts);
      }
    }
  }
}

/**
 * Extract text from a paragraph node
 */
function extractParagraphText(para: unknown, texts: string[]): void {
  if (!para) return;
  
  // Look for hp:run or run nodes
  const runs = (para as { 'hp:run'?: unknown, run?: unknown, RUN?: unknown })['hp:run'] || (para as { run?: unknown })['run'] || (para as { RUN?: unknown })['RUN'];
  if (runs) {
    const runArray = Array.isArray(runs) ? runs : [runs];
    for (const run of runArray) {
      // Look for hp:t or t nodes (text content)
      const textNode = (run as { 'hp:t'?: unknown, t?: unknown, T?: unknown, '#text'?: unknown })['hp:t'] || (run as { t?: unknown })['t'] || (run as { T?: unknown })['T'] || (run as { '#text'?: unknown })['#text'];
      if (textNode) {
        if (typeof textNode === 'string') {
          const text = textNode.trim();
          if (text && !isMetadata(text)) {
            texts.push(text);
          }
        } else if ((textNode as { '#text'?: string })['#text']) {
          const text = (textNode as { '#text': string })['#text'].trim();
          if (text && !isMetadata(text)) {
            texts.push(text);
          }
        }
      }
    }
  }
  
  // Also check for direct text content
  if ((para as { '#text'?: string })['#text']) {
    const text = (para as { '#text': string })['#text'].trim();
    if (text && !isMetadata(text)) {
      texts.push(text);
    }
  }
  
  // Check for TEXT child nodes
  if ((para as { TEXT?: unknown }).TEXT) {
    const textNodes = Array.isArray((para as { TEXT: unknown }).TEXT) ? (para as { TEXT: unknown[] }).TEXT : [(para as { TEXT: unknown }).TEXT];
    for (const textNode of textNodes) {
      if ((textNode as { '#text'?: string })['#text']) {
        const text = (textNode as { '#text': string })['#text'].trim();
        if (text && !isMetadata(text)) {
          texts.push(text);
        }
      } else if (typeof textNode === 'string') {
        const text = textNode.trim();
        if (text && !isMetadata(text)) {
          texts.push(text);
        }
      }
    }
  }
}

/**
 * Check if a string looks like metadata rather than document content
 */
function isMetadata(text: string): boolean {
  // Filter out common metadata patterns
  return text.match(/^[A-Z_]+$/) !== null || // Constants
         text.match(/^[0-9\s.-]+$/) !== null || // Pure numbers
         text.includes('pixel') || // Image metadata
         text.startsWith('그림입니다') || // Korean "This is an image"
         text.includes('원본 그림') || // Korean "Original image"
         text.includes('.jpg') || // File names
         text.includes('.png') ||
         text.includes('.bmp') ||
         text.includes('http://') || // URLs in metadata
         text.length < 3; // Very short strings
}
