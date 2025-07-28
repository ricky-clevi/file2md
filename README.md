# file2md

[![npm version](https://badge.fury.io/js/file2md.svg)](https://badge.fury.io/js/file2md)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A modern TypeScript library for converting various document types (PDF, DOCX, XLSX, PPTX) into Markdown with **advanced layout preservation**, **image extraction**, and **chart conversion**.

## ✨ Features

- 🔄 **Multiple Format Support**: PDF, DOCX, XLSX, PPTX
- 🎨 **Layout Preservation**: Maintains document structure, tables, and formatting  
- 🖼️ **Image Extraction**: Automatically extracts and references images
- 📊 **Chart Conversion**: Converts charts to Markdown tables
- 📝 **List & Table Support**: Proper nested lists and complex tables
- 🔒 **Type Safety**: Full TypeScript support with comprehensive types
- ⚡ **Modern ESM**: ES2022 modules with CommonJS compatibility
- 🚀 **Zero Config**: Works out of the box

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
  extractCharts: true
});

console.log(`✅ Converted successfully!`);
console.log(`📄 Markdown length: ${result.markdown.length}`);
console.log(`🖼️ Images extracted: ${result.images.length}`);
console.log(`📊 Charts found: ${result.charts.length}`);
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
  metadata: DocumentMetadata; // Document metadata
}
```

## 🎯 Format-Specific Features

### 📄 PDF
- ✅ **Text extraction** with layout enhancement
- ✅ **Table detection** and formatting
- ✅ **List recognition** (bullets, numbers)
- ✅ **Heading detection** (ALL CAPS, colons)
- ✅ **Page-to-image fallback** for complex layouts

### 📝 DOCX  
- ✅ **Heading hierarchy** (H1-H6)
- ✅ **Text formatting** (bold, italic)
- ✅ **Complex tables** with merged cells
- ✅ **Nested lists** with proper indentation
- ✅ **Embedded images** and charts
- ✅ **Cell styling** (alignment, colors)

### 📊 XLSX
- ✅ **Multiple worksheets** as separate sections
- ✅ **Cell formatting** (bold, colors, alignment)
- ✅ **Data type preservation** 
- ✅ **Chart extraction** to data tables
- ✅ **Conditional formatting** notes

### 🎬 PPTX
- ✅ **Slide-by-slide** organization
- ✅ **Text positioning** and layout
- ✅ **Image placement** per slide
- ✅ **Table extraction** from slides
- ✅ **Multi-column layouts**

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

### Custom Error Handling

```typescript
import { convert, ConversionError } from 'file2md';

try {
  const result = await convert('./complex-document.docx');
} catch (error) {
  if (error instanceof ConversionError) {
    console.error(`Conversion failed [${error.code}]:`, error.message);
    if (error.originalError) {
      console.error('Original error:', error.originalError);
    }
  }
}
```

### Batch Processing

```typescript
import { convert } from 'file2md';
import { readdir } from 'fs/promises';

async function convertFolder(folderPath: string) {
  const files = await readdir(folderPath);
  const results = [];
  
  for (const file of files) {
    if (file.match(/\.(pdf|docx|xlsx|pptx)$/i)) {
      try {
        const result = await convert(`${folderPath}/${file}`);
        results.push({ file, success: true, result });
      } catch (error) {
        results.push({ file, success: false, error });
      }
    }
  }
  
  return results;
}
```

## 🏗️ Development

### Build from Source

```bash
git clone https://github.com/yourusername/file2md.git
cd file2md
npm install
npm run build
```

### Testing

```bash
npm test           # Run tests
npm run test:watch # Watch mode
npm run test:coverage # Coverage report
```

### Linting

```bash
npm run lint       # Check code style
npm run lint:fix   # Fix issues
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🔗 Links

- [npm package](https://www.npmjs.com/package/file2md)
- [GitHub repository](https://github.com/yourusername/file2md)
- [Issues & Bug Reports](https://github.com/yourusername/file2md/issues)

## 📊 Supported Formats

| Format | Extension | Layout | Images | Charts | Tables | Lists |
|--------|-----------|---------|---------|---------|---------|--------|
| PDF    | `.pdf`    | ✅     | ✅*    | ❌     | ✅     | ✅    |
| Word   | `.docx`   | ✅     | ✅     | ✅     | ✅     | ✅    |
| Excel  | `.xlsx`   | ✅     | ❌     | ✅     | ✅     | ❌    |
| PowerPoint | `.pptx` | ✅   | ✅     | ✅     | ✅     | ❌    |

*PDF images via page-to-image conversion

---

**Made with ❤️ and TypeScript**