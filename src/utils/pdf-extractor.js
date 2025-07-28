const fs = require('fs');
const path = require('path');

class PDFExtractor {
  constructor(imageExtractor) {
    this.imageExtractor = imageExtractor;
    this.pageCounter = 0;
  }

  async extractImagesFromPDF(buffer) {
    // For now, convert entire PDF pages to images as fallback
    // This gives us visual preservation when text extraction fails
    try {
      const pdf2pic = require('pdf2pic');
      
      const convert = pdf2pic.fromBuffer(buffer, {
        density: 150,           // Output resolution
        saveFilename: "page",
        savePath: this.imageExtractor.outputDir,
        format: "png",
        width: 800,            // Max width
        height: 1200           // Max height
      });
      
      const results = await convert.bulk(-1); // Convert all pages
      
      const extractedPages = [];
      for (const result of results) {
        if (result.path) {
          const filename = path.basename(result.path);
          extractedPages.push({
            pageNumber: result.page,
            imagePath: filename,
            fullPath: result.path
          });
        }
      }
      
      return extractedPages;
    } catch (error) {
      console.warn('Failed to convert PDF pages to images:', error.message);
      return [];
    }
  }

  async enhanceTextWithLayout(text, pdfData) {
    // Attempt to detect and preserve basic layout patterns
    const lines = text.split('\n');
    let enhancedText = '';
    let currentSection = '';
    let inTable = false;
    let tableRows = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      if (!line) {
        // Handle empty lines
        if (inTable) {
          enhancedText += this.formatTableRows(tableRows);
          tableRows = [];
          inTable = false;
        }
        enhancedText += '\n';
        continue;
      }
      
      // Detect headings (lines that are short and followed by content)
      if (this.isLikelyHeading(line, lines, i)) {
        if (inTable) {
          enhancedText += this.formatTableRows(tableRows);
          tableRows = [];
          inTable = false;
        }
        
        const headingLevel = this.determineHeadingLevel(line);
        enhancedText += `${'#'.repeat(headingLevel)} ${line}\n\n`;
        continue;
      }
      
      // Detect table-like content
      if (this.isLikelyTableRow(line)) {
        if (!inTable) {
          inTable = true;
        }
        tableRows.push(this.parseTableRow(line));
        continue;
      } else if (inTable) {
        // End of table
        enhancedText += this.formatTableRows(tableRows);
        tableRows = [];
        inTable = false;
      }
      
      // Detect lists
      if (this.isListItem(line)) {
        enhancedText += this.formatListItem(line) + '\n';
        continue;
      }
      
      // Regular paragraph
      enhancedText += line + '\n';
    }
    
    // Handle any remaining table
    if (inTable && tableRows.length > 0) {
      enhancedText += this.formatTableRows(tableRows);
    }
    
    return enhancedText;
  }

  isLikelyHeading(line, allLines, index) {
    // Check if line looks like a heading
    if (line.length > 80) return false; // Too long to be a heading
    if (line.length < 3) return false;  // Too short
    
    // Check if it's all caps (common for headings)
    if (line === line.toUpperCase() && line.length > 5) return true;
    
    // Check if followed by a longer paragraph
    const nextLine = allLines[index + 1];
    if (nextLine && nextLine.trim().length > line.length * 1.5) {
      return true;
    }
    
    // Check if it ends with a colon (section header)
    if (line.endsWith(':')) return true;
    
    return false;
  }

  determineHeadingLevel(line) {
    if (line === line.toUpperCase()) return 1; // All caps = major heading
    if (line.endsWith(':')) return 2;         // Ends with colon = section
    if (line.length < 30) return 3;           // Short = subsection
    return 2; // Default
  }

  isLikelyTableRow(line) {
    // Look for patterns that suggest tabular data
    const patterns = [
      /\t+/,                    // Tab separated
      /\s{3,}/,                 // Multiple spaces
      /\|/,                     // Pipe separated
      /\s+\d+\s+/,              // Numbers with spaces
      /^\s*\d+\.\s+/,           // Numbered items with alignment
    ];
    
    return patterns.some(pattern => pattern.test(line));
  }

  parseTableRow(line) {
    // Split line into columns based on various separators
    let columns = [];
    
    if (line.includes('\t')) {
      columns = line.split('\t').map(col => col.trim());
    } else if (line.includes('|')) {
      columns = line.split('|').map(col => col.trim());
    } else {
      // Split on multiple spaces
      columns = line.split(/\s{2,}/).map(col => col.trim());
    }
    
    return columns.filter(col => col.length > 0);
  }

  formatTableRows(rows) {
    if (rows.length === 0) return '';
    
    // Find maximum number of columns
    const maxCols = Math.max(...rows.map(row => row.length));
    
    let markdown = '';
    
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      let rowMarkdown = '|';
      
      for (let j = 0; j < maxCols; j++) {
        const cell = row[j] || '';
        rowMarkdown += ` ${cell} |`;
      }
      
      markdown += rowMarkdown + '\n';
      
      // Add header separator after first row
      if (i === 0) {
        let separator = '|';
        for (let j = 0; j < maxCols; j++) {
          separator += ' --- |';
        }
        markdown += separator + '\n';
      }
    }
    
    return markdown + '\n';
  }

  isListItem(line) {
    // Check for various list patterns
    const listPatterns = [
      /^\s*[-•·]\s+/,           // Bullet points
      /^\s*\d+\.\s+/,           // Numbered lists
      /^\s*[a-zA-Z]\.\s+/,      // Lettered lists
      /^\s*[ivx]+\.\s+/i,       // Roman numerals
    ];
    
    return listPatterns.some(pattern => pattern.test(line));
  }

  formatListItem(line) {
    // Convert various list formats to markdown
    if (/^\s*\d+\.\s+/.test(line)) {
      return line.replace(/^\s*\d+\.\s+/, '1. ');
    } else if (/^\s*[a-zA-Z]\.\s+/.test(line)) {
      return line.replace(/^\s*[a-zA-Z]\.\s+/, '- ');
    } else if (/^\s*[ivx]+\.\s+/i.test(line)) {
      return line.replace(/^\s*[ivx]+\.\s+/i, '- ');
    } else {
      return line.replace(/^\s*[-•·]\s+/, '- ');
    }
  }

  async createPageBreaks(pageImages) {
    let markdown = '';
    
    for (let i = 0; i < pageImages.length; i++) {
      const page = pageImages[i];
      markdown += `## Page ${page.pageNumber}\n\n`;
      markdown += this.imageExtractor.getImageMarkdown(`Page ${page.pageNumber}`, page.imagePath);
      markdown += '\n\n';
      
      if (i < pageImages.length - 1) {
        markdown += '---\n\n'; // Page separator
      }
    }
    
    return markdown;
  }

  reset() {
    this.pageCounter = 0;
  }
}

module.exports = PDFExtractor;