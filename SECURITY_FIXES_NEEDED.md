# Critical Security Fixes Required

## Issue 1: Security Features Not Applied (CRITICAL)

### Problem
Security features exist but are never called because `options` parameter is not passed to parsers.

### Fix Required in `src/index.ts`

#### Line 193 - DOCX Parser
**Before:**
```typescript
const result = await parseDocx(buffer, imageExtractor, chartExtractor, {
  preserveLayout,
  extractImages,
  extractCharts
});
```

**After:**
```typescript
const result = await parseDocx(buffer, imageExtractor, chartExtractor, {
  preserveLayout,
  extractImages,
  extractCharts,
  options  // ADD THIS LINE
});
```

#### Line 212 - XLSX Parser
**Before:**
```typescript
const result = await parseXlsx(buffer, imageExtractor, chartExtractor, {
  preserveLayout,
  extractCharts
});
```

**After:**
```typescript
const result = await parseXlsx(buffer, imageExtractor, chartExtractor, {
  preserveLayout,
  extractCharts,
  options  // ADD THIS LINE
});
```

#### Line 230 - PPTX Parser
**Before:**
```typescript
const result = await parsePptx(buffer, imageExtractor, chartExtractor, {
  preserveLayout,
  extractImages,
  extractCharts,
  outputDir
});
```

**After:**
```typescript
const result = await parsePptx(buffer, imageExtractor, chartExtractor, {
  preserveLayout,
  extractImages,
  extractCharts,
  outputDir,
  options  // ADD THIS LINE
});
```

#### Line 252 - HWP Parser
**Before:**
```typescript
const result = await parseHwp(buffer, imageExtractor, chartExtractor, {
  preserveLayout,
  extractImages,
  extractCharts
});
```

**After:**
```typescript
const result = await parseHwp(buffer, imageExtractor, chartExtractor, {
  preserveLayout,
  extractImages,
  extractCharts,
  options  // ADD THIS LINE
});
```

#### Line 178 - PDF Parser (for consistency)
**Before:**
```typescript
const result = await parsePdf(buffer, { maxPages, preserveLayout });
```

**After:**
```typescript
const result = await parsePdf(buffer, { maxPages, preserveLayout, options });
```

---

## Issue 2: Insecure XML Parsing Fallback (HIGH)

### Problem
DOCX parser falls back to insecure XML parsing when options not provided.

### Fix Required in `src/parsers/docx-parser.ts`

#### Lines 114-138
**Before:**
```typescript
// Parse XML securely if security options are provided
let result: Record<string, unknown>;
if (options.options) {
  const secureXmlParser = createSecureXmlParser(options.options);
  result = await secureXmlParser(xmlContent);
} else {
  // Try parsing with different options to handle namespaces
  const parseOptions: ParserOptions = {
    explicitCharkey: false,
    trim: true,
    normalize: true,
    explicitRoot: true,
    emptyTag: () => null,
    explicitChildren: false,
    charsAsChildren: false,
    includeWhiteChars: false,
    mergeAttrs: false,
    attrNameProcessors: [],
    attrValueProcessors: [],
    tagNameProcessors: [],
    valueProcessors: []
  };

  result = await parseStringPromise(xmlContent, parseOptions) as Record<string, unknown>;
}
```

**After:**
```typescript
// Always parse XML securely
const secureXmlParser = createSecureXmlParser(options.options || {});
const result = await secureXmlParser(xmlContent) as Record<string, unknown>;
```

Apply the same fix to similar patterns in:
- `src/parsers/xlsx-parser.ts` (multiple locations)
- `src/parsers/pptx-parser.ts` (multiple locations)
- `src/parsers/hwp-parser.ts` (if similar pattern exists)

---

## Issue 3: Path Traversal in Image Output (MEDIUM)

### Problem
ImageExtractor accepts outputDir without validation and could write files outside intended directory.

### Fix Required in `src/utils/image-extractor.ts`

#### Add validation to constructor (around line 27)
**Before:**
```typescript
constructor(outputDir: string = 'images') {
  this.outputDir = outputDir;

  // Reset counter to ensure fresh start
  this.reset();

  // Create images directory if it doesn't exist
  if (!fs.existsSync(this.outputDir)) {
    fs.mkdirSync(this.outputDir, { recursive: true });
  }
}
```

**After:**
```typescript
constructor(outputDir: string = 'images') {
  // Validate output directory for security
  const normalized = path.normalize(outputDir);

  // Prevent path traversal and absolute paths
  if (normalized.includes('..') || path.isAbsolute(normalized)) {
    throw new SecurityError(
      'Invalid output directory: path traversal or absolute paths not allowed',
      'INVALID_OUTPUT_PATH',
      'high'
    );
  }

  this.outputDir = normalized;

  // Reset counter to ensure fresh start
  this.reset();

  // Create images directory if it doesn't exist
  if (!fs.existsSync(this.outputDir)) {
    fs.mkdirSync(this.outputDir, { recursive: true });
  }
}
```

#### Add validation before writing files (around line 147-149)
**Before:**
```typescript
const filename = hasExtension ? providedName : `image_${this.imageCounter}${finalExt}`;
const fullPath = path.join(this.outputDir, filename);

fs.writeFileSync(fullPath, finalBuffer);
```

**After:**
```typescript
const filename = hasExtension ? providedName : `image_${this.imageCounter}${finalExt}`;
const fullPath = path.join(this.outputDir, filename);

// Validate that resolved path is still within output directory
const resolvedPath = path.resolve(fullPath);
const resolvedDir = path.resolve(this.outputDir);
if (!resolvedPath.startsWith(resolvedDir + path.sep) && resolvedPath !== resolvedDir) {
  throw new PathTraversalError(
    `Attempt to write file outside output directory: ${filename}`
  );
}

fs.writeFileSync(fullPath, finalBuffer);
```

---

## Testing After Fixes

1. Run existing security tests:
```bash
npm test -- tests/security.test.ts
```

2. Test with malicious DOCX containing XXE:
```typescript
// Should throw SecurityError
const xxeDocx = '...'; // DOCX with XXE payload
await convert(xxeDocx);
```

3. Test with ZIP bomb:
```typescript
// Should throw ResourceLimitError
const zipBomb = '...'; // Highly compressed file
await convert(zipBomb);
```

4. Test path traversal:
```typescript
// Should throw SecurityError
await convert(buffer, { imageDir: '../../../etc' });
```

---

## Deployment Plan

1. **Create feature branch**: `security/fix-critical-issues`
2. **Apply fixes**: Make changes listed above
3. **Run tests**: Ensure all tests pass
4. **Manual testing**: Test with actual malicious documents
5. **Security review**: Have another developer review changes
6. **Merge and release**: Release as patch version (1.4.56) with security note

---

## Version Bump Recommendation

Since these are security fixes:
- **Recommended Version**: 1.4.56 (patch version)
- **Type**: Security patch
- **Breaking Changes**: None (only internal behavior changes)

## Changelog Entry

```markdown
## [1.4.56] - 2025-10-30

### Security
- **CRITICAL**: Fixed security features not being applied by default
- **HIGH**: Removed insecure XML parsing fallback to prevent XXE attacks
- **MEDIUM**: Added path traversal protection to image output directory
- **MEDIUM**: Enabled security features by default (XXE protection, ZIP bomb detection, path validation)

All users should upgrade immediately.
```
