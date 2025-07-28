# Doc-to-Markdown Converter

A Node.js library for converting various document types (PDF, DOCX, XLSX, PPTX) into Markdown format using low-level parsing techniques.

## Features

- **Multiple Format Support**: PDF, DOCX, XLSX, PPTX
- **Flexible Input**: Accept both file paths (string) and Buffer objects
- **Automatic File Type Detection**: Uses the `file-type` library for reliable format detection
- **Low-Level Parsing**: Uses fundamental parsing libraries rather than direct conversion tools
- **Structured Output**: Maintains document structure in Markdown format

## Installation

```bash
npm install
```

## Dependencies

This library uses the following core dependencies:

- `jszip`: For handling .docx, .xlsx, and .pptx archives
- `xml2js`: For parsing XML content within Office documents
- `pdf-parse`: For extracting text from PDF files
- `file-type`: For reliable file type detection

## Usage

### Basic Usage

```javascript
const convert = require('./src/index.js');

// Using file path
const markdownFromPath = await convert('./document.pdf');

// Using Buffer
const fs = require('fs');
const buffer = fs.readFileSync('./document.docx');
const markdownFromBuffer = await convert(buffer);

console.log(markdownFromPath);
```

### Supported Formats

#### PDF Files
- Extracts plain text content
- Joins text blocks with newlines for readability

#### DOCX Files
- Parses paragraphs and maintains text structure
- Converts tables to Markdown table format
- Handles nested text elements and runs

#### XLSX Files
- Processes all worksheets in the file
- Creates separate Markdown tables for each sheet
- Handles shared strings and various cell types
- Adds sheet names as headings (### Sheet Name)

#### PPTX Files
- Extracts text from all slides
- Formats each slide with a heading (## Slide N)
- Preserves text content from text boxes and shapes

### Error Handling

The library provides comprehensive error handling:

```javascript
try {
  const markdown = await convert('./document.pdf');
  console.log(markdown);
} catch (error) {
  console.error('Conversion failed:', error.message);
}
```

Common error scenarios:
- **File not found**: When the specified file path doesn't exist
- **Unsupported format**: When the file type is not PDF, DOCX, XLSX, or PPTX
- **Corrupted files**: When the file structure is invalid or corrupted
- **Empty content**: When the document contains no extractable text

### API Reference

#### `convert(input: Buffer | string): Promise<string>`

**Parameters:**
- `input`: Either a file path (string) or a Buffer containing the document data

**Returns:**
- Promise that resolves to a string containing the Markdown representation of the document

**Throws:**
- `Error`: When the file format is unsupported, file is not found, or parsing fails

## File Structure

```
doc-to-markdown-converter/
├── package.json
├── README.md
└── src/
    ├── index.js              # Main entry point
    └── parsers/
        ├── pdf-parser.js     # PDF parsing logic
        ├── docx-parser.js    # DOCX parsing logic
        ├── xlsx-parser.js    # XLSX parsing logic
        └── pptx-parser.js    # PPTX parsing logic
```

## Implementation Details

### Low-Level Parsing Approach

This library deliberately uses low-level parsing techniques:

- **Office Documents**: Uses `jszip` to extract the underlying XML files, then `xml2js` to parse the document structure
- **PDF**: Uses `pdf-parse` to extract text content from the PDF binary format
- **No Direct Conversion**: Avoids high-level libraries that perform one-step conversions

### Document Structure Preservation

- **DOCX**: Maintains paragraph structure and converts tables to Markdown format
- **XLSX**: Creates separate tables for each worksheet with appropriate headings
- **PPTX**: Organizes content by slides with clear slide numbers
- **PDF**: Preserves line structure while cleaning up formatting

## Requirements

- Node.js >= 14.0.0

## License

MIT