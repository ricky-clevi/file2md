# Security Audit Report - file2md NPM Package

**Audit Date:** 2025-10-30
**Package Version:** 1.4.55
**Auditor:** Claude (AI Security Auditor)

## Executive Summary

This security audit identified **5 security issues** ranging from **CRITICAL to MEDIUM** severity. The most critical finding is that **security features exist in the codebase but are not actually being applied** due to missing parameter passing in the main entry point.

### Overall Risk Assessment: **HIGH**

While the codebase includes comprehensive security utilities (XXE protection, ZIP bomb detection, path traversal prevention), these protections are **conditionally applied** and currently **not active** in the default usage path.

---

## Critical Issues

### 1. Security Features Not Enabled by Default ⚠️ **CRITICAL**

**Location:** `src/index.ts` lines 193, 212, 230, 252
**Severity:** CRITICAL
**CWE:** CWE-693 (Protection Mechanism Failure)

**Description:**
The package has comprehensive security features implemented in:
- `src/utils/secure-xml-parser.ts` (XXE protection)
- `src/utils/zip-security.ts` (ZIP bomb, path traversal protection)
- `src/utils/resource-monitor.ts` (resource limits)

However, these security features are **never applied** because the parsers only enable security when `options.options` is provided, but this parameter is **not passed** from the main `convert()` function.

**Evidence:**
```typescript
// src/index.ts:193 - DOCX parser call
const result = await parseDocx(buffer, imageExtractor, chartExtractor, {
  preserveLayout,
  extractImages,
  extractCharts
  // ❌ Missing: options parameter
});

// src/parsers/docx-parser.ts:68-72 - Security is conditional
let secureExtractor: SecureZipExtractor | undefined;
if (options.options) {  // ❌ This condition is always false!
  const securityConfig = createZipSecurityConfig(options.options);
  secureExtractor = new SecureZipExtractor(securityConfig);
}
```

**Impact:**
- XXE (XML External Entity) attacks possible on DOCX, XLSX, PPTX, HWPX files
- ZIP bomb attacks not prevented
- Path traversal attacks not prevented
- No resource limits enforced during ZIP extraction
- No validation of file sizes within archives

**Exploitation Scenario:**
An attacker could:
1. Create a malicious DOCX file with XXE payload to read `/etc/passwd`
2. Create a ZIP bomb disguised as a PPTX to cause DoS
3. Use path traversal in HWPX to write files outside intended directory

**Recommendation:**
```typescript
// Fix in src/index.ts - Pass options to all parsers
const result = await parseDocx(buffer, imageExtractor, chartExtractor, {
  preserveLayout,
  extractImages,
  extractCharts,
  options  // ✅ Add this line
});
```

Apply the same fix to all parser calls (XLSX, PPTX, HWP) in `src/index.ts`.

---

### 2. Insecure XML Parsing Fallback ⚠️ **HIGH**

**Location:** `src/parsers/docx-parser.ts` lines 119-137
**Severity:** HIGH
**CWE:** CWE-611 (Improper Restriction of XML External Entity Reference)

**Description:**
The DOCX parser has a fallback that uses `parseStringPromise` without any XXE protection when security options are not provided.

**Evidence:**
```typescript
// src/parsers/docx-parser.ts:114-138
if (options.options) {
  const secureXmlParser = createSecureXmlParser(options.options);
  result = await secureXmlParser(xmlContent);
} else {
  // ❌ INSECURE FALLBACK - No XXE protection
  const parseOptions: ParserOptions = {
    // ... options without XXE protection
  };
  result = await parseStringPromise(xmlContent, parseOptions);
}
```

**Impact:**
- Direct XXE vulnerability when processing DOCX files without security options
- Attacker can read local files, perform SSRF, or cause DoS

**Recommendation:**
Always use secure XML parsing regardless of whether options are provided. Remove the insecure fallback or apply minimal XXE protection.

---

### 3. Path Traversal in Image Output Directory ⚠️ **MEDIUM**

**Location:** `src/utils/image-extractor.ts` line 149
**Severity:** MEDIUM
**CWE:** CWE-22 (Improper Limitation of a Pathname to a Restricted Directory)

**Description:**
The `ImageExtractor` class accepts an `outputDir` parameter without validation and writes files using `fs.writeFileSync` with `path.join()`.

**Evidence:**
```typescript
// src/utils/image-extractor.ts:27-36
constructor(outputDir: string = 'images') {
  this.outputDir = outputDir;  // ❌ No validation
  // ...
  if (!fs.existsSync(this.outputDir)) {
    fs.mkdirSync(this.outputDir, { recursive: true });  // ❌ Could create outside CWD
  }
}

// Line 147-149
const filename = hasExtension ? providedName : `image_${this.imageCounter}${finalExt}`;
const fullPath = path.join(this.outputDir, filename);  // ❌ Vulnerable to path traversal
fs.writeFileSync(fullPath, finalBuffer);
```

**Impact:**
- If the user passes `outputDir` with path traversal sequences (e.g., `../../tmp/malicious`)
- Files could be written outside the intended directory
- Combined with malicious document content, could overwrite sensitive files

**Exploitation Scenario:**
```typescript
// Attacker convinces user to use:
convert(buffer, {
  imageDir: '../../../home/user/.ssh/authorized_keys'
});
```

