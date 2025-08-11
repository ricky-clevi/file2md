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

type RelationshipMap = Record<string, string>;

/**
 * Build a relationship map for HWPX content files (rId -> target zip path)
 * HWPX follows OPC; relationships are stored alongside content files:
 *   Contents/section0.xml  ->  Contents/_rels/section0.xml.rels
 */
async function buildRelationshipMap(zip: JSZip, contentFileNames: readonly string[]): Promise<RelationshipMap> {
  const relMap: RelationshipMap = {};
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', trimValues: true });

  for (const contentFileName of contentFileNames) {
    try {
      const dir = path.posix.dirname(contentFileName);
      const base = path.posix.basename(contentFileName);
    const relsPath = path.posix.join(dir, '_rels', `${base}.rels`);
      const relsFile = zip.file(relsPath);
      if (!relsFile) continue;

      const relsXml = await relsFile.async('string');
      const rels = parser.parse(relsXml) as unknown as {
        Relationships?: { Relationship?: unknown };
      };

      const relationships = (rels?.Relationships as { Relationship?: unknown })?.Relationship;
      if (!relationships) continue;

      const relArray = Array.isArray(relationships) ? relationships : [relationships];
      for (const rel of relArray) {
        const relObj = rel as Record<string, unknown>;
        const id = (relObj['@_Id'] as string) || (relObj['@_ID'] as string);
        const targetRaw = (relObj['@_Target'] as string) || (relObj['@_HRef'] as string);
        if (!id || !targetRaw) continue;

        // Normalize target to a POSIX zip path and try to resolve to an existing entry
        const tryCandidates: string[] = [];
        let target = targetRaw.replace(/\\/g, '/');
        if (target.startsWith('/')) {
          target = target.slice(1); // remove leading slash
        }
        // Candidate 1: resolve relative to the content file directory
        tryCandidates.push(path.posix.normalize(path.posix.join(dir, target)));
        // Candidate 2: as-is normalized (some rels already relative to root)
        tryCandidates.push(path.posix.normalize(target));
        // Candidate 3: strip common prefixes (e.g., Contents/)
        if (target.includes('BinData/')) {
          const tail = target.split('BinData/').pop();
          tryCandidates.push(`BinData/${tail}`);
        }

        const resolvedExisting = tryCandidates.find(c => !!zip.file(c));
        // Store with r:id as key (common in content)
        relMap[id] = resolvedExisting || tryCandidates[0];
        // Also store with potential 'r:id' prefix to increase hit rate in matching
        relMap[`r:${id}`] = relMap[id];
      }
    } catch (e) {
      console.warn('Failed to parse relationship file for', contentFileName, e);
    }
  }

  return relMap;
}

/**
 * Augment relationship map using HWPX content manifest (Contents/content.hpf)
 * This file often maps binItem ids to actual BinData/* targets.
 */
