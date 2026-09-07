import {
  PDFExtractor,
  type PDFParseOptions,
  type PDFParseResult
} from '../utils/pdf-extractor.js';
import {
  ConversionError,
  InvalidFileError,
  ParseError
} from '../types/errors.js';
import type { ConvertOptions } from '../types/interfaces.js';
import { checkResources } from '../utils/resource-monitor.js';

export async function parsePdf(
  buffer: Buffer,
  options: PDFParseOptions & { options?: ConvertOptions } = {}
): Promise<PDFParseResult> {
  try {
    const { getDocumentProxy } = await import('unpdf');
    // PDF.js may transfer its input. Never detach the caller's Buffer.
    const document = await getDocumentProxy(new Uint8Array(buffer), {
      isEvalSupported: false,
      useSystemFonts: false,
      verbosity: 0
    });
    try {
      const pageCount = Math.min(
        document.numPages,
        options.maxPages ?? document.numPages
      );
      const pages: string[] = [];
      const extractor = new PDFExtractor();
      for (let number = 1; number <= pageCount; number++) {
        checkResources();
        const page = await document.getPage(number);
        try {
          const content = await page.getTextContent();
          let pageText = '';
          let previousY: number | undefined;
          let previousEnd: number | undefined;
          for (const item of content.items) {
            if (!('str' in item)) continue;
            const y = item.transform[5];
            const x = item.transform[4];
            if (
              previousY !== undefined &&
              Math.abs(y - previousY) > 2 &&
              !pageText.endsWith('\n')
            )
              pageText += '\n';
            else if (
              previousEnd !== undefined &&
              x - previousEnd > 1 &&
              !/\s$/.test(pageText)
            )
              pageText += ' ';
            pageText += item.str;
            if (item.hasEOL) pageText += '\n';
            previousY = y;
            previousEnd = x + item.width;
          }
          pages.push(
            options.preserveLayout === false
              ? pageText.trim()
              : await extractor.enhanceTextWithLayout(pageText)
          );
        } finally {
          page.cleanup();
        }
      }
      const markdown = pages.join('\n\n').trim();
      if (!markdown)
        throw new InvalidFileError(
          'PDF contains no extractable text; scanned documents require OCR'
        );
      const metadata = await document.getMetadata();
      return {
        markdown,
        images: [],
        pageCount,
        metadata: { info: metadata.info, totalPages: document.numPages }
      };
    } finally {
      await document.destroy();
    }
  } catch (error) {
    if (error instanceof ConversionError) throw error;
    throw new ParseError('PDF', 'Could not read the PDF', error as Error);
  }
}
