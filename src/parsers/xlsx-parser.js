const JSZip = require('jszip');
const xml2js = require('xml2js');
const LayoutParser = require('../utils/layout-parser');

async function parseXlsx(buffer, imageExtractor) {
  try {
    const zip = await JSZip.loadAsync(buffer);
    
    const layoutParser = new LayoutParser();
    
    const sharedStrings = await getSharedStrings(zip);
    const workbook = await getWorkbook(zip);
    const styles = await getStyles(zip);
    const worksheets = await getWorksheets(zip, workbook, styles);
    
    let markdown = '';
    
    for (const [sheetName, sheetData] of worksheets) {
      if (sheetData.rows && sheetData.rows.length > 0) {
        markdown += `### ${sheetName}\n\n`;
        markdown += layoutParser.parseAdvancedTable(sheetData, {
          preserveAlignment: true,
          showBorders: true,
          preserveColors: true
        });
        markdown += '\n\n';
      }
    }
    
    return markdown.trim();
  } catch (error) {
    throw new Error(`Failed to parse XLSX: ${error.message}`);
  }
}

async function getSharedStrings(zip) {
  const sharedStringsFile = zip.file('xl/sharedStrings.xml');
  if (!sharedStringsFile) return [];
  
  const xmlContent = await sharedStringsFile.async('string');
  const parser = new xml2js.Parser();
  const result = await parser.parseStringPromise(xmlContent);
  
  const strings = [];
  if (result.sst && result.sst.si) {
    for (const si of result.sst.si) {
      if (si.t && si.t[0]) {
        strings.push(si.t[0]);
      } else if (si.r) {
        let text = '';
        for (const r of si.r) {
          if (r.t && r.t[0]) {
            text += r.t[0];
          }
        }
        strings.push(text);
      }
    }
  }
  
  return strings;
}

async function getWorkbook(zip) {
  const workbookFile = zip.file('xl/workbook.xml');
  if (!workbookFile) {
    throw new Error('Invalid XLSX file: missing workbook.xml');
  }
  
  const xmlContent = await workbookFile.async('string');
  const parser = new xml2js.Parser();
  const result = await parser.parseStringPromise(xmlContent);
  
  const sheets = [];
  if (result.workbook && result.workbook.sheets && result.workbook.sheets[0].sheet) {
    for (const sheet of result.workbook.sheets[0].sheet) {
      sheets.push({
        name: sheet.$.name,
        sheetId: sheet.$.sheetId,
        rId: sheet.$['r:id']
      });
    }
  }
  
  return sheets;
}

async function getStyles(zip) {
  const stylesFile = zip.file('xl/styles.xml');
  if (!stylesFile) return {};
  
  try {
    const xmlContent = await stylesFile.async('string');
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(xmlContent);
    
    const styles = {
      fonts: [],
      fills: [],
      borders: [],
      cellXfs: []
    };
    
    // Parse fonts
    if (result.styleSheet && result.styleSheet.fonts && result.styleSheet.fonts[0].font) {
      for (const font of result.styleSheet.fonts[0].font) {
        const fontData = {
          bold: !!(font.b && font.b[0]),
          italic: !!(font.i && font.i[0]),
          size: font.sz ? parseFloat(font.sz[0].$.val) : 11
        };
        styles.fonts.push(fontData);
      }
    }
    
    // Parse fills (background colors)
    if (result.styleSheet && result.styleSheet.fills && result.styleSheet.fills[0].fill) {
      for (const fill of result.styleSheet.fills[0].fill) {
        let bgColor = null;
        if (fill.patternFill && fill.patternFill[0].bgColor && fill.patternFill[0].bgColor[0].$.rgb) {
          bgColor = fill.patternFill[0].bgColor[0].$.rgb;
        }
        styles.fills.push({ backgroundColor: bgColor });
      }
    }
    
    // Parse cell formats
    if (result.styleSheet && result.styleSheet.cellXfs && result.styleSheet.cellXfs[0].xf) {
      for (const xf of result.styleSheet.cellXfs[0].xf) {
        const cellFormat = {
          fontId: parseInt(xf.$.fontId) || 0,
          fillId: parseInt(xf.$.fillId) || 0,
          alignment: 'left'
        };
        
        if (xf.alignment && xf.alignment[0] && xf.alignment[0].$.horizontal) {
          cellFormat.alignment = xf.alignment[0].$.horizontal;
        }
        
        styles.cellXfs.push(cellFormat);
      }
    }
    
    return styles;
  } catch (error) {
    console.warn('Failed to parse styles:', error.message);
    return {};
  }
}

