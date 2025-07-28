const JSZip = require('jszip');
const xml2js = require('xml2js');
const LayoutParser = require('../utils/layout-parser');

async function parseDocx(buffer, imageExtractor) {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const documentXml = zip.file('word/document.xml');
    
    if (!documentXml) {
      throw new Error('Invalid DOCX file: missing document.xml');
    }
    
    // Extract images first
    const extractedImages = await imageExtractor.extractImagesFromZip(zip, 'word/');
    
    // Initialize layout parser
    const layoutParser = new LayoutParser();
    
    const xmlContent = await documentXml.async('string');
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(xmlContent);
    
    const body = result['w:document']['w:body'][0];
    let markdown = '';
    
    for (const element of body['w:p'] || []) {
      const paragraph = await parseParagraph(element, imageExtractor, extractedImages);
      if (paragraph.trim()) {
        markdown += paragraph + '\n\n';
      }
    }
    
    for (const table of body['w:tbl'] || []) {
      const tableMarkdown = await parseAdvancedTable(table, layoutParser, imageExtractor, extractedImages);
      if (tableMarkdown.trim()) {
        markdown += tableMarkdown + '\n\n';
      }
    }
    
    return markdown.trim();
  } catch (error) {
    if (error.message.includes('Invalid DOCX')) {
      throw error;
    }
    throw new Error(`Failed to parse DOCX: ${error.message}`);
  }
}

async function parseParagraph(paragraph, imageExtractor, extractedImages) {
  const advancedData = await parseAdvancedParagraph(paragraph, imageExtractor, extractedImages);
  return advancedData.text;
}

// Legacy function for compatibility
async function parseParagraphLegacy(paragraph, imageExtractor, extractedImages) {
  let text = '';
  let hasFormatting = false;
  
  // Check for paragraph style (headings)
  const pStyle = paragraph['w:pPr'] && paragraph['w:pPr'][0] && paragraph['w:pPr'][0]['w:pStyle'];
  let headingLevel = 0;
  
  if (pStyle && pStyle[0] && pStyle[0].$.val) {
    const styleVal = pStyle[0].$.val;
    if (styleVal.includes('Heading') || styleVal.includes('heading')) {
      const match = styleVal.match(/(\d+)/);
      if (match) {
        headingLevel = parseInt(match[1]);
      } else {
        headingLevel = 1;
      }
    }
  }
  
  if (paragraph['w:r']) {
    for (const run of paragraph['w:r']) {
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
          } else if (textElement._) {
            runText += textElement._;
          }
        }
        
        // Apply formatting
        const rPr = run['w:rPr'] && run['w:rPr'][0];
        if (rPr) {
          if (rPr['w:b']) {
            runText = `**${runText}**`;
            hasFormatting = true;
          }
          if (rPr['w:i']) {
            runText = `*${runText}*`;
            hasFormatting = true;
          }
        }
        
        text += runText;
      }
    }
  }
  
  // Apply heading formatting
  if (headingLevel > 0 && text.trim()) {
    const hashes = '#'.repeat(Math.min(headingLevel, 6));
    text = `${hashes} ${text.trim()}`;
  }
  
  return text;
}

async function extractImageFromRun(run, imageExtractor, extractedImages) {
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

async function parseAdvancedTable(table, layoutParser, imageExtractor, extractedImages) {
  const rows = table['w:tr'] || [];
  if (rows.length === 0) return '';

  const tableData = { rows: [] };
  
  for (const row of rows) {
    const cells = row['w:tc'] || [];
    const rowData = { cells: [] };
    
    for (const cell of cells) {
      const cellData = {
        text: '',
        bold: false,
        italic: false,
        alignment: 'left',
        backgroundColor: null,
        colSpan: 1,
        rowSpan: 1
      };
      
      // Extract cell properties
      const tcPr = cell['w:tcPr'];
      if (tcPr && tcPr[0]) {
        // Check for merged cells
        if (tcPr[0]['w:gridSpan']) {
          cellData.colSpan = parseInt(tcPr[0]['w:gridSpan'][0].$.val) || 1;
        }
        if (tcPr[0]['w:vMerge']) {
          cellData.merged = true;
        }
        
        // Check for background color
        if (tcPr[0]['w:shd'] && tcPr[0]['w:shd'][0].$.fill) {
          cellData.backgroundColor = tcPr[0]['w:shd'][0].$.fill;
        }
      }
      
      // Extract cell content
      if (cell['w:p']) {
        let cellTexts = [];
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
    
    tableData.rows.push(rowData);
  }
  
  return layoutParser.parseAdvancedTable(tableData, {
    preserveAlignment: true,
    showBorders: true,
    preserveColors: true
  });
}

async function parseAdvancedParagraph(paragraph, imageExtractor, extractedImages) {
  let text = '';
  let bold = false;
  let italic = false;
  let alignment = 'left';
  let fontSize = 'normal';
  let isList = false;
  let listLevel = 0;
  
  // Check paragraph properties
  const pPr = paragraph['w:pPr'];
  if (pPr && pPr[0]) {
    // Check alignment
    if (pPr[0]['w:jc'] && pPr[0]['w:jc'][0].$.val) {
      alignment = pPr[0]['w:jc'][0].$.val;
    }
    
    // Check if it's a list
    if (pPr[0]['w:numPr']) {
      isList = true;
      if (pPr[0]['w:numPr'][0]['w:ilvl']) {
        listLevel = parseInt(pPr[0]['w:numPr'][0]['w:ilvl'][0].$.val) || 0;
      }
    }
    
    // Check for paragraph style (headings)
    const pStyle = pPr[0]['w:pStyle'];
    let headingLevel = 0;
    
    if (pStyle && pStyle[0] && pStyle[0].$.val) {
      const styleVal = pStyle[0].$.val;
      if (styleVal.includes('Heading') || styleVal.includes('heading')) {
        const match = styleVal.match(/(\d+)/);
        if (match) {
          headingLevel = parseInt(match[1]);
        } else {
          headingLevel = 1;
        }
      }
    }
  }
  
  if (paragraph['w:r']) {
    for (const run of paragraph['w:r']) {
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
          } else if (textElement._) {
            runText += textElement._;
          }
        }
        
        // Apply formatting
        const rPr = run['w:rPr'] && run['w:rPr'][0];
        if (rPr) {
          if (rPr['w:b']) {
            runText = `**${runText}**`;
            bold = true;
          }
          if (rPr['w:i']) {
            runText = `*${runText}*`;
            italic = true;
          }
          if (rPr['w:sz'] && rPr['w:sz'][0].$.val) {
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
  if (pPr && pPr[0] && pPr[0]['w:pStyle']) {
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

module.exports = parseDocx;