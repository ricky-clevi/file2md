const fs = require('fs').promises;
const FileType = require('file-type');
const path = require('path');
const ImageExtractor = require('./utils/image-extractor');
const ChartExtractor = require('./utils/chart-extractor');
const parsePdf = require('./parsers/pdf-parser');
const parseDocx = require('./parsers/docx-parser');
const parseXlsx = require('./parsers/xlsx-parser');
const parsePptx = require('./parsers/pptx-parser');

async function convert(input, options = {}) {
  try {
    let buffer;
    
    if (typeof input === 'string') {
      buffer = await fs.readFile(input);
    } else if (Buffer.isBuffer(input)) {
      buffer = input;
    } else {
      throw new Error('Input must be a file path (string) or Buffer');
    }

    const fileType = await FileType.fromBuffer(buffer);
    
    if (!fileType) {
      throw new Error('Unable to determine file type');
    }

    // Setup image and chart extraction
    const imageDir = options.imageDir || 'images';
    const imageExtractor = new ImageExtractor(imageDir);
    const chartExtractor = new ChartExtractor(imageExtractor);

    switch (fileType.mime) {
      case 'application/pdf':
        return await parsePdf(buffer, imageExtractor);
      
      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        return await parseDocx(buffer, imageExtractor, chartExtractor);
      
      case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
        return await parseXlsx(buffer, imageExtractor, chartExtractor);
      
      case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
        return await parsePptx(buffer, imageExtractor, chartExtractor);
      
      default:
        throw new Error(`Unsupported file type: ${fileType.mime}. Supported formats: PDF, DOCX, XLSX, PPTX`);
    }
  } catch (error) {
    if (error.message.includes('ENOENT')) {
      throw new Error(`File not found: ${input}`);
    }
    throw error;
  }
}

module.exports = convert;