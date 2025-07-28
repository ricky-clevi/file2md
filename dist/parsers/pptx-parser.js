import JSZip from 'jszip';
import { parseStringPromise } from 'xml2js';
import { LayoutParser } from '../utils/layout-parser.js';
import { ParseError } from '../types/errors.js';
/**
 * Parse PPTX buffer and convert to markdown with layout preservation
 */
export async function parsePptx(buffer, imageExtractor, chartExtractor, options = {}) {
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
        const slideFiles = [];
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
            const slideContent = await extractAdvancedSlideContent(xmlContent, imageExtractor, extractedImages, slideNumber, layoutParser);
            if (slideContent.trim()) {
                markdown += slideContent + '\n\n';
            }
            else {
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
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        throw new ParseError('PPTX', message, error);
    }
}
async function extractAdvancedSlideContent(xmlContent, imageExtractor, extractedImages, slideNumber, layoutParser) {
    try {
        const result = await parseStringPromise(xmlContent);
        const elements = [];
        let imageCount = 0;
        // Extract all shapes and their positions
        function extractShapes(obj, parentPos = { x: 0, y: 0 }) {
            if (typeof obj === 'object' && obj !== null) {
                if (Array.isArray(obj)) {
                    for (const item of obj) {
                        extractShapes(item, parentPos);
                    }
                }
                else {
                    // Check for shape positioning
                    let position = { ...parentPos };
                    if (obj['a:off']?.[0]?.$) {
                        position.x = parseInt(obj['a:off'][0].$.x) || 0;
                        position.y = parseInt(obj['a:off'][0].$.y) || 0;
                    }
                    // Check for text content in shapes
                    if (obj['a:t']) {
                        const textElement = {
                            type: 'text',
                            content: '',
                            position: position
                        };
                        if (Array.isArray(obj['a:t'])) {
                            for (const textItem of obj['a:t']) {
                                let text = '';
                                if (typeof textItem === 'string') {
                                    text = textItem;
                                }
                                else if (textItem && typeof textItem === 'object' && '_' in textItem) {
                                    text = textItem._;
                                }
                                if (text && text.trim()) {
                                    textElement.content += text.trim() + ' ';
                                }
                            }
                        }
                        if (textElement.content.trim()) {
                            elements.push(textElement);
                        }
                    }
                    // Check for tables
                    if (obj['a:tbl']) {
                        const tableElement = {
                            type: 'table',
                            content: obj['a:tbl'],
                            position: position
                        };
                        elements.push(tableElement);
                    }
                    // Check for images
                    if (obj['a:blip'] || obj['p:pic'] || obj['a:pic']) {
                        const slideImages = extractedImages.filter(img => img.originalPath.includes(`slide${slideNumber}`) ||
                            img.originalPath.includes('media/'));
                        if (slideImages.length > imageCount) {
                            const img = slideImages[imageCount];
                            if (img?.savedPath) {
                                const imageElement = {
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
        let markdown = '';
        let currentRow = null;
        const rowThreshold = 50; // EMUs tolerance for same row
        for (const element of sortedElements) {
            const elementY = element.position?.y || 0;
            // Check if this element is in the same row as the previous
            if (currentRow && Math.abs(elementY - currentRow.y) < rowThreshold) {
                // Same row - add as column
                currentRow.elements.push(element);
            }
            else {
                // New row
                if (currentRow && currentRow.elements.length > 0) {
                    // Process previous row
                    markdown += processSlideRow(currentRow, layoutParser, imageExtractor);
                }
                currentRow = {
                    y: elementY,
                    elements: [element]
                };
            }
        }
        // Process the last row
        if (currentRow && currentRow.elements.length > 0) {
            markdown += processSlideRow(currentRow, layoutParser, imageExtractor);
        }
        // If no organized content, fall back to simple extraction
        if (!markdown.trim() && extractedImages.length > 0) {
            const slideImages = extractedImages.filter(img => img.originalPath.includes(`slide${slideNumber}`) ||
                (slideNumber === 1 && img.originalPath.includes('media/')));
            for (const img of slideImages) {
                if (img.savedPath) {
                    markdown += imageExtractor.getImageMarkdown(`Slide ${slideNumber} Image`, img.savedPath) + '\n\n';
                }
            }
        }
        return markdown.trim();
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        throw new ParseError('PPTX', `Failed to extract advanced content from slide: ${message}`, error);
    }
}
function processSlideRow(row, layoutParser, imageExtractor) {
    if (row.elements.length === 1) {
        // Single element in row
        const element = row.elements[0];
        return formatSlideElement(element, layoutParser, imageExtractor) + '\n\n';
    }
    else {
        // Multiple elements - create columns
        const columns = row.elements.map(element => ({
            content: formatSlideElement(element, layoutParser, imageExtractor)
        }));
        return layoutParser.createColumns(columns) + '\n';
    }
}
function formatSlideElement(element, layoutParser, imageExtractor) {
    switch (element.type) {
        case 'text': {
            const content = element.content;
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
            const imagePath = element.content;
            return imageExtractor.getImageMarkdown('Slide Image', imagePath);
        }
        default:
            return typeof element.content === 'string' ? element.content : '';
    }
}
function parseSlideTable(tableData, layoutParser) {
    // Simplified table parsing for PowerPoint
    const table = tableData;
    if (!table?.[0]?.['a:tr']) {
        return '';
    }
    const rows = table[0]['a:tr'];
    const tableStruct = { rows: [] };
    for (const row of rows) {
        const cells = row['a:tc'] || [];
        const rowData = { cells: [] };
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
//# sourceMappingURL=pptx-parser.js.map