**Recommendation:**
1. Validate `outputDir` parameter in constructor:
```typescript
constructor(outputDir: string = 'images') {
  // Validate and normalize the path
  validateFilePath(outputDir);
  const normalized = path.normalize(outputDir);
  if (normalized.includes('..') || path.isAbsolute(normalized)) {
    throw new SecurityError('Invalid output directory path');
  }
  this.outputDir = normalized;
}
```

2. Add additional validation before `fs.writeFileSync`:
```typescript
const fullPath = path.join(this.outputDir, filename);
const resolvedPath = path.resolve(fullPath);
const resolvedDir = path.resolve(this.outputDir);
if (!resolvedPath.startsWith(resolvedDir)) {
  throw new PathTraversalError('Attempt to write outside output directory');
}
fs.writeFileSync(fullPath, finalBuffer);
```

---

## Medium Issues

### 4. Inconsistent Security Configuration ⚠️ **MEDIUM**

**Location:** Multiple parsers
**Severity:** MEDIUM
**CWE:** CWE-1188 (Initialization of a Resource with an Insecure Default Value)

**Description:**
Security features are opt-in rather than enabled by default. While backwards compatibility is mentioned, security should not be optional.

**Affected Files:**
- `src/parsers/docx-parser.ts`
- `src/parsers/xlsx-parser.ts`
- `src/parsers/pptx-parser.ts`
- `src/parsers/hwp-parser.ts`

**Impact:**
- Users who don't explicitly enable security options are vulnerable
- Defense-in-depth principle violated

**Recommendation:**
Make security features enabled by default with ability to opt-out:
```typescript
if (options.options?.enableXXEProtection !== false) {
  // Enable security by default
}
```

---

### 5. Information Disclosure in Error Messages ⚠️ **LOW**

**Location:** `src/index.ts` line 104
**Severity:** LOW
**CWE:** CWE-209 (Generation of Error Message Containing Sensitive Information)

**Description:**
File path disclosure in error messages could help attackers understand the system structure.

**Evidence:**
```typescript
// src/index.ts:100-104
if ((error as { code: string })?.code === 'ENOENT') {
  throw new FileNotFoundError(input);  // ❌ Leaks full file path
}
```

**Recommendation:**
Sanitize file paths in production error messages or log full paths only to secure logs.

---

## Positive Security Findings ✅

The codebase demonstrates good security awareness with:

1. **Comprehensive Security Utilities:**
   - XXE protection with pattern matching (`secure-xml-parser.ts`)
   - ZIP bomb detection with compression ratio checks (`zip-security.ts`)
   - Path traversal prevention (`zip-security.ts`)
   - Resource monitoring and limits (`resource-monitor.ts`)

2. **No Dependency Vulnerabilities:**
   - `npm audit` shows 0 vulnerabilities

3. **No Command Injection Risks:**
   - No use of `exec`, `spawn`, or `system` calls

4. **No Hardcoded Secrets:**
   - No passwords, API keys, or tokens in source code

5. **Security Testing:**
   - Comprehensive security test suite (`tests/security.test.ts`)

6. **Proper Error Handling:**
   - Custom error classes with proper inheritance
   - Stack traces preserved

---

## Recommendations Summary

### Immediate Actions (Critical Priority)

1. **Fix Issue #1 - Enable Security Features:**
   - Modify `src/index.ts` to pass `options` parameter to all parser calls
   - Add this line to calls to `parseDocx`, `parseXlsx`, `parsePptx`, `parseHwp`
   - **Estimated Fix Time:** 10 minutes

2. **Fix Issue #2 - Remove Insecure XML Fallback:**
   - Always use secure XML parsing
   - Remove conditional security checks
   - **Estimated Fix Time:** 15 minutes

3. **Fix Issue #3 - Validate Output Directory:**
   - Add path validation in `ImageExtractor` constructor
   - Add boundary checks before file writes
   - **Estimated Fix Time:** 30 minutes

### Short-term Actions (High Priority)

4. **Make Security Enabled by Default:**
   - Change opt-in security to opt-out
   - Update documentation to reflect secure defaults
   - **Estimated Fix Time:** 1 hour

5. **Add Integration Tests:**
   - Test that security features are actually applied
   - Add tests for malicious documents
   - **Estimated Fix Time:** 2 hours

### Long-term Actions (Medium Priority)

6. **Security Documentation:**
   - Document security features in README
   - Provide security best practices guide
   - **Estimated Fix Time:** 2 hours

7. **Security Audit in CI/CD:**
   - Add automated security testing
   - Add dependency vulnerability scanning
   - **Estimated Fix Time:** 3 hours

---

## Testing Verification

To verify these issues exist, run the included security tests:

```bash
npm test -- tests/security.test.ts
```

However, note that **Issue #1** means the security tests may pass while real usage is still vulnerable because tests might directly call secure functions.

---

## Conclusion

The file2md package has **excellent security utilities** but they are **not being used** in the main code path. This is a critical configuration error that makes the package vulnerable to multiple attack vectors despite having the code to prevent them.

**Priority:** Fix Issue #1 immediately as it's a simple code change that enables all existing security features.

**Risk Level After Fixes:** LOW (assuming all recommendations are implemented)

---

## References

- CWE-611: Improper Restriction of XML External Entity Reference
- CWE-22: Improper Limitation of a Pathname to a Restricted Directory
- CWE-693: Protection Mechanism Failure
- CWE-409: Improper Handling of Highly Compressed Data (Zip Bomb)
- OWASP Top 10 2021: A05:2021 – Security Misconfiguration

---

**Audit Completed:** 2025-10-30
**Next Recommended Audit:** After implementing fixes, conduct penetration testing with malicious documents
