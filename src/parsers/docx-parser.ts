import JSZip from 'jszip';
import { parseStringPromise } from 'xml2js';
import type { Buffer } from 'node:buffer';

import type { ImageExtractor } from '../utils/image-extractor.js';
import type { ChartExtractor } from '../utils/chart-extractor.js';
import { LayoutParser } from '../utils/layout-parser.js';
import { ParseError, InvalidFileError } from '../types/errors.js';
import type { 
  ImageData, 
  ChartData, 
  CellData, 
  RowData, 
  TableData,
  TextAlignment 
} from '../types/interfaces.js';

export interface DocxParseOptions {
  readonly preserveLayout?: boolean;
  readonly extractImages?: boolean;
  readonly extractCharts?: boolean;
}

export interface DocxParseResult {
  readonly markdown: string;
  readonly images: readonly ImageData[];
  readonly charts: readonly ChartData[];
  readonly metadata: Record<string, unknown>;
}

interface DocxElement {
  readonly 'w:p'?: readonly unknown[];
  readonly 'w:tbl'?: readonly unknown[];
}

interface DocxBody {
  readonly 'w:p'?: readonly unknown[];
  readonly 'w:tbl'?: readonly unknown[];
}

interface DocxDocument {
  readonly 'w:document': readonly [{
    readonly 'w:body': readonly [DocxBody];
  }];
}

interface ParagraphData {
  readonly text: string;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly alignment: TextAlignment;
  readonly fontSize: number | string;
  readonly isList: boolean;
  readonly listLevel: number;
}

/**
 * Parse DOCX buffer and convert to markdown with layout preservation
 */
export async function parseDocx(
  buffer: Buffer,
  imageExtractor: ImageExtractor,
  chartExtractor: ChartExtractor,
  options: DocxParseOptions = {}
): Promise<DocxParseResult> {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const documentXml = zip.file('word/document.xml');
    
    if (!documentXml) {
      throw new InvalidFileError('Invalid DOCX file: missing document.xml');
    }
    
    // Extract images first
    const extractedImages = options.extractImages !== false 
      ? await imageExtractor.extractImagesFromZip(zip, 'word/')
      : [];
    
    // Extract charts if enabled
    const extractedCharts = options.extractCharts !== false
      ? await chartExtractor.extractChartsFromZip(zip, 'word/')
      : [];
    
    // Initialize layout parser
    const layoutParser = new LayoutParser();
    
    const xmlContent = await documentXml.async('string');
    const result = await parseStringPromise(xmlContent) as DocxDocument;
    
    const body = result['w:document'][0]['w:body'][0];
    let markdown = '';
    
    // Process paragraphs
    for (const element of body['w:p'] || []) {
      const paragraph = await parseParagraph(element, imageExtractor, extractedImages);
      if (paragraph.trim()) {
        markdown += paragraph + '\n\n';
      }
    }
    
    // Process tables
    for (const table of body['w:tbl'] || []) {
      const tableMarkdown = await parseAdvancedTable(table, layoutParser, imageExtractor, extractedImages);
      if (tableMarkdown.trim()) {
        markdown += tableMarkdown + '\n\n';
      }
    }
    
    return {
      markdown: markdown.trim(),
      images: extractedImages,
      charts: extractedCharts.map(chart => chart.data),
      metadata: {
        paragraphCount: (body['w:p'] || []).length,
        tableCount: (body['w:tbl'] || []).length
      }
    };
  } catch (error: unknown) {
    if (error instanceof InvalidFileError) {
      throw error;
    }
    
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new ParseError('DOCX', message, error as Error);
  }
}

async function parseAdvancedTable(
  table: unknown,
  layoutParser: LayoutParser,
  imageExtractor: ImageExtractor,
  extractedImages: readonly ImageData[]
): Promise<string> {
  const tableData = table as any;
  const rows = tableData['w:tr'] || [];
  if (rows.length === 0) return '';

  const tableStruct: TableData = { rows: [] };
  
  for (const row of rows) {
    const cells = row['w:tc'] || [];
    const rowData: RowData = { cells: [] };
    
    for (const cell of cells) {
      const cellData: CellData = {
        text: '',
        bold: false,
        italic: false,
        alignment: 'left' as TextAlignment,
        backgroundColor: undefined,
        colSpan: 1,
        rowSpan: 1,
        merged: false
      };
      
      // Extract cell properties
      const tcPr = cell['w:tcPr'];
      if (tcPr?.[0]) {
        // Check for merged cells
        if (tcPr[0]['w:gridSpan']) {
          cellData.colSpan = parseInt(tcPr[0]['w:gridSpan'][0].$.val) || 1;
        }
        if (tcPr[0]['w:vMerge']) {
          cellData.merged = true;
        }
        
        // Check for background color
        if (tcPr[0]['w:shd']?.[0]?.$.fill) {
          cellData.backgroundColor = tcPr[0]['w:shd'][0].$.fill;
        }
      }
      
      // Extract cell content
      if (cell['w:p']) {
        const cellTexts: string[] = [];
        for (const paragraph of cell['w:p']) {
          const paragraphData = await parseAdvancedParagraph(paragraph, imageExtractor, extractedImages);
          if (paragraphData.text.trim()) {
            cellTexts.push(paragraphData.text);
            
            // Inherit formatting from paragraph
            if (paragraphData.bold) cellData.bold = true;
            if (paragraphData.italic) cellData.italic = true;
            if (paragraphData.alignment !== 'left') cellData.alignment = paragraphData.alignment;
          }
        }
        cellData.text = cellTexts.join(' ');
      }
      
      rowData.cells.push(cellData);
    }
    
    tableStruct.rows.push(rowData);
  }
  
  return layoutParser.parseAdvancedTable(tableStruct, {
    preserveAlignment: true,
    showBorders: true,
    preserveColors: true
  });
}

