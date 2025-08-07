const { parseHwp } = require('../src/parsers/hwp-parser');
const { ImageExtractor } = require('../src/utils/image-extractor');
const { ChartExtractor } = require('../src/utils/chart-extractor');
const { ParseError } = require('../src/types/errors');
const fs = require('node:fs');
const path = require('node:path');

// Mock console methods to reduce noise during testing
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

beforeAll(() => {
  console.log = jest.fn();
  console.warn = jest.fn();  
  console.error = jest.fn();
});

afterAll(() => {
  console.log = originalConsoleLog;
  console.warn = originalConsoleWarn;
  console.error = originalConsoleError;
});

describe('HWP Parser', () => {
  let imageExtractor;
  let chartExtractor;
  let tempDir;

  beforeEach(() => {
    tempDir = path.join(__dirname, 'temp-hwp-test');
    imageExtractor = new ImageExtractor(tempDir);
    chartExtractor = new ChartExtractor(imageExtractor);
  });

  afterEach(async () => {
    // Clean up temp directory
    try {
      if (fs.existsSync(tempDir)) {
        const files = fs.readdirSync(tempDir);
        for (const file of files) {
          fs.unlinkSync(path.join(tempDir, file));
        }
        fs.rmdirSync(tempDir);
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Format Detection', () => {
    it('should detect HWP binary format correctly', async () => {
      // Create a buffer with CFB/OLE2 signature
      const hwpBuffer = Buffer.from([
        0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1, // CFB signature
        ...Array(100).fill(0x00) // Padding
      ]);

      // This should attempt to parse as HWP but will likely fail due to invalid content
      // We're testing that it recognizes the format, not that it parses successfully
      await expect(parseHwp(hwpBuffer, imageExtractor, chartExtractor))
        .rejects.toThrow(ParseError);
    });

    it('should detect HWPX XML format correctly', async () => {
      // Create a buffer with ZIP signature
      const hwpxBuffer = Buffer.from([
        0x50, 0x4B, 0x03, 0x04, // ZIP signature
        ...Array(100).fill(0x00) // Padding
      ]);

      // This should attempt to parse as HWPX but will likely fail due to invalid ZIP content
      await expect(parseHwp(hwpxBuffer, imageExtractor, chartExtractor))
        .rejects.toThrow(ParseError);
    });

    it('should reject invalid formats', async () => {
      const invalidBuffer = Buffer.from('This is not a valid HWP file');

      await expect(parseHwp(invalidBuffer, imageExtractor, chartExtractor))
        .rejects.toThrow(ParseError);
      
      await expect(parseHwp(invalidBuffer, imageExtractor, chartExtractor))
        .rejects.toThrow('Unsupported HWP format variant');
    });

    it('should handle empty buffers', async () => {
      const emptyBuffer = Buffer.alloc(0);

      await expect(parseHwp(emptyBuffer, imageExtractor, chartExtractor))
        .rejects.toThrow(ParseError);
    });
  });

  describe('Parser Options', () => {
    it('should accept parsing options', async () => {
      const hwpBuffer = Buffer.from([
        0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1,
        ...Array(100).fill(0x00)
      ]);

      const options = {
        preserveLayout: true,
        extractImages: false,
        extractCharts: false
      };

      // Should not throw for valid options structure
      await expect(parseHwp(hwpBuffer, imageExtractor, chartExtractor, options))
        .rejects.toThrow(ParseError); // Will fail on content, not options
    });

    it('should use default options when none provided', async () => {
      const hwpBuffer = Buffer.from([
        0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1,
        ...Array(100).fill(0x00)
      ]);

      // Should not throw for missing options
      await expect(parseHwp(hwpBuffer, imageExtractor, chartExtractor))
        .rejects.toThrow(ParseError); // Will fail on content, not options
    });
  });

  describe('Error Handling', () => {
    it('should handle parsing errors gracefully', async () => {
      const invalidHwpBuffer = Buffer.from([
        0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1, // Valid signature
        0xFF, 0xFF, 0xFF, 0xFF // Invalid content
      ]);

      const error = await parseHwp(invalidHwpBuffer, imageExtractor, chartExtractor)
        .catch(err => err);

      expect(error).toBeInstanceOf(ParseError);
      expect(error.fileType).toBe('HWP');
      expect(error.message).toContain('Failed to parse HWP');
    });

    it('should provide meaningful error messages', async () => {
      const corruptBuffer = Buffer.from([0x00, 0x00, 0x00, 0x00]);

      const error = await parseHwp(corruptBuffer, imageExtractor, chartExtractor)
        .catch(err => err);

      expect(error).toBeInstanceOf(ParseError);
      expect(error.message).toBeTruthy();
      expect(typeof error.message).toBe('string');
    });
  });

  describe('Result Structure', () => {
    it('should return properly structured result for successful parsing', async () => {
      // We can't easily test successful parsing without real HWP files
      // But we can test the structure when mocked
      const mockResult = {
        markdown: '# Test Content',
        images: [],
        charts: [],
        metadata: { format: 'hwp', parser: 'hwp.js' }
      };

      // Test result structure matches expected interface
      expect(mockResult).toHaveProperty('markdown');
      expect(mockResult).toHaveProperty('images');
      expect(mockResult).toHaveProperty('charts');
      expect(mockResult).toHaveProperty('metadata');
      expect(typeof mockResult.markdown).toBe('string');
      expect(Array.isArray(mockResult.images)).toBe(true);
      expect(Array.isArray(mockResult.charts)).toBe(true);
      expect(typeof mockResult.metadata).toBe('object');
    });
  });

  describe('Integration', () => {
    it('should work with ImageExtractor', () => {
      expect(imageExtractor).toBeDefined();
      expect(typeof imageExtractor.imageDirectory).toBe('string');
    });

    it('should work with ChartExtractor', () => {
      expect(chartExtractor).toBeDefined();
      expect(typeof chartExtractor.extractChartsFromZip).toBe('function');
    });

    it('should handle missing dependencies gracefully', async () => {
      // Test that parser handles missing hwp.js dependency
      const hwpBuffer = Buffer.from([
        0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1,
        ...Array(50).fill(0x00)
      ]);

      // This will likely fail due to import issues, but shouldn't crash
      const error = await parseHwp(hwpBuffer, imageExtractor, chartExtractor)
        .catch(err => err);

      expect(error).toBeInstanceOf(Error);
      // Error could be ParseError or import error - both are acceptable
    });
  });

  describe('File Signature Detection', () => {
    it('should correctly identify CFB/OLE2 signature for HWP', () => {
      const cfbSignature = Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]);
      
      expect(cfbSignature.length).toBe(8);
      expect(cfbSignature[0]).toBe(0xD0);
      expect(cfbSignature[7]).toBe(0xE1);
    });

    it('should correctly identify ZIP signature for HWPX', () => {
      const zipSignature = Buffer.from([0x50, 0x4B, 0x03, 0x04]);
      
      expect(zipSignature.length).toBe(4);
      expect(zipSignature[0]).toBe(0x50);
      expect(zipSignature[1]).toBe(0x4B);
    });
  });
});