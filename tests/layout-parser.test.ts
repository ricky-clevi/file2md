const { LayoutParser } = require('../src/utils/layout-parser');

describe('LayoutParser', () => {
  describe('createColumns', () => {
    it('should handle undefined columns gracefully', () => {
      const parser = new LayoutParser();
      expect(() => parser.createColumns(undefined)).not.toThrow();
      expect(parser.createColumns(undefined)).toBe('');
    });
  });
});
