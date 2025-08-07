import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import { JSDOM } from 'jsdom';
import path from 'node:path';
import { Buffer } from 'node:buffer';

import { setupBrowserPolyfills, cleanupBrowserPolyfills } from '../utils/browser-polyfills.js';
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
  chartExtractor: ChartExtractor,
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
    global.window = dom.window as any;
    
    // Ensure our polyfills are available in the DOM window as well
    if (!(dom.window as any)['IntersectionObserver']) {
      (dom.window as any)['IntersectionObserver'] = global.IntersectionObserver;
    }
    if (!(dom.window as any)['ResizeObserver']) {
      (dom.window as any)['ResizeObserver'] = global.ResizeObserver;
    }
    if (!(dom.window as any)['MutationObserver']) {
      (dom.window as any)['MutationObserver'] = global.MutationObserver;
    }
    
    try {
      const container = global.document.getElementById('hwp-container');
      if (!container) {
        throw new Error('Failed to create container element');
      }
      
      // Initialize hwp.js viewer
      const viewer = new Viewer(container, uint8Array);
      
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
  chartExtractor: ChartExtractor,
  options: HwpParseOptions
): Promise<HwpParseResult> {
  try {
    const zip = await JSZip.loadAsync(buffer);
    
    // Find main content files in HWPX (OWPML format)
    const contentFiles = [
      'Contents/content.xml',
      'content.xml',
      'Contents/document.xml',
      'document.xml',
      'Contents/body.xml',
      'body.xml'
    ];
    
    let contentFile = null;
    let contentFileName = '';
    for (const fileName of contentFiles) {
      contentFile = zip.file(fileName);
      if (contentFile) {
        contentFileName = fileName;
        break;
      }
    }
    
    if (!contentFile) {
      throw new ParseError('HWPX', 'No content XML file found in HWPX archive');
    }
    
    // Parse XML with fast-xml-parser
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
    
    // Extract images from ZIP if requested
    const images = options.extractImages !== false ? 
      await extractHwpxImages(zip, imageExtractor) : [];
    
    // Convert OWPML structure to markdown
    const markdown = convertOwpmlToMarkdown(parsedXml);
    
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
    } catch (error) {
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
        } catch (error) {
          console.warn(`Failed to process embedded image ${index + 1}:`, error);
        }
      }
    });
  } catch (error) {
    console.warn('Failed to extract images from HWP:', error);
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
    // Look for image files in the ZIP archive
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff'];
    
    for (const [fileName, file] of Object.entries(zip.files)) {
      if (!file.dir && imageExtensions.some(ext => fileName.toLowerCase().endsWith(ext))) {
        try {
          const imageBuffer = await file.async('nodebuffer');
          const extension = path.extname(fileName).slice(1).toLowerCase();
          const baseName = path.basename(fileName, path.extname(fileName));
          const savedFileName = `${baseName}.${extension}`;
          const savedPath = path.join(imageExtractor.imageDirectory, savedFileName);
          
          // Save image using imageExtractor
          await imageExtractor.saveImage(imageBuffer, fileName);
          
          images.push({
            originalPath: fileName,
            savedPath,
            format: extension,
            size: imageBuffer.length
          });
          
        } catch (error) {
          console.warn(`Failed to extract image ${fileName}:`, error);
        }
      }
    }
  } catch (error) {
    console.warn('Failed to extract images from HWPX:', error);
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
function convertOwpmlToMarkdown(owpmlData: any): string {
  let markdown = '';
  
  try {
    // Navigate OWPML structure (HWPX uses OWPML - Office Word Processor Markup Language)
    const root = owpmlData.OWPML || owpmlData.owpml || owpmlData;
    
    if (root.body || root.Body) {
      const body = root.body || root.Body;
      markdown = processOwpmlBody(body);
    } else if (root.BODY) {
      const body = root.BODY;
      markdown = processOwpmlBody(body);
    } else {
      // Try to extract any text content from the parsed XML
      markdown = extractTextFromObject(root);
    }
    
    if (!markdown.trim()) {
      markdown = '*No readable content found in HWPX file*';
    }
    
  } catch (error) {
    console.warn('Error processing OWPML structure:', error);
    markdown = '*Error processing HWPX content*';
  }
  
  return markdown;
}

/**
 * Process OWPML body content
 */
function processOwpmlBody(body: any): string {
  let result = '';
  
  try {
    // Process sections
    if (body.section || body.Section || body.SECTION) {
      const sections = body.section || body.Section || body.SECTION;
      const sectionArray = Array.isArray(sections) ? sections : [sections];
      
      sectionArray.forEach((section: any) => {
        result += processOwpmlSection(section);
      });
    }
    
    // Process paragraphs directly in body
    if (body.p || body.P || body.PARA) {
      const paragraphs = body.p || body.P || body.PARA;
      const paraArray = Array.isArray(paragraphs) ? paragraphs : [paragraphs];
      
      paraArray.forEach((para: any) => {
        result += processOwpmlParagraph(para);
      });
    }
    
    // Fallback: extract any text
    if (!result.trim()) {
      result = extractTextFromObject(body);
    }
    
  } catch (error) {
    console.warn('Error processing OWPML body:', error);
  }
  
  return result;
}

/**
 * Process OWPML section
 */
function processOwpmlSection(section: any): string {
  let result = '';
  
  try {
    if (section.p || section.P || section.PARA) {
      const paragraphs = section.p || section.P || section.PARA;
      const paraArray = Array.isArray(paragraphs) ? paragraphs : [paragraphs];
      
      paraArray.forEach((para: any) => {
        result += processOwpmlParagraph(para);
      });
    } else {
      result = extractTextFromObject(section);
    }
  } catch (error) {
    console.warn('Error processing OWPML section:', error);
  }
  
  return result;
}

/**
 * Process OWPML paragraph
 */
function processOwpmlParagraph(para: any): string {
  let result = '';
  
  try {
    // Handle text content
    if (para['#text']) {
      result = para['#text'].toString().trim() + '\n\n';
    }
    
    // Handle runs/text runs
    if (para.run || para.RUN || para.r || para.R) {
      const runs = para.run || para.RUN || para.r || para.R;
      const runArray = Array.isArray(runs) ? runs : [runs];
      
      let paraText = '';
      runArray.forEach((run: any) => {
        if (run['#text']) {
          paraText += run['#text'].toString();
        } else if (run.t || run.T) {
          const textElements = run.t || run.T;
          const textArray = Array.isArray(textElements) ? textElements : [textElements];
          textArray.forEach((textEl: any) => {
            if (textEl['#text']) {
              paraText += textEl['#text'].toString();
            } else if (typeof textEl === 'string') {
              paraText += textEl;
            }
          });
        }
      });
      
      if (paraText.trim()) {
        result = paraText.trim() + '\n\n';
      }
    }
    
    // Fallback: extract any text from the paragraph
    if (!result.trim()) {
      result = extractTextFromObject(para);
      if (result.trim()) {
        result += '\n\n';
      }
    }
    
  } catch (error) {
    console.warn('Error processing OWPML paragraph:', error);
  }
  
  return result;
}

/**
 * Extract text from any object recursively
 */
function extractTextFromObject(obj: any): string {
  if (typeof obj === 'string') {
    return obj;
  }
  
  if (typeof obj === 'number') {
    return obj.toString();
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => extractTextFromObject(item)).join(' ');
  }
  
  if (typeof obj === 'object' && obj !== null) {
    let text = '';
    
    // Look for common text properties first
    if (obj['#text']) {
      text += obj['#text'].toString() + ' ';
    }
    
    // Recursively extract text from all properties
    for (const [key, value] of Object.entries(obj)) {
      if (key !== '#text' && key !== '@_') { // Skip attributes
        text += extractTextFromObject(value) + ' ';
      }
    }
    
    return text.trim();
  }
  
  return '';
}