async function getWorksheets(zip, workbook, styles) {
  const worksheets = new Map();
  
  for (let i = 0; i < workbook.length; i++) {
    const sheet = workbook[i];
    const worksheetFile = zip.file(`xl/worksheets/sheet${i + 1}.xml`);
    
    if (worksheetFile) {
      const xmlContent = await worksheetFile.async('string');
      const parser = new xml2js.Parser();
      const result = await parser.parseStringPromise(xmlContent);
      
      const sheetData = { rows: [] };
      
      if (result.worksheet && result.worksheet.sheetData && result.worksheet.sheetData[0].row) {
        for (const row of result.worksheet.sheetData[0].row) {
          const rowNum = parseInt(row.$.r);
          const rowData = { cells: [] };
          
          if (row.c) {
            const maxCol = Math.max(...row.c.map(cell => getColumnIndex(cell.$.r)));
            
            // Initialize all cells in the row
            for (let col = 0; col <= maxCol; col++) {
              rowData.cells.push({
                text: '',
                bold: false,
                italic: false,
                alignment: 'left',
                backgroundColor: null
              });
            }
            
            // Fill in actual cell data
            for (const cell of row.c) {
              const cellRef = cell.$.r;
              const colIndex = getColumnIndex(cellRef);
              
              let cellValue = '';
              if (cell.v && cell.v[0]) {
                cellValue = cell.v[0];
              }
              
              const cellData = {
                text: cellValue,
                bold: false,
                italic: false,
                alignment: 'left',
                backgroundColor: null
              };
              
              // Apply styling if available
              if (cell.$.s && styles.cellXfs) {
                const styleIndex = parseInt(cell.$.s);
                const cellFormat = styles.cellXfs[styleIndex];
                
                if (cellFormat) {
                  cellData.alignment = cellFormat.alignment || 'left';
                  
                  // Apply font styling
                  if (styles.fonts[cellFormat.fontId]) {
                    const font = styles.fonts[cellFormat.fontId];
                    cellData.bold = font.bold;
                    cellData.italic = font.italic;
                  }
                  
                  // Apply background color
                  if (styles.fills[cellFormat.fillId]) {
                    const fill = styles.fills[cellFormat.fillId];
                    cellData.backgroundColor = fill.backgroundColor;
                  }
                }
              }
              
              rowData.cells[colIndex] = cellData;
            }
          }
          
          while (sheetData.rows.length < rowNum) {
            sheetData.rows.push({ cells: [] });
          }
          sheetData.rows[rowNum - 1] = rowData;
        }
      }
      
      // Filter out empty rows
      sheetData.rows = sheetData.rows.filter(row => 
        row.cells && row.cells.some(cell => cell.text && cell.text.trim())
      );
      
      worksheets.set(sheet.name, sheetData);
    }
  }
  
  return worksheets;
}

function getColumnIndex(cellRef) {
  const match = cellRef.match(/^([A-Z]+)/);
  if (!match) return 0;
  
  const letters = match[1];
  let index = 0;
  
  for (let i = 0; i < letters.length; i++) {
    index = index * 26 + (letters.charCodeAt(i) - 64);
  }
  
  return index - 1;
}

// This function is now replaced by the advanced table parsing in LayoutParser
// but kept for legacy compatibility
function formatSheetAsTable(sheetData, sharedStrings) {
  // Convert old format to new format for backward compatibility
  if (Array.isArray(sheetData) && sheetData.length > 0) {
    const layoutParser = new LayoutParser();
    const tableData = { rows: [] };
    
    const maxCols = Math.max(...sheetData.map(row => row.length));
    
    for (const row of sheetData) {
      const rowData = { cells: [] };
      
      for (let colIndex = 0; colIndex < maxCols; colIndex++) {
        let cellValue = '';
        
        if (row && row[colIndex] !== undefined) {
          const rawValue = row[colIndex];
          
          if (typeof rawValue === 'string' && rawValue.match(/^\d+$/)) {
            const stringIndex = parseInt(rawValue);
            if (stringIndex < sharedStrings.length) {
              cellValue = sharedStrings[stringIndex];
            } else {
              cellValue = rawValue;
            }
          } else {
            cellValue = rawValue;
          }
        }
        
        rowData.cells.push({
          text: cellValue,
          bold: false,
          italic: false,
          alignment: 'left'
        });
      }
      
      tableData.rows.push(rowData);
    }
    
    return layoutParser.parseAdvancedTable(tableData);
  }
  
  return '';
}

module.exports = parseXlsx;