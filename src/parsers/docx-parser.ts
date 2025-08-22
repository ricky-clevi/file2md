import JSZip from 'jszip';
import { parseStringPromise, type ParserOptions } from 'xml2js';
import path from 'node:path';
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

interface DocxBody {
  readonly 'w:p'?: readonly unknown[];
  readonly 'w:tbl'?: readonly unknown[];
}

// interface DocxDocument {
//   readonly 'w:document': readonly [{
//     readonly 'w:body': readonly [DocxBody];
//   }];
// }

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
  
    
    // Try parsing with different options to handle namespaces
    const parseOptions: ParserOptions = {
      explicitCharkey: false,
      trim: true,
      normalize: true,
      explicitRoot: true,  // Keep the root element
      emptyTag: () => null,
      explicitChildren: false,
      charsAsChildren: false,
      includeWhiteChars: false,
      mergeAttrs: false,
      attrNameProcessors: [],
      attrValueProcessors: [],
      tagNameProcessors: [],
      valueProcessors: []
    };

    const result = await parseStringPromise(xmlContent, parseOptions) as Record<string, unknown>;
    
    // Handle both array and non-array XML parsing results
    // The structure should be: result['w:document'] -> document element
    let document: { 'w:body': readonly [DocxBody] } | undefined;
    
    if (result['w:document']) {
      // If w:document exists directly
      document = Array.isArray(result['w:document']) ? result['w:document'][0] : result['w:document'];
    } else if (result['w:body']) {
      // If w:body is at the top level (no document wrapper), create a synthetic document
      const bodyNode = result['w:body'];
      document = {
        'w:body': Array.isArray(bodyNode)
          ? (bodyNode as [DocxBody])
          : [bodyNode as DocxBody]
      };
    } else {
      // Check if document exists under a different key
      throw new ParseError('DOCX', 'Invalid DOCX structure - Missing document element', new Error('Missing document element'));
    }
    
    
    const body: DocxBody | undefined = document['w:body']?.[0];
    
    if (!body) {
      throw new ParseError('DOCX', 'Invalid DOCX structure - Missing document body', new Error('Missing document body'));
    }
    let markdown = '';
    
    // Process paragraphs
    for (const element of body['w:p'] || []) {
      const paragraph = await parseParagraph(element, imageExtractor, extractedImages);
      if (paragraph.trim()) {
        markdown += `${paragraph}\n\n`;
      }
    }
    
    // Process tables
    for (const table of body['w:tbl'] || []) {
      const tableMarkdown = await parseAdvancedTable(table, layoutParser, imageExtractor, extractedImages);
      if (tableMarkdown.trim()) {
        markdown += `${tableMarkdown}\n\n`;
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
  const tableData = table as { 'w:tr'?: readonly unknown[] };
  const rows = tableData['w:tr'] || [];
  if (rows.length === 0) return '';

  const tableStruct: TableData = { rows: [] };
  
  for (const row of rows) {
    const cells = (row as { 'w:tc'?: readonly unknown[] })['w:tc'] || [];
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
      const tcPr = (cell as { 'w:tcPr'?: readonly { 'w:gridSpan'?: readonly { $: { val: string } }[], 'w:vMerge'?: readonly unknown[], 'w:shd'?: readonly { $: { fill: string } }[] }[] })['w:tcPr'];
      if (tcPr?.[0]) {
        // Check for merged cells
        if (tcPr[0]['w:gridSpan']) {
          cellData.colSpan = parseInt(tcPr[0]['w:gridSpan'][0].$.val, 10) || 1;
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
      const cellContent = (cell as { 'w:p'?: readonly unknown[] });
      if (cellContent['w:p']) {
        const cellTexts: string[] = [];
        for (const paragraph of cellContent['w:p']) {
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
  const para = paragraph as { 'w:pPr'?: readonly { 'w:jc'?: readonly { $: { val: string } }[], 'w:numPr'?: readonly { 'w:ilvl'?: readonly { $: { val: string } }[] }[], 'w:pStyle'?: readonly { $: { val: string } }[] }[], 'w:r'?: readonly unknown[] };
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
        listLevel = parseInt(pPr[0]['w:numPr'][0]['w:ilvl'][0].$.val, 10) || 0;
      }
    }
  }
  
  if (para['w:r']) {
    for (const run of para['w:r']) {
      // Check for images/drawings
      if ((run as { 'w:drawing'?: unknown, 'w:pict'?: unknown })['w:drawing'] || (run as { 'w:drawing'?: unknown, 'w:pict'?: unknown })['w:pict']) {
        const imageRef = await extractImageFromRun(run, imageExtractor, extractedImages);
        if (imageRef) {
          text += `${imageRef}\n`;
        }
      }
      
      // Extract text with formatting
      const textContent = (run as { 'w:t'?: readonly (string | { _: string })[] });
      if (textContent['w:t']) {
        let runText = '';
        for (const textElement of textContent['w:t']) {
          if (typeof textElement === 'string') {
            runText += textElement;
          } else if (textElement && typeof textElement === 'object' && '_' in textElement) {
            runText += (textElement as { _: string })._;
          }
        }
        
        // Apply formatting
        const rPr = (run as { 'w:rPr'?: readonly { 'w:b'?: unknown, 'w:i'?: unknown, 'w:sz'?: readonly { $: { val: string } }[] }[] })['w:rPr']?.[0];
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
            fontSize = parseInt(rPr['w:sz'][0].$.val, 10) / 2; // Convert half-points to points
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
        const headingLevel = parseInt(match[1], 10);
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
  const runData = run as {
    'w:drawing'?: readonly [{
      'wp:inline'?: readonly [{
        'a:graphic'?: readonly [{
          'a:graphicData'?: readonly [{
            'pic:pic'?: readonly [{
              'pic:blipFill'?: readonly [{
                'a:blip'?: readonly [{ $?: { 'r:embed'?: string } }];
              }];
            }];
          }];
        }];
      }];
    }];
    'w:pict'?: readonly [{
      'v:shape'?: readonly [{
        'v:imagedata'?: readonly [{ $?: { 'r:id'?: string } }];
      }];
    }];
  };

  let imageId: string | null = null;

  // Try to extract image relationship ID from drawing
  if (runData['w:drawing']) {
    const drawing = runData['w:drawing'][0];
    const inline = drawing['wp:inline']?.[0];
    const graphic = inline?.['a:graphic']?.[0];
    const graphicData = graphic?.['a:graphicData']?.[0];
    const pic = graphicData?.['pic:pic']?.[0];
    const blipFill = pic?.['pic:blipFill']?.[0];
    const blip = blipFill?.['a:blip']?.[0];
    
    if (blip?.$?.['r:embed']) {
      imageId = blip.$['r:embed'];
    }
  }
  
  // Try to extract from legacy picture format
  if (!imageId && runData['w:pict']) {
    const pict = runData['w:pict'][0];
    const shape = pict['v:shape']?.[0];
    const imageData = shape?.['v:imagedata']?.[0];
    
    if (imageData?.$?.['r:id']) {
      imageId = imageData.$['r:id'];
    }
  }

  if (imageId) {
    // Find the matching image by relationship ID or original path
    const matchingImage = extractedImages.find(img => 
      img.originalPath.includes(imageId) || 
      img.originalPath.endsWith(`${imageId}.png`) ||
      img.originalPath.endsWith(`${imageId}.jpg`) ||
      img.originalPath.endsWith(`${imageId}.jpeg`) ||
      img.originalPath.includes('image')
    );
    
    if (matchingImage && matchingImage.savedPath) {
      const filename = path.basename(matchingImage.savedPath);
      return imageExtractor.getImageMarkdown('Document Image', filename);
    }
  }
  
  // Fallback: if we have images but couldn't match, use the first available one
  if (extractedImages.length > 0) {
    const img = extractedImages.find(img => img.savedPath);
    if (img) {
      const filename = path.basename(img.savedPath);
      return imageExtractor.getImageMarkdown('Document Image', filename);
    }
  }
  
  return null;
}
