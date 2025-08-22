# file2md

[![npm version](https://badge.fury.io/js/file2md.svg)](https://badge.fury.io/js/file2md)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A modern TypeScript library for converting various document types (PDF, DOCX, XLSX, PPTX, HWP, HWPX) into Markdown with **advanced layout preservation**, **image extraction**, **chart conversion**, and **Korean language support**.

**English** | [한국어](README.ko.md)

## ✨ Features

- 🔄 **Multiple Format Support**: PDF, DOCX, XLSX, PPTX, HWP, HWPX
- 🎨 **Layout Preservation**: Maintains document structure, tables, and formatting
- 🖼️ **Image Extraction**: Extract embedded images from DOCX, PPTX, XLSX, HWP documents
- 📊 **Chart Conversion**: Converts charts to Markdown tables
- 📝 **List & Table Support**: Proper nested lists and complex tables
- 🌏 **Korean Language Support**: Full support for HWP/HWPX Korean document formats
- 🔒 **Type Safety**: Full TypeScript support with comprehensive types
- ⚡ **Modern ESM**: ES2022 modules with CommonJS compatibility
- 🚀 **Zero Config**: Works out of the box
- 📄 **PDF Text Extraction**: Enhanced text extraction with layout detection

## 📦 Installation

```bash
npm install file2md
```

## 🚀 Quick Start

### TypeScript / ES Modules

```typescript
import { convert } from 'file2md';

// Convert from file path
const result = await convert('./document.pdf');
console.log(result.markdown);

// Convert with options
const result = await convert('./presentation.pptx', {
  imageDir: 'extracted-images',
  preserveLayout: true,
  extractCharts: true,
  extractImages: true
});

console.log(`✅ Converted successfully!`);
console.log(`📄 Markdown length: ${result.markdown.length}`);
console.log(`🖼️ Images extracted: ${result.images.length}`);
console.log(`📊 Charts found: ${result.charts.length}`);
console.log(`⏱️ Processing time: ${result.metadata.processingTime}ms`);
```

### Korean Document Support (HWP/HWPX)

```typescript
import { convert } from 'file2md';

// Convert Korean HWP document
const hwpResult = await convert('./document.hwp', {
  imageDir: 'hwp-images',
  preserveLayout: true,
  extractImages: true
});

// Convert Korean HWPX document (XML-based format)
const hwpxResult = await convert('./document.hwpx', {
  imageDir: 'hwpx-images',
  preserveLayout: true,
  extractImages: true
});

console.log(`🇰🇷 HWP content: ${hwpResult.markdown.substring(0, 100)}...`);
console.log(`📄 HWPX pages: ${hwpxResult.metadata.pageCount}`);
```

### CommonJS

```javascript
const { convert } = require('file2md');

const result = await convert('./document.docx');
console.log(result.markdown);
```

### From Buffer

```typescript
import { convert } from 'file2md';
import { readFile } from 'fs/promises';

const buffer = await readFile('./document.xlsx');
const result = await convert(buffer, {
  imageDir: 'spreadsheet-images'
});
```

## 📋 API Reference

### `convert(input, options?)`

**Parameters:**
- `input: string | Buffer` - File path or buffer containing document data
- `options?: ConvertOptions` - Conversion options

**Returns:** `Promise<ConversionResult>`

### Options

```typescript
interface ConvertOptions {
  imageDir?: string;        // Directory for extracted images (default: 'images')
  outputDir?: string;       // Output directory for slide screenshots (PPTX, falls back to imageDir)
  preserveLayout?: boolean; // Maintain document layout (default: true)
  extractCharts?: boolean;  // Convert charts to tables (default: true)
  extractImages?: boolean;  // Extract embedded images (default: true)
  maxPages?: number;        // Max pages for PDFs (default: unlimited)
}
```

### Result

```typescript
interface ConversionResult {
  markdown: string;           // Generated Markdown content
  images: ImageData[];        // Extracted image information
  charts: ChartData[];        // Extracted chart data
  metadata: DocumentMetadata; // Document metadata with processing info
}
```

## 🎯 Format-Specific Features

### 📄 PDF
- ✅ **Text extraction** with layout enhancement
- ✅ **Table detection** and formatting
- ✅ **List recognition** (bullets, numbers)
- ✅ **Heading detection** (ALL CAPS, colons)
- ❌ **Image extraction** (text-only processing)

### 📝 DOCX
- ✅ **Heading hierarchy** (H1-H6)
- ✅ **Text formatting** (bold, italic)
- ✅ **Complex tables** with merged cells
- ✅ **Nested lists** with proper indentation
- ✅ **Embedded images** and charts
- ✅ **Cell styling** (alignment, colors)
- ✅ **Font size preservation** and formatting

### 📊 XLSX
- ✅ **Multiple worksheets** as separate sections
- ✅ **Cell formatting** (bold, colors, alignment)
- ✅ **Data type preservation**
- ✅ **Chart extraction** to data tables
- ✅ **Conditional formatting** notes
- ✅ **Shared strings** handling for large files

### 🎬 PPTX
- ✅ **Slide-by-slide** organization
- ✅ **Text positioning** and layout
- ✅ **Image placement** per slide
- ✅ **Table extraction** from slides
- ✅ **Multi-column layouts**
- ✅ **Title extraction** from document properties
- ✅ **Chart and image** inline embedding

### 🇰🇷 HWP (Korean)
- ✅ **Binary format** parsing using hwp.js
- ✅ **Korean text extraction** with proper encoding
- ✅ **Image extraction** from embedded content
- ✅ **Layout preservation** for Korean documents
- ✅ **Copyright message filtering** for clean output

### 🇰🇷 HWPX (Korean XML)
- ✅ **XML-based format** parsing with JSZip
- ✅ **Multiple section support** for large documents
- ✅ **Relationship mapping** for image references
- ✅ **OWPML structure** parsing
- ✅ **Enhanced Korean text** processing
- ✅ **BinData image extraction** from ZIP archive

## 🖼️ Image Handling

Images are automatically extracted and saved to the specified directory:

```typescript
const result = await convert('./presentation.pptx', {
  imageDir: 'my-images'
});

// Result structure:
// my-images/
// ├── image_1.png
// ├── image_2.jpg
// └── chart_1.png

// Markdown will contain:
// ![Slide 1 Image](my-images/image_1.png)
```

**Note:** PDF files are processed as text-only. Use dedicated PDF tools for image extraction if needed.

## 📊 Chart Conversion

Charts are converted to Markdown tables:

```markdown
#### Chart 1: Sales Data

| Category | Q1 | Q2 | Q3 | Q4 |
| --- | --- | --- | --- | --- |
| Revenue | 100 | 150 | 200 | 250 |
| Profit | 20 | 30 | 45 | 60 |
```

## 🛡️ Error Handling

```typescript
import { 
  convert, 
  UnsupportedFormatError, 
  FileNotFoundError,
  ParseError 
} from 'file2md';

try {
  const result = await convert('./document.pdf');
} catch (error) {
  if (error instanceof UnsupportedFormatError) {
    console.error('Unsupported file format');
  } else if (error instanceof FileNotFoundError) {
    console.error('File not found');
  } else if (error instanceof ParseError) {
    console.error('Failed to parse document:', error.message);
  }
}
```

## 🧪 Advanced Usage

### Batch Processing

```typescript
import { convert } from 'file2md';
import { readdir } from 'fs/promises';

async function convertFolder(folderPath: string) {
  const files = await readdir(folderPath);
  const results = [];
  
  for (const file of files) {
    if (file.match(/\.(pdf|docx|xlsx|pptx|hwp|hwpx)$/i)) {
      try {
        const result = await convert(`${folderPath}/${file}`, {
          imageDir: 'batch-images',
          extractImages: true
        });
        results.push({ file, success: true, result });
      } catch (error) {
        results.push({ file, success: false, error });
      }
    }
  }
  
  return results;
}
```

### Large Document Processing

```typescript
import { convert } from 'file2md';

// Optimize for large documents
const result = await convert('./large-document.pdf', {
  maxPages: 50,              // Limit PDF processing
  preserveLayout: true       // Keep layout analysis
});

// Enhanced PPTX processing
const pptxResult = await convert('./presentation.pptx', {
  outputDir: 'slides',       // Separate directory for slides
  extractCharts: true,       // Extract chart data
  extractImages: true        // Extract embedded images
});

// Performance metrics are available in metadata
console.log('Performance Metrics:');
console.log(`- Processing time: ${result.metadata.processingTime}ms`);
console.log(`- Pages processed: ${result.metadata.pageCount}`);
console.log(`- Images extracted: ${result.metadata.imageCount}`);
console.log(`- File type: ${result.metadata.fileType}`);
```

## 📊 Supported Formats

| Format | Extension | Layout | Images | Charts | Tables | Lists |
|--------|-----------|---------|---------|---------|---------|--------|
| PDF    | `.pdf`    | ✅     | ❌     | ❌     | ✅     | ✅    |
| Word   | `.docx`   | ✅     | ✅     | ✅     | ✅     | ✅    |
| Excel  | `.xlsx`   | ✅     | ❌     | ✅     | ✅     | ❌    |
| PowerPoint | `.pptx` | ✅   | ✅     | ✅     | ✅     | ❌    |
| HWP    | `.hwp`    | ✅     | ✅     | ❌     | ❌     | ✅    |
| HWPX   | `.hwpx`   | ✅     | ✅     | ❌     | ❌     | ✅    |

> **Note**: PDF processing focuses on text extraction with enhanced layout detection. For PDF image extraction, consider using dedicated PDF processing tools.

## 🌏 Korean Document Support

file2md includes comprehensive support for Korean document formats:

### HWP (한글)
- **Binary format** used by Hangul (한글) word processor
- **Legacy format** still widely used in Korean organizations
- **Full text extraction** with Korean character encoding
- **Image and chart** extraction support

### HWPX (한글 XML)
- **Modern XML-based** format, successor to HWP
- **ZIP archive structure** with XML content files
- **Enhanced parsing** with relationship mapping
- **Multiple sections** and complex document support

### Usage Examples

```typescript
// Convert Korean documents
const koreanDocs = [
  'report.hwp',      // Legacy binary format
  'document.hwpx',   // Modern XML format
  'presentation.pptx'
];

for (const doc of koreanDocs) {
  const result = await convert(doc, {
    imageDir: 'korean-docs-images',
    preserveLayout: true
  });
  
  console.log(`📄 ${doc}: ${result.markdown.length} characters`);
  console.log(`🖼️ Images: ${result.images.length}`);
  console.log(`⏱️ Processed in ${result.metadata.processingTime}ms`);
}
```

## 🔧 Performance & Configuration

The library is optimized for performance with sensible defaults:

- **Zero configuration** - Works out of the box
- **Efficient processing** - Optimized for various document sizes
- **Memory management** - Proper cleanup of temporary resources
- **Type safety** - Full TypeScript support

Performance metrics are included in the conversion result for monitoring and optimization.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Setup

```bash
# Clone the repository
git clone https://github.com/ricky-clevi/file2md.git
cd file2md

# Install dependencies
npm install

# Run tests
npm test

# Build the project
npm run build

# Run linting
npm run lint
```

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🔗 Links

- [npm package](https://www.npmjs.com/package/file2md)
- [GitHub repository](https://github.com/ricky-clevi/file2md)
- [Issues & Bug Reports](https://github.com/ricky-clevi/file2md/issues)

---

**Made with ❤️ and TypeScript** • **🖼️ Enhanced with intelligent document parsing** • **🇰🇷 Korean document support**