async function augmentRelationshipMapWithContentHpf(zip: JSZip, relMap: RelationshipMap): Promise<RelationshipMap> {
  const contentHpf = zip.file('Contents/content.hpf');
  if (!contentHpf) return relMap;

  try {
    const xml = await contentHpf.async('string');
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', trimValues: true });
    const parsed = parser.parse(xml) as unknown as Record<string, unknown>;

    const idToTarget: RelationshipMap = { ...relMap };

    const visit = (node: unknown, depth: number = 0) => {
      if (!node || depth > 8) return;
      if (typeof node === 'object') {
        const obj = node as Record<string, unknown>;
        const id = (obj['@_id'] as string) || (obj['@_ID'] as string) || (obj['@_itemID'] as string) || (obj['@_binItem'] as string);
        const href = (obj['@_Target'] as string) || (obj['@_HRef'] as string) || (obj['@_href'] as string) || (obj['@_path'] as string) || (obj['@_src'] as string);
        if (id && href && /BinData\//i.test(String(href))) {
          let target = String(href).replace(/\\/g, '/');
          if (target.startsWith('/')) target = target.slice(1);
          // Prefer explicit BinData prefix
          if (!target.includes('BinData/')) {
            const tail = target.split('BinData/').pop();
            if (tail) target = `BinData/${tail}`;
          }
          idToTarget[id] = path.posix.normalize(target);
        }

        for (const value of Object.values(obj)) {
          visit(value, depth + 1);
        }
      } else if (Array.isArray(node)) {
        for (const item of node) visit(item, depth + 1);
      }
    };

    visit(parsed, 0);
    return idToTarget;
  } catch (e) {
    console.warn('Failed to parse content.hpf for binItem mapping:', e);
    return relMap;
  }
}

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
      
      // Initialize hwp.js viewer with error handling
      let viewer: unknown;
      try {
        viewer = new Viewer(container, uint8Array);
        
        // Check if viewer was created successfully
        if (!viewer) {
          throw new Error('Viewer instance is null or undefined');
        }
        
        // Verify viewer has expected properties
        const viewerObj = viewer as { type?: string };
        if (viewerObj && typeof viewerObj === 'object') {
          console.log('Viewer created successfully');
        }
        
      } catch (viewerError) {
        console.warn('Failed to initialize hwp.js Viewer:', viewerError);
        throw new Error(`hwp.js Viewer initialization failed: ${viewerError instanceof Error ? viewerError.message : 'Unknown error'}`);
      }
      
      // Wait longer for viewer to process the document and render content
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Try multiple approaches to extract actual content
      let textContent: string[] = [];
      
      // Attempt 1: Extract from viewer container
      textContent = extractTextFromViewer(container);
      
      // Attempt 2: If no meaningful content found, try direct viewer access
      if (textContent.length === 0 || isOnlyCopyrightMessage(textContent)) {
        textContent = extractFromViewerInstance(viewer, container);
      }
      
      // Attempt 3: If still no content, try broader DOM extraction
      if (textContent.length === 0 || isOnlyCopyrightMessage(textContent)) {
        textContent = extractFromEntireContainer(container);
      }
      
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
    
    // Extract images from ZIP if requested (do this before parsing to pass images to parser)
    const images = options.extractImages !== false ? 
      await extractHwpxImages(zip, imageExtractor) : [];

    // Build relationships map for all content files we will parse
    const relContentFiles = sectionFiles.length > 0 ? sectionFiles.sort() : [contentFileName];
    let relationshipMap = await buildRelationshipMap(zip, relContentFiles);
    relationshipMap = await augmentRelationshipMapWithContentHpf(zip, relationshipMap);
    
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
          const sectionMarkdown = convertOwpmlToMarkdown(parsedXml, images, relationshipMap);
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
      allContent = convertOwpmlToMarkdown(parsedXml, images, relationshipMap);
    }
    
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
 * Check if text is the Korean copyright message from hwp.js
 */
function isCopyrightMessage(text: string): boolean {
  const copyrightPatterns = [
    /본\s*제품은\s*한글과컴퓨터의\s*한\/글\s*문서\s*파일/,
    /Copyright\s*2020\s*Han\s*Lee/,
    /hanlee\.dev@gmail\.com/,
    /개발하였습니다/,
    /참고하여\s*개발/,
    /공개\s*문서를\s*참고/
  ];
  
  return copyrightPatterns.some(pattern => pattern.test(text));
}

/**
 * Check if the entire content array contains only copyright messages
 */
function isOnlyCopyrightMessage(paragraphs: string[]): boolean {
  if (paragraphs.length === 0) return true;
  
  const nonCopyrightContent = paragraphs.filter(p => !isCopyrightMessage(p) && p.trim().length > 0);
  return nonCopyrightContent.length === 0;
}

/**
 * Attempt to extract content directly from hwp.js viewer instance
 */
function extractFromViewerInstance(viewer: unknown, _container: Element): string[] {
  const paragraphs: string[] = [];
  
  try {
    // Try to access viewer's internal content if available
    const viewerObj = viewer as { content?: unknown; document?: unknown; text?: string; pages?: unknown[] };
    
    if (viewerObj.text) {
      const text = viewerObj.text.trim();
      if (text && !isCopyrightMessage(text)) {
        paragraphs.push(...text.split(/\n\s*\n/).filter(p => p.trim().length > 0));
      }
    }
    
    if (viewerObj.pages && Array.isArray(viewerObj.pages)) {
      for (const page of viewerObj.pages) {
        const pageObj = page as { text?: string; content?: string };
        if (pageObj.text && !isCopyrightMessage(pageObj.text)) {
          paragraphs.push(...pageObj.text.split(/\n\s*\n/).filter(p => p.trim().length > 0));
        }
        if (pageObj.content && !isCopyrightMessage(pageObj.content)) {
          paragraphs.push(...pageObj.content.split(/\n\s*\n/).filter(p => p.trim().length > 0));
        }
      }
    }
  } catch (e) {
    console.warn('Failed to extract from viewer instance:', e);
  }
  
  return paragraphs.filter(p => !isCopyrightMessage(p));
}

/**
 * Extract all text from container, including from child elements
 */
function extractFromEntireContainer(container: Element): string[] {
  const paragraphs: string[] = [];
  
  try {
    // Get all text nodes recursively
    const ownerDocument = container.ownerDocument;
    if (!ownerDocument) {
      throw new Error('No owner document found');
    }
    
    const walker = ownerDocument.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT,
      null
    );
    
    const textNodes: string[] = [];
    let node = walker.nextNode();
    while (node !== null) {
      const text = node.textContent?.trim();
      if (text && text.length > 2 && !isCopyrightMessage(text)) {
        textNodes.push(text);
      }
      node = walker.nextNode();
    }
    
    // Combine adjacent text nodes and split by natural breaks
    const combinedText = textNodes.join(' ').trim();
    if (combinedText) {
      const lines = combinedText.split(/[\r\n]+/).filter(line => {
        const trimmed = line.trim();
        return trimmed.length > 0 && !isCopyrightMessage(trimmed);
      });
      paragraphs.push(...lines.map(line => line.trim()));
    }
  } catch (e) {
    console.warn('Failed to extract from entire container:', e);
    
    // Final fallback: just get textContent and clean it up
    const allText = container.textContent?.trim();
    if (allText && !isCopyrightMessage(allText)) {
      const cleaned = allText
        .split(/[\r\n]+/)
        .map(line => line.trim())
        .filter(line => line.length > 0 && !isCopyrightMessage(line));
      paragraphs.push(...cleaned);
    }
  }
  
  return paragraphs.filter(p => !isCopyrightMessage(p));
}

/**
 * Extract text content from hwp.js rendered DOM
 */
function extractTextFromViewer(container: Element): string[] {
  const paragraphs: string[] = [];
  
  // Look for various text-containing elements, with improved hwp.js specific selectors
  const textSelectors = [
    // hwp.js specific selectors (v0.0.3 might use these)
    '.hwp-para',
    '.hwp-text',
    '.hwp-line',
    '.hwp-char',
    '[data-hwp-text]',
    '[data-text]',
    '[data-content]',
    // Generic selectors as fallback
    'p',
    'div[data-type="paragraph"]',
    'div[data-type="text"]',
    'span[data-type="text"]',
    'div[style*="text"]',
    'span',
    'div'
  ];
  
  for (const selector of textSelectors) {
    try {
      const elements = container.querySelectorAll(selector);
      elements.forEach(element => {
        const text = element.textContent?.trim();
        if (text && text.length > 0 && !paragraphs.includes(text) && !isCopyrightMessage(text)) {
          paragraphs.push(text);
        }
      });
      
      // Only break if we found meaningful content (not just copyright)
      if (paragraphs.length > 0 && !isOnlyCopyrightMessage(paragraphs)) break;
    } catch {
      continue; // Try next selector
    }
  }
  
  // Fallback: get all text content and filter
  if (paragraphs.length === 0 || isOnlyCopyrightMessage(paragraphs)) {
    const allText = container.textContent?.trim();
    if (allText) {
      // Split by common paragraph separators
      const lines = allText.split(/\n\s*\n|\r\n\s*\r\n|\n/);
      const filteredLines = lines
        .filter(line => line.trim().length > 0)
        .filter(line => !isCopyrightMessage(line.trim()))
        .map(line => line.trim());
      
      if (filteredLines.length > 0) {
        paragraphs.length = 0; // Clear any copyright-only content
        paragraphs.push(...filteredLines);
      }
    }
  }
  
  return paragraphs.filter(p => !isCopyrightMessage(p));
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
  // Filter out any remaining copyright messages
  const filteredContent = textContent.filter(p => !isCopyrightMessage(p) && p.trim().length > 0);
  
  if (filteredContent.length === 0) {
    return '*No readable content found in HWP file. The file may be corrupted, encrypted, or contain only images/graphics.*';
  }
  
  let markdown = '';
  
  filteredContent.forEach((paragraph, index) => {
    if (paragraph.trim().length === 0) return;
    
    // Simple heuristics for formatting
    if (paragraph.length < 50 && index === 0 && !paragraph.match(/^[0-9]+\./)) {
      // Likely a title
      markdown += `# ${paragraph}\n\n`;
    } else if (paragraph.match(/^[0-9]+\./)) {
      // Numbered list item
      markdown += `${paragraph}\n`;
    } else if (paragraph.match(/^[-•*]/)) {
      // Bullet list item
      markdown += `${paragraph}\n`;
    } else {
      // Regular paragraph
      markdown += `${paragraph}\n\n`;
    }
  });
  
  const result = markdown.trim();
  
  // Final check - if we only got copyright or very short content, provide helpful message
  if (result.length < 10 || isCopyrightMessage(result)) {
    return '*Unable to extract meaningful content from HWP file. This may be due to the limitations of the hwp.js library version 0.0.3 or the file format. Consider converting the file to HWPX format for better results.*';
  }
  
  return result;
}

/**
 * Convert OWPML structure to markdown
 */
function convertOwpmlToMarkdown(owpmlData: unknown, images: readonly ImageData[] = [], relationshipMap: RelationshipMap = {}): string {
  let markdown = '';
  
  try {
    // HWPX uses hp:p for paragraphs and hp:t for text
    // Navigate the structure to find text nodes and image references
    const contentItems: {type: 'text' | 'image', content: string, position: number}[] = [];
    const positionCounter = { value: 0 };
    
    // Extract all text content and image references recursively
    extractContentNodes(owpmlData, contentItems, positionCounter, images, relationshipMap);
    
    // Sort by position to maintain document order
    contentItems.sort((a, b) => a.position - b.position);
    
    // Build markdown with text and image references
    if (contentItems.length > 0) {
      const markdownParts: string[] = [];
      
      for (const item of contentItems) {
        if (item.type === 'text' && item.content.trim().length > 0) {
          markdownParts.push(item.content);
        } else if (item.type === 'image' && item.content.trim().length > 0) {
          markdownParts.push(item.content);
        }
      }
      
      markdown = markdownParts.join('\n\n');
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
 * Extract content nodes (text and images) from OWPML structure
 */
function extractContentNodes(
  obj: unknown,
  contentItems: {type: 'text' | 'image', content: string, position: number}[],
  positionCounter: {value: number},
  images: readonly ImageData[],
  relationshipMap: RelationshipMap
): void {
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
      contentItems.push({
        type: 'text',
        content: trimmed,
        position: positionCounter.value++
      });
    }
    return;
  }
  
  // If it's an array, process each item
  if (Array.isArray(obj)) {
    for (const item of obj) {
      extractContentNodes(item, contentItems, positionCounter, images, relationshipMap);
    }
    return;
  }
  
  // If it's an object, look for content
  if (typeof obj === 'object' && obj !== null) {
    // Check for image/drawing references in HWPX
    // HWPX can have hp:pic, PICTURE, IMAGE, or drawing objects
    if ((obj as Record<string, unknown>)['hp:pic'] || (obj as Record<string, unknown>)['PICTURE'] || (obj as Record<string, unknown>)['IMAGE'] || 
        (obj as Record<string, unknown>)['hp:draw'] || (obj as Record<string, unknown>)['DRAWING']) {
      // Try to find a matching image and insert reference
      const imageRef = findImageReference(obj, images, relationshipMap);
      if (imageRef) {
        contentItems.push({
          type: 'image',
          content: imageRef,
          position: positionCounter.value++
        });
      }
    }
    
    // HWPX specific text node handling
    // Look for hp:p (paragraphs) and hp:t (text) nodes
    if ((obj as { 'hp:p'?: unknown })['hp:p']) {
      const paragraphs = Array.isArray((obj as { 'hp:p': unknown })['hp:p']) ? (obj as { 'hp:p': unknown[] })['hp:p'] : [(obj as { 'hp:p': unknown })['hp:p']];
      for (const para of paragraphs) {
        extractParagraphContent(para, contentItems, positionCounter, images, relationshipMap);
      }
    }
    
    // Also check for plain p nodes
    if ((obj as { p?: unknown }).p) {
      const paragraphs = Array.isArray((obj as { p: unknown }).p) ? (obj as { p: unknown[] }).p : [(obj as { p: unknown }).p];
      for (const para of paragraphs) {
        extractParagraphContent(para, contentItems, positionCounter, images, relationshipMap);
      }
    }
    
    // Check for TEXT nodes
    if ((obj as { TEXT?: unknown }).TEXT) {
      const textNodes = Array.isArray((obj as { TEXT: unknown }).TEXT) ? (obj as { TEXT: unknown[] }).TEXT : [(obj as { TEXT: unknown }).TEXT];
      for (const textNode of textNodes) {
        if ((textNode as { '#text'?: string })['#text']) {
          const text = (textNode as { '#text': string })['#text'].trim();
          if (text && !isMetadata(text)) {
            contentItems.push({
              type: 'text',
              content: text,
              position: positionCounter.value++
            });
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
        extractContentNodes(value, contentItems, positionCounter, images, relationshipMap);
      }
    }
  }
}

/**
 * Find image reference based on drawing/picture object
 */
function findImageReference(
  drawingObj: unknown,
  images: readonly ImageData[],
  relationshipMap: RelationshipMap
): string | null {
  // Reset global counter at the start of each conversion to ensure fresh sequence
  // This is a simple approach - in production you might want a more sophisticated reset mechanism
  if (images.length > 0 && (!('__globalImageCounter' in findImageReference) || (findImageReference as any).__globalImageCounter >= images.length * 2)) {
    (findImageReference as any).__globalImageCounter = 0;
    console.log('[DEBUG] Reset global image counter for new conversion');
  }
  if (!images || images.length === 0) return null;
  
  try {
    // Try to find an image ID or reference in the drawing object
    const obj = drawingObj as Record<string, unknown>;
    
    // Look for common image reference patterns
    let imageId: string | null = null;
    
    // Helper: recursively search for an image relationship id within the drawing object
    const findRidDeep = (o: unknown, depth: number = 0): string | null => {
      if (!o || depth > 4) return null;
      if (typeof o !== 'object') return null;
      const r = o as Record<string, unknown>;
      const directId = (r['@_id'] as string) || (r['@_refId'] as string) || (r['@_href'] as string) ||
                       (r['@_r:id'] as string) || (r['@_rId'] as string) || (r['@_rid'] as string) ||
                       (r['refId'] as string) || (r['r:id'] as string);
      if (directId && typeof directId === 'string') return directId;
      for (const v of Object.values(r)) {
        const nested = findRidDeep(v, depth + 1);
        if (nested) return nested;
      }
      return null;
    };

    imageId = findRidDeep(obj);
    
    // If we found an ID, try to match it with our extracted images
    if (imageId && typeof imageId === 'string') {
      // Resolve via relationships first (rId -> target path inside zip)
      // Normalize id to check variants (with/without r:)
      const variants = [imageId, imageId.startsWith('r:') ? imageId.slice(2) : `r:${imageId}`];
      const targetPath = variants.map(v => relationshipMap[v]).find(Boolean) as string | undefined;
      let matchingImage: ImageData | undefined;
      if (targetPath) {
        matchingImage = images.find(img => img.originalPath.replace(/\\/g, '/').toLowerCase() === targetPath.toLowerCase());
        // Also try endsWith for safety if some paths differ in prefixes
        if (!matchingImage) {
          matchingImage = images.find(img => targetPath.toLowerCase().endsWith(img.originalPath.replace(/\\/g, '/').toLowerCase()) || img.originalPath.replace(/\\/g, '/').toLowerCase().endsWith(targetPath.toLowerCase()));
        }
      }
      // Fallback to substring match
      if (!matchingImage && typeof imageId === 'string') {
        matchingImage = images.find(img => img.originalPath.includes(imageId) || img.savedPath.includes(imageId));
      }
      if (matchingImage) {
        const imageName = path.basename(matchingImage.savedPath);
        const markdownRef = `![Image](images/${imageName})`;
        console.log(`[DEBUG] Found matching image: ${markdownRef} (originalPath: ${matchingImage.originalPath}, savedPath: ${matchingImage.savedPath})`);
        return markdownRef;
      }
    }

    // If no rId path, look for direct BinData references OR binItem id links
    const findDirectImageTarget = (o: unknown, depth: number = 0): string | null => {
      if (!o || depth > 6) return null;
      if (typeof o === 'string') {
        const s = o.trim();
        const m = s.match(/BinData\/[\w.-]+\.(png|jpg|jpeg|gif|bmp|tiff)/i);
        if (m) return m[0];
        return null;
      }
      if (typeof o === 'object') {
        const r = o as Record<string, unknown>;
        // Check common attributes
        const candidates = [r['@_Target'], r['@_HRef'], r['@_src'], r['@_href'], r['@_path'], r['@_file']];
        for (const c of candidates) {
          const found = findDirectImageTarget(c, depth + 1);
          if (found) return found;
        }
        // If binItem id present, map via relationshipMap as a second step
        const binId = (r['@_binItemRef'] as string) || (r['@_binItem'] as string) || (r['@_idref'] as string) || (r['@_idRef'] as string);
        if (binId && relationshipMap[binId]) {
          return relationshipMap[binId];
        }
        for (const v of Object.values(r)) {
          const found = findDirectImageTarget(v, depth + 1);
          if (found) return found;
        }
      }
      return null;
    };

    const directTarget = findDirectImageTarget(obj);
    if (directTarget) {
      const targetLc = directTarget.replace(/\\/g, '/').toLowerCase();
      const matchingImage = images.find(img => {
        const origLc = img.originalPath.replace(/\\/g, '/').toLowerCase();
        return origLc === targetLc || origLc.endsWith(targetLc) || targetLc.endsWith(origLc);
      });
      if (matchingImage) {
        const imageName = path.basename(matchingImage.savedPath);
        const markdownRef = `![Image](images/${imageName})`;
        console.log(`[DEBUG] Found direct target match: ${markdownRef} (originalPath: ${matchingImage.originalPath}, savedPath: ${matchingImage.savedPath})`);
        return markdownRef;
      }
    }
    
    // If no specific match found, but we do have extracted images, use a global counter
    // to ensure each image reference gets a different image in sequence
    if (!('__globalImageCounter' in findImageReference)) {
      (findImageReference as any).__globalImageCounter = 0;
    }
    const globalCounter = (findImageReference as any).__globalImageCounter;
    const selected = images[globalCounter % images.length];
    (findImageReference as any).__globalImageCounter = globalCounter + 1;
    
    if (selected) {
      const imageName = path.basename(selected.savedPath);
      const markdownRef = `![Image](images/${imageName})`;
      console.log(`[DEBUG] Using sequential image reference: ${markdownRef} (counter: ${globalCounter}, total images: ${images.length})`);
      console.log(`[DEBUG] Selected image: originalPath=${selected.originalPath}, savedPath=${selected.savedPath}`);
      return markdownRef;
    }
    console.log(`[DEBUG] No fallback image available (total images: ${images.length})`);
    return null;
    
  } catch (e) {
    console.warn('Error finding image reference:', e);
  }
  
  return null;
}

/**
 * Extract content from a paragraph node (both text and images)
 */
function extractParagraphContent(
  para: unknown,
  contentItems: {type: 'text' | 'image', content: string, position: number}[],
  positionCounter: {value: number},
  images: readonly ImageData[],
  relationshipMap: RelationshipMap
): void {
  if (!para) return;
  
  // Check for images/drawings in paragraph first
  const obj = para as Record<string, unknown>;
  if (obj['hp:pic'] || obj['PICTURE'] || obj['IMAGE'] || obj['hp:draw'] || obj['DRAWING']) {
    const imageRef = findImageReference(obj, images, relationshipMap);
    if (imageRef) {
      contentItems.push({
        type: 'image',
        content: imageRef,
        position: positionCounter.value++
      });
    }
  }
  
  // Then extract text content using the original logic
  extractParagraphText(para, contentItems, positionCounter);
}


/**
 * Extract text from a paragraph node (legacy function)
 */
function extractParagraphText(para: unknown, contentItems: {type: 'text' | 'image', content: string, position: number}[], positionCounter: {value: number}): void {
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
            contentItems.push({
              type: 'text',
              content: text,
              position: positionCounter.value++
            });
          }
        } else if ((textNode as { '#text'?: string })['#text']) {
          const text = (textNode as { '#text': string })['#text'].trim();
          if (text && !isMetadata(text)) {
            contentItems.push({
              type: 'text',
              content: text,
              position: positionCounter.value++
            });
          }
        }
      }
    }
  }
  
  // Also check for direct text content
  if ((para as { '#text'?: string })['#text']) {
    const text = (para as { '#text': string })['#text'].trim();
    if (text && !isMetadata(text)) {
      contentItems.push({
        type: 'text',
        content: text,
        position: positionCounter.value++
      });
    }
  }
  
  // Check for TEXT child nodes
  if ((para as { TEXT?: unknown }).TEXT) {
    const textNodes = Array.isArray((para as { TEXT: unknown }).TEXT) ? (para as { TEXT: unknown[] }).TEXT : [(para as { TEXT: unknown }).TEXT];
    for (const textNode of textNodes) {
      if ((textNode as { '#text'?: string })['#text']) {
        const text = (textNode as { '#text': string })['#text'].trim();
        if (text && !isMetadata(text)) {
          contentItems.push({
            type: 'text',
            content: text,
            position: positionCounter.value++
          });
        }
      } else if (typeof textNode === 'string') {
        const text = textNode.trim();
        if (text && !isMetadata(text)) {
          contentItems.push({
            type: 'text',
            content: text,
            position: positionCounter.value++
          });
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
