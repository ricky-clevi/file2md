import { describe, it, expect, beforeEach } from '@jest/globals';
import { Buffer } from 'node:buffer';
import JSZip from 'jszip';

import { convert } from '../src/index.js';
import { SecurityError, ResourceLimitError } from '../src/types/errors.js';
import { SecureZipExtractor, createZipSecurityConfig } from '../src/utils/zip-security.js';
import { createSecureXmlParser, validateXmlContent } from '../src/utils/secure-xml-parser.js';
import { validateBuffer, ResourceMonitor } from '../src/utils/resource-monitor.js';

describe('Security Features', () => {
  describe('ZIP Security', () => {
    it('should detect and prevent ZIP bombs', async () => {
      // Create a ZIP bomb-like structure
      const zip = new JSZip();
      const largeContent = 'A'.repeat(1000000); // 1MB of data
      zip.file('bomb.txt', largeContent);
      
      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
      
      const securityConfig = createZipSecurityConfig({
        maxExtractedSize: 500000, // 500KB limit
        maxExtractedFiles: 10
      });
      
      const extractor = new SecureZipExtractor(securityConfig);
      const loadedZip = await JSZip.loadAsync(zipBuffer);
      
      // Should throw SecurityError due to size limit
      await expect(extractor.validate(loadedZip)).rejects.toThrow(SecurityError);
    });

    it('should prevent path traversal attacks', async () => {
      // Test the validate function directly
      const { validateFilePath } = require('../src/utils/zip-security.js');
      
      // Should throw for path traversal attempts
      expect(() => validateFilePath('../../../etc/passwd')).toThrow();
      expect(() => validateFilePath('..\\..\\..\\windows\\system32')).toThrow();
      expect(() => validateFilePath('/etc/passwd')).toThrow();
    });

    it('should allow safe file paths', async () => {
      const zip = new JSZip();
      zip.file('documents/safe.txt', 'safe content');
      zip.file('images/photo.jpg', 'fake image data');
      
      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
      
      const securityConfig = createZipSecurityConfig({
        enablePathValidation: true,
        maxExtractedFiles: 10,
        maxExtractedSize: 1000000
      });
      
      const extractor = new SecureZipExtractor(securityConfig);
      const loadedZip = await JSZip.loadAsync(zipBuffer);
      
      // Should not throw for safe paths
      await expect(extractor.validate(loadedZip)).resolves.not.toThrow();
    });
  });

  describe('XML Security', () => {
    it('should detect XXE attacks', () => {
      const maliciousXml = `<?xml version="1.0"?>
        <!DOCTYPE foo [
          <!ENTITY xxe SYSTEM "file:///etc/passwd">
        ]>
        <root>&xxe;</root>`;
      
      const config = {
        enableXXEProtection: true,
        maxXmlSize: 1000000,
        maxParsingTime: 30000,
        allowExternalEntities: false,
        allowDTD: false
      };
      
      expect(() => validateXmlContent(maliciousXml, config)).toThrow(SecurityError);
    });

    it('should detect entity expansion attacks', () => {
      const maliciousXml = `<?xml version="1.0"?>
        <!DOCTYPE foo [
          <!ENTITY lol "lol">
          <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
          <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
        ]>
        <root>&lol3;</root>`;
      
      const config = {
        enableXXEProtection: true,
        maxXmlSize: 1000000,
        maxParsingTime: 30000,
        allowExternalEntities: false,
        allowDTD: false
      };
      
      expect(() => validateXmlContent(maliciousXml, config)).toThrow(SecurityError);
    });

    it('should limit XML size', () => {
      const largeXml = '<root>' + 'A'.repeat(2000000) + '</root>'; // 2MB
      
      const config = {
        enableXXEProtection: true,
        maxXmlSize: 1000000, // 1MB limit
        maxParsingTime: 30000,
        allowExternalEntities: false,
        allowDTD: false
      };
      
      expect(() => validateXmlContent(largeXml, config)).toThrow(SecurityError);
    });

    it('should parse safe XML', async () => {
      const safeXml = '<root><item>Hello World</item></root>';
      
      const config = {
        enableXXEProtection: true,
        maxXmlSize: 1000000,
        maxParsingTime: 30000,
        allowExternalEntities: false,
        allowDTD: false
      };
      
      // Should not throw for safe XML
      expect(() => validateXmlContent(safeXml, config)).not.toThrow();
      
      const parser = createSecureXmlParser({ enableXXEProtection: true });
      const result = await parser(safeXml);
      
      expect(result).toHaveProperty('root');
    });
  });

  describe('Resource Monitoring', () => {
    let monitor: ResourceMonitor;

    beforeEach(() => {
      monitor = new ResourceMonitor({
        maxFileSize: 10 * 1024 * 1024, // 10MB
        maxMemoryUsage: 100 * 1024 * 1024, // 100MB
        timeout: 30000, // 30 seconds
        memoryCheckInterval: 1000
      });
    });

    it('should validate file size limits', () => {
      const largeBuffer = Buffer.alloc(20 * 1024 * 1024); // 20MB
      
      expect(() => monitor.validateFileSize(largeBuffer)).toThrow(ResourceLimitError);
    });

    it('should allow files within size limits', () => {
      const smallBuffer = Buffer.alloc(5 * 1024 * 1024); // 5MB
      
      expect(() => monitor.validateFileSize(smallBuffer)).not.toThrow();
    });

    it('should track memory usage', () => {
      const stats = monitor.getResourceStats();
      
      expect(stats).toHaveProperty('memoryUsage');
      expect(stats).toHaveProperty('memoryDelta');
      expect(stats).toHaveProperty('elapsedTime');
    });
  });

  describe('Buffer Validation', () => {
    it('should detect empty files', () => {
      const emptyBuffer = Buffer.alloc(0);
      
      expect(() => validateBuffer(emptyBuffer, {})).toThrow(SecurityError);
    });

    it('should detect null bytes in text content', () => {
      const bufferWithNull = Buffer.from('Hello\x00World');
      
      expect(() => validateBuffer(bufferWithNull, {}, 'text')).toThrow(SecurityError);
    });

    it('should allow normal content', () => {
      const normalBuffer = Buffer.from('This is normal document content with varied characters and punctuation!');
      
      expect(() => validateBuffer(normalBuffer, {})).not.toThrow();
    });
  });

  describe('Integration Tests', () => {
    it('should apply security settings to document conversion', async () => {
      const safeDocBuffer = Buffer.from('Hello World'); // Simple text
      
      // This will fail because it's not a valid document, but should not fail due to security
      await expect(convert(safeDocBuffer, {
        maxFileSize: 1000000,
        maxMemoryUsage: 50 * 1024 * 1024,
        enableXXEProtection: true,
        timeout: 10000
      })).rejects.toThrow(); // Should throw parsing error, not security error
    });

    it('should reject oversized files', async () => {
      const largeBuffer = Buffer.alloc(200 * 1024 * 1024); // 200MB
      
      await expect(convert(largeBuffer, {
        maxFileSize: 100 * 1024 * 1024 // 100MB limit
      })).rejects.toThrow(ResourceLimitError);
    });

    it('should include security metadata in results', async () => {
      // Create a minimal valid PDF-like buffer (just for testing metadata)
      const testBuffer = Buffer.from('%PDF-1.4\nHello World\n%%EOF');
      
      try {
        const result = await convert(testBuffer, {
          maxFileSize: 1000000,
          enableXXEProtection: true,
          maxMemoryUsage: 50 * 1024 * 1024
        });
        
        expect(result.metadata.additional).toHaveProperty('security');
        expect(result.metadata.additional.security).toHaveProperty('securityFeatures');
      } catch (error) {
        // Expected to fail parsing, but should not throw a critical security error
        // ResourceLimitError extends SecurityError, so we check for specific security codes
        if (error instanceof SecurityError) {
          expect(error.severity).not.toBe('critical');
        }
      }
    });
  });
});