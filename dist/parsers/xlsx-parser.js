import JSZip from 'jszip';
import { parseStringPromise } from 'xml2js';
import { LayoutParser } from '../utils/layout-parser.js';
import { ParseError, InvalidFileError } from '../types/errors.js';
/**
 * Parse XLSX buffer and convert to markdown with formatting preservation
 */
export async function parseXlsx(buffer, imageExtractor, chartExtractor, options = {}) {
    try {
        const zip = await JSZip.loadAsync(buffer);
        const layoutParser = new LayoutParser();
        const sharedStrings = await getSharedStrings(zip);
        const workbook = await getWorkbook(zip);
        const styles = await getStyles(zip);
        const worksheets = await getWorksheets(zip, workbook, styles, sharedStrings);
        // Extract charts if enabled
        const extractedCharts = options.extractCharts !== false
            ? await chartExtractor.extractChartsFromZip(zip, 'xl/')
            : [];
        let markdown = '';
        let sheetCount = 0;
        for (const [sheetName, sheetData] of worksheets) {
            if (sheetData.rows && sheetData.rows.length > 0) {
                sheetCount++;
                markdown += `### ${sheetName}\n\n`;
                markdown += layoutParser.parseAdvancedTable(sheetData, {
                    preserveAlignment: true,
                    showBorders: true,
                    preserveColors: true
                });
                markdown += '\n\n';
            }
        }
        return {
            markdown: markdown.trim(),
            charts: extractedCharts.map(chart => chart.data),
            sheetCount,
            metadata: {
                totalSheets: workbook.length,
                processedSheets: sheetCount
            }
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        throw new ParseError('XLSX', message, error);
    }
}
async function getSharedStrings(zip) {
    const sharedStringsFile = zip.file('xl/sharedStrings.xml');
    if (!sharedStringsFile)
        return [];
    try {
        const xmlContent = await sharedStringsFile.async('string');
        const result = await parseStringPromise(xmlContent);
        const strings = [];
        if (result.sst?.si) {
            for (const si of result.sst.si) {
                if (si.t?.[0]) {
                    strings.push(si.t[0]);
                }
                else if (si.r) {
                    let text = '';
                    for (const r of si.r) {
                        if (r.t?.[0]) {
                            text += r.t[0];
                        }
                    }
                    strings.push(text);
                }
            }
        }
        return strings;
    }
    catch (error) {
        console.warn('Failed to parse shared strings:', error instanceof Error ? error.message : 'Unknown error');
        return [];
    }
}
async function getWorkbook(zip) {
    const workbookFile = zip.file('xl/workbook.xml');
    if (!workbookFile) {
        throw new InvalidFileError('Invalid XLSX file: missing workbook.xml');
    }
    try {
        const xmlContent = await workbookFile.async('string');
        const result = await parseStringPromise(xmlContent);
        const sheets = [];
        if (result.workbook?.sheets?.[0]?.sheet) {
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
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        throw new ParseError('XLSX', `Failed to parse workbook: ${message}`, error);
    }
}
async function getStyles(zip) {
    const stylesFile = zip.file('xl/styles.xml');
    if (!stylesFile)
        return { fonts: [], fills: [], cellXfs: [] };
    try {
        const xmlContent = await stylesFile.async('string');
        const result = await parseStringPromise(xmlContent);
        const styles = {
            fonts: [],
            fills: [],
            cellXfs: []
        };
        // Parse fonts
        if (result.styleSheet?.fonts?.[0]?.font) {
            for (const font of result.styleSheet.fonts[0].font) {
                const fontData = {
                    bold: !!(font.b?.[0]),
                    italic: !!(font.i?.[0]),
                    size: font.sz ? parseFloat(font.sz[0].$.val) : 11
                };
                styles.fonts.push(fontData);
            }
        }
        // Parse fills (background colors)
        if (result.styleSheet?.fills?.[0]?.fill) {
            for (const fill of result.styleSheet.fills[0].fill) {
                let bgColor;
                if (fill.patternFill?.[0]?.bgColor?.[0]?.$.rgb) {
                    bgColor = fill.patternFill[0].bgColor[0].$.rgb;
                }
                styles.fills.push({ backgroundColor: bgColor });
            }
        }
        // Parse cell formats
        if (result.styleSheet?.cellXfs?.[0]?.xf) {
            for (const xf of result.styleSheet.cellXfs[0].xf) {
                const cellFormat = {
                    fontId: parseInt(xf.$.fontId) || 0,
                    fillId: parseInt(xf.$.fillId) || 0,
                    alignment: 'left'
                };
                if (xf.alignment?.[0]?.$.horizontal) {
                    cellFormat.alignment = xf.alignment[0].$.horizontal;
                }
                styles.cellXfs.push(cellFormat);
            }
        }
        return styles;
    }
    catch (error) {
        console.warn('Failed to parse styles:', error instanceof Error ? error.message : 'Unknown error');
        return { fonts: [], fills: [], cellXfs: [] };
    }
}
async function getWorksheets(zip, workbook, styles, sharedStrings) {
    const worksheets = new Map();
    for (let i = 0; i < workbook.length; i++) {
        const sheet = workbook[i];
        const worksheetFile = zip.file(`xl/worksheets/sheet${i + 1}.xml`);
        if (worksheetFile) {
            try {
                const xmlContent = await worksheetFile.async('string');
                const result = await parseStringPromise(xmlContent);
                const sheetData = { rows: [] };
                if (result.worksheet?.sheetData?.[0]?.row) {
                    const processedRows = [];
                    for (const row of result.worksheet.sheetData[0].row) {
                        const rowNum = parseInt(row.$.r);
                        const rowData = { cells: [] };
                        if (row.c) {
                            const maxCol = Math.max(...row.c.map((cell) => getColumnIndex(cell.$.r)));
                            // Initialize all cells in the row
                            for (let col = 0; col <= maxCol; col++) {
                                rowData.cells.push({
                                    text: '',
                                    bold: false,
                                    italic: false,
                                    alignment: 'left',
                                    backgroundColor: undefined,
                                    colSpan: 1,
                                    rowSpan: 1,
                                    merged: false
                                });
                            }
                            // Fill in actual cell data
                            for (const cell of row.c) {
                                const cellRef = cell.$.r;
                                const colIndex = getColumnIndex(cellRef);
                                let cellValue = '';
                                if (cell.v?.[0]) {
                                    cellValue = cell.v[0];
                                }
                                const cellData = {
                                    text: cellValue,
                                    bold: false,
                                    italic: false,
                                    alignment: 'left',
                                    backgroundColor: undefined,
                                    colSpan: 1,
                                    rowSpan: 1,
                                    merged: false
                                };
                                // Apply styling if available
                                if (cell.$.s && styles.cellXfs.length > 0) {
                                    const styleIndex = parseInt(cell.$.s);
                                    const cellFormat = styles.cellXfs[styleIndex];
                                    if (cellFormat) {
                                        cellData.alignment = (['left', 'center', 'right', 'justify'].includes(cellFormat.alignment)
                                            ? cellFormat.alignment
                                            : 'left');
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
                                // Handle shared strings
                                if (cell.$.t === 's' && cellValue) {
                                    const stringIndex = parseInt(cellValue);
                                    if (stringIndex < sharedStrings.length) {
                                        cellData.text = sharedStrings[stringIndex];
                                    }
                                }
                                rowData.cells[colIndex] = cellData;
                            }
                        }
                        // Ensure the processedRows array is large enough
                        while (processedRows.length < rowNum) {
                            processedRows.push({ cells: [] });
                        }
                        processedRows[rowNum - 1] = rowData;
                    }
                    // Filter out empty rows
                    sheetData.rows = processedRows.filter(row => row.cells && row.cells.some(cell => cell.text && cell.text.trim()));
                }
                worksheets.set(sheet.name, sheetData);
            }
            catch (error) {
                console.warn(`Failed to parse worksheet ${sheet.name}:`, error instanceof Error ? error.message : 'Unknown error');
            }
        }
    }
    return worksheets;
}
function getColumnIndex(cellRef) {
    const match = cellRef.match(/^([A-Z]+)/);
    if (!match)
        return 0;
    const letters = match[1];
    let index = 0;
    for (let i = 0; i < letters.length; i++) {
        index = index * 26 + (letters.charCodeAt(i) - 64);
    }
    return index - 1;
}
//# sourceMappingURL=xlsx-parser.js.map