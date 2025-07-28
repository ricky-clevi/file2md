const { convert } = require('../src/index');
const { 
  UnsupportedFormatError, 
  FileNotFoundError, 
  InvalidFileError 
} = require('../src/types/index');

describe('file2md', () => {
  describe('convert function', () => {
    it('should throw FileNotFoundError for non-existent file', async () => {
      await expect(convert('./non-existent-file.pdf')).rejects.toThrow(FileNotFoundError);
    });

    it('should throw InvalidFileError for invalid input', async () => {
      // @ts-expect-error Testing invalid input
      await expect(convert(123)).rejects.toThrow(InvalidFileError);
    });

    it('should throw UnsupportedFormatError for empty buffer', async () => {
      const emptyBuffer = Buffer.alloc(0);
      await expect(convert(emptyBuffer)).rejects.toThrow(UnsupportedFormatError);
    });

    it('should throw UnsupportedFormatError for unsupported file type', async () => {
      // Create a buffer that looks like a text file
      const textBuffer = Buffer.from('This is just plain text');
      await expect(convert(textBuffer)).rejects.toThrow(UnsupportedFormatError);
    });

    it('should accept ConvertOptions', async () => {
      const options = {
        imageDir: 'test-images',
        preserveLayout: false,
        extractCharts: false,
        extractImages: false,
        maxPages: 5
      };
      
      // This should not throw for the options structure
      expect(() => options).not.toThrow();
      
      // Test with non-existent file will throw FileNotFoundError, but options are valid
      await expect(convert('./test.pdf', options)).rejects.toThrow(FileNotFoundError);
    });
  });

  describe('error types', () => {
    it('should create proper error instances', () => {
      const unsupportedError = new UnsupportedFormatError('text/plain');
      expect(unsupportedError).toBeInstanceOf(UnsupportedFormatError);
      expect(unsupportedError.message).toContain('text/plain');
      expect(unsupportedError.code).toBe('UNSUPPORTED_FORMAT');

      const fileNotFoundError = new FileNotFoundError('./test.pdf');
      expect(fileNotFoundError).toBeInstanceOf(FileNotFoundError);
      expect(fileNotFoundError.message).toContain('./test.pdf');
      expect(fileNotFoundError.code).toBe('FILE_NOT_FOUND');

      const invalidFileError = new InvalidFileError('Test reason');
      expect(invalidFileError).toBeInstanceOf(InvalidFileError);
      expect(invalidFileError.message).toContain('Test reason');
      expect(invalidFileError.code).toBe('INVALID_FILE');
    });
  });
});