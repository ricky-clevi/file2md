import JSZip from 'jszip';
import { parseStringPromise } from 'xml2js';
import path from 'node:path';
import type { Buffer } from 'node:buffer';

import type { ImageExtractor } from '../utils/image-extractor.js';
import type { ChartExtractor } from '../utils/chart-extractor.js';
import { LayoutParser } from '../utils/layout-parser.js';
import { ParseError } from '../types/errors.js';
import type { 
  ImageData, 
  ChartData, 
  LayoutElement, 
  ElementType,
  Position 
} from '../types/interfaces.js';

export interface PptxParseOptions {
  readonly preserveLayout?: boolean;
  readonly extractImages?: boolean;
  readonly extractCharts?: boolean;
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

interface SlideElement {
  type: ElementType;
  content: string | unknown;
  position?: Position;
}

interface SlideRow {
  readonly y: number;
  readonly elements: SlideElement[];
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
    const zip = await JSZip.loadAsync(buffer);
    
    // Extract images first
    const extractedImages = options.extractImages !== false 
      ? await imageExtractor.extractImagesFromZip(zip, 'ppt/')
      : [];
    
    // Extract charts if enabled
    const extractedCharts = options.extractCharts !== false
      ? await chartExtractor.extractChartsFromZip(zip, 'ppt/')
      : [];
    
    // Initialize layout parser
    const layoutParser = new LayoutParser();
    
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
      const slideContent = await extractAdvancedSlideContent(
        xmlContent, 
        imageExtractor, 
        extractedImages, 
        slideNumber, 
        layoutParser
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
        hasCharts: extractedCharts.length > 0
      }
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new ParseError('PPTX', message, error as Error);
  }
}

async function extractAdvancedSlideContent(
  xmlContent: string,
  imageExtractor: ImageExtractor,
  extractedImages: readonly ImageData[],
  slideNumber: number,
  layoutParser: LayoutParser
): Promise<string> {
  try {
    const result = await parseStringPromise(xmlContent) as any;
    
    const elements: SlideElement[] = [];
    let imageCount = 0;
    
    // Extract all shapes and their positions
    function extractShapes(obj: any, parentPos: Position = { x: 0, y: 0 }): void {
      if (typeof obj === 'object' && obj !== null) {
        if (Array.isArray(obj)) {
          for (const item of obj) {
            extractShapes(item, parentPos);
          }
        } else {
          // Check for shape positioning
          let position: Position = { ...parentPos };
          if (obj['a:off']?.[0]?.$) {
            position.x = parseInt(obj['a:off'][0].$.x) || 0;
            position.y = parseInt(obj['a:off'][0].$.y) || 0;
          }
          
          // Check for text content in shapes
          if (obj['a:t']) {
            const textElement: SlideElement = {
              type: 'text',
              content: '',
              position: position
            };
            
            if (Array.isArray(obj['a:t'])) {
              for (const textItem of obj['a:t']) {
                let text = '';
                if (typeof textItem === 'string') {
                  text = textItem;
                } else if (textItem && typeof textItem === 'object' && '_' in textItem) {
                  text = (textItem as any)._;
                }
                if (text && text.trim()) {
                  textElement.content += text.trim() + ' ';
                }
              }
            }
            
            if ((textElement.content as string).trim()) {
              elements.push(textElement);
            }
          }
          
          // Check for tables
          if (obj['a:tbl']) {
            const tableElement: SlideElement = {
              type: 'table',
              content: obj['a:tbl'],
              position: position
            };
            elements.push(tableElement);
          }
          
          // Check for images
          if (obj['a:blip'] || obj['p:pic'] || obj['a:pic']) {
            const slideImages = extractedImages.filter(img => 
              img.originalPath.includes(`slide${slideNumber}`) ||
              img.originalPath.includes('media/')
            );
            
            if (slideImages.length > imageCount) {
              const img = slideImages[imageCount];
              if (img?.savedPath) {
                const imageElement: SlideElement = {
                  type: 'image',
                  content: img.savedPath,
                  position: position
                };
                elements.push(imageElement);
                imageCount++;
              }
            }
          }
          
          // Recursively process nested objects
          for (const key in obj) {
            if (key !== 'a:t') {
              extractShapes(obj[key], position);
            }
          }
        }
      }
    }
    
    extractShapes(result);
    
    // Sort elements by position (top to bottom, left to right)
    const sortedElements = layoutParser.calculateRelativePosition(elements);
    
    // Use improved layout grouping instead of aggressive column detection
    let markdown = '';
    
    // Group elements into logical sections rather than rows/columns
    const sections = groupElementsIntoSections(sortedElements);
    
    for (const section of sections) {
      if (section.type === 'title') {
        markdown += `### ${section.content}\n\n`;
      } else if (section.type === 'paragraph') {
        markdown += `${section.content}\n\n`;
      } else if (section.type === 'table') {
        markdown += parseSlideTable(section.content, layoutParser) + '\n\n';
      } else if (section.type === 'image') {
        const filename = path.basename(section.content as string);
        markdown += imageExtractor.getImageMarkdown(`Slide ${slideNumber} Image`, filename) + '\n\n';
      } else if (section.type === 'list') {
        markdown += section.content + '\n\n';
      }
    }
    
    // If no organized content, fall back to simple extraction
    if (!markdown.trim() && extractedImages.length > 0) {
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
    }
    
    return markdown.trim();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new ParseError('PPTX', `Failed to extract advanced content from slide: ${message}`, error as Error);
  }
}

interface ContentSection {
  type: 'title' | 'paragraph' | 'table' | 'image' | 'list';
  content: string | unknown;
  position?: Position;
}

function groupElementsIntoSections(elements: SlideElement[]): ContentSection[] {
  const sections: ContentSection[] = [];
  
  for (const element of elements) {
    const content = element.content as string;
    
    if (element.type === 'text') {
      // Determine if it's a title based on position and characteristics
      const isTitle = (element.position?.y || 0) < 1000000 && 
                     content.length < 100 && 
                     content.length > 0;
      
      if (isTitle && !content.includes('\n') && !content.match(/^\d+\./)) {
        sections.push({
          type: 'title',
          content: content.trim(),
          position: element.position
        });
      } else {
        // Check if it looks like a list item
        if (content.match(/^[•\-*]\s/) || content.match(/^\d+\.\s/)) {
          sections.push({
            type: 'list',
            content: content.trim(),
            position: element.position
          });
        } else {
          sections.push({
            type: 'paragraph',
            content: content.trim(),
            position: element.position
          });
        }
      }
    } else if (element.type === 'table') {
      sections.push({
        type: 'table',
        content: element.content,
        position: element.position
      });
    } else if (element.type === 'image') {
      sections.push({
        type: 'image',
        content: element.content,
        position: element.position
      });
    }
  }
  
  return sections;
}

function formatSlideElement(
  element: SlideElement,
  layoutParser: LayoutParser,
  imageExtractor: ImageExtractor
): string {
  switch (element.type) {
    case 'text': {
      const content = element.content as string;
      // Determine if it's a title based on position and length
      if ((element.position?.y || 0) < 1000000 && content.length < 100) {
        return `### ${content.trim()}`;
      }
      return content.trim();
    }
    
    case 'table':
      // Parse PowerPoint table (simplified)
      return parseSlideTable(element.content, layoutParser);
    
    case 'image': {
      const imagePath = element.content as string;
      const filename = path.basename(imagePath);
      return imageExtractor.getImageMarkdown('Slide Image', filename);
    }
    
    default:
      return typeof element.content === 'string' ? element.content : '';
  }
}

function parseSlideTable(tableData: unknown, layoutParser: LayoutParser): string {
  // Simplified table parsing for PowerPoint
  const table = tableData as any;
  if (!table?.[0]?.['a:tr']) {
    return '';
  }
  
  const rows = table[0]['a:tr'];
  const tableStruct = { rows: [] as any[] };
  
  for (const row of rows) {
    const cells = row['a:tc'] || [];
    const rowData = { cells: [] as any[] };
    
    for (const cell of cells) {
      let cellText = '';
      
      // Extract text from cell
      if (cell['a:txBody']?.[0]?.['a:p']) {
        const paragraphs = cell['a:txBody'][0]['a:p'];
        for (const para of paragraphs) {
          if (para['a:r']?.[0]?.['a:t']?.[0]) {
            cellText += para['a:r'][0]['a:t'][0] + ' ';
          }
        }
      }
      
      rowData.cells.push({
        text: cellText.trim(),
        bold: false,
        italic: false,
        alignment: 'left',
        backgroundColor: undefined,
        colSpan: 1,
        rowSpan: 1,
        merged: false
      });
    }
    
    tableStruct.rows.push(rowData);
  }
  
  return layoutParser.parseAdvancedTable(tableStruct);
}