async function parseAdvancedParagraph(
  paragraph: unknown,
  imageExtractor: ImageExtractor,
  extractedImages: readonly ImageData[]
): Promise<ParagraphData> {
  const para = paragraph as any;
  let text = '';
  let bold = false;
  let italic = false;
  let alignment: TextAlignment = 'left';
  let fontSize: number | string = 'normal';
  let isList = false;
  let listLevel = 0;
  
  // Check paragraph properties
  const pPr = para['w:pPr'];
  if (pPr?.[0]) {
    // Check alignment
    if (pPr[0]['w:jc']?.[0]?.$.val) {
      const alignValue = pPr[0]['w:jc'][0].$.val;
      alignment = (['left', 'center', 'right', 'justify'].includes(alignValue) 
        ? alignValue 
        : 'left') as TextAlignment;
    }
    
    // Check if it's a list
    if (pPr[0]['w:numPr']) {
      isList = true;
      if (pPr[0]['w:numPr'][0]['w:ilvl']) {
        listLevel = parseInt(pPr[0]['w:numPr'][0]['w:ilvl'][0].$.val) || 0;
      }
    }
  }
  
  if (para['w:r']) {
    for (const run of para['w:r']) {
      // Check for images/drawings
      if (run['w:drawing'] || run['w:pict']) {
        const imageRef = await extractImageFromRun(run, imageExtractor, extractedImages);
        if (imageRef) {
          text += imageRef + '\n';
        }
      }
      
      // Extract text with formatting
      if (run['w:t']) {
        let runText = '';
        for (const textElement of run['w:t']) {
          if (typeof textElement === 'string') {
            runText += textElement;
          } else if (textElement && typeof textElement === 'object' && '_' in textElement) {
            runText += (textElement as any)._;
          }
        }
        
        // Apply formatting
        const rPr = run['w:rPr']?.[0];
        if (rPr) {
          if (rPr['w:b']) {
            runText = `**${runText}**`;
            bold = true;
          }
          if (rPr['w:i']) {
            runText = `*${runText}*`;
            italic = true;
          }
          if (rPr['w:sz']?.[0]?.$.val) {
            fontSize = parseInt(rPr['w:sz'][0].$.val) / 2; // Convert half-points to points
          }
        }
        
        text += runText;
      }
    }
  }
  
  // Apply list formatting
  if (isList && text.trim()) {
    const indent = '  '.repeat(listLevel);
    text = `${indent}- ${text.trim()}`;
  }
  
  // Apply heading formatting
  if (pPr?.[0]?.['w:pStyle']?.[0]?.$.val) {
    const styleVal = pPr[0]['w:pStyle'][0].$.val;
    if (styleVal && (styleVal.includes('Heading') || styleVal.includes('heading'))) {
      const match = styleVal.match(/(\d+)/);
      if (match) {
        const headingLevel = parseInt(match[1]);
        const hashes = '#'.repeat(Math.min(headingLevel, 6));
        text = `${hashes} ${text.trim()}`;
      }
    }
  }
  
  // Apply font size formatting
  if (fontSize !== 'normal' && text.trim()) {
    const layoutParser = new LayoutParser();
    text = layoutParser.formatWithSize(text, fontSize);
  }
  
  return {
    text,
    bold,
    italic,
    alignment,
    fontSize,
    isList,
    listLevel
  };
}

async function parseParagraph(
  paragraph: unknown,
  imageExtractor: ImageExtractor,
  extractedImages: readonly ImageData[]
): Promise<string> {
  const advancedData = await parseAdvancedParagraph(paragraph, imageExtractor, extractedImages);
  return advancedData.text;
}

async function extractImageFromRun(
  run: unknown,
  imageExtractor: ImageExtractor,
  extractedImages: readonly ImageData[]
): Promise<string | null> {
  // This is a simplified image extraction - in reality, we'd need to parse the drawing XML
  // and match it with the extracted images
  if (extractedImages.length > 0) {
    const img = extractedImages.find(img => img.savedPath);
    if (img) {
      return imageExtractor.getImageMarkdown('Document Image', img.savedPath);
    }
  }
  return null;
}