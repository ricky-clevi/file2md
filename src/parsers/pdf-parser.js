const pdfParse = require('pdf-parse');
const PDFExtractor = require('../utils/pdf-extractor');

async function parsePdf(buffer, imageExtractor) {
  try {
    const data = await pdfParse(buffer);
    const pdfExtractor = new PDFExtractor(imageExtractor);
    
    let markdown = '';
    
    // Try to extract text with enhanced layout
    if (data.text && data.text.trim()) {
      console.log('📄 Extracting text with layout enhancement...');
      const enhancedText = await pdfExtractor.enhanceTextWithLayout(data.text, data);
      markdown += enhancedText;
    }
    
    // If text is minimal or extraction failed, convert pages to images
    if (!data.text || data.text.trim().length < 100) {
      console.log('📸 Converting PDF pages to images for better preservation...');
      try {
        const pageImages = await pdfExtractor.extractImagesFromPDF(buffer);
        if (pageImages.length > 0) {
          if (markdown.trim()) {
            markdown += '\n\n---\n\n## Visual Content\n\n';
          }
          markdown += await pdfExtractor.createPageBreaks(pageImages);
        }
      } catch (imageError) {
        console.warn('Failed to extract PDF as images:', imageError.message);
      }
    }
    
    // Fallback to basic text if everything else fails
    if (!markdown.trim()) {
      if (data.text && data.text.trim()) {
        const lines = data.text.split('\n');
        const cleanedLines = lines
          .map(line => line.trim())
          .filter(line => line.length > 0);
        markdown = cleanedLines.join('\n');
      } else {
        throw new Error('PDF file appears to be empty or contains no extractable text');
      }
    }
    
    return markdown;
  } catch (error) {
    if (error.message.includes('Invalid PDF')) {
      throw new Error('Invalid or corrupted PDF file');
    }
    throw new Error(`Failed to parse PDF: ${error.message}`);
  }
}

module.exports = parsePdf;