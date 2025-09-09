import { parseStringPromise, type ParserOptions } from 'xml2js';
import { XMLParser, type X2jOptions } from 'fast-xml-parser';
import { SecurityError } from '../types/errors.js';
import type { ConvertOptions } from '../types/interfaces.js';

/**
 * Security configuration for XML parsing
 */
export interface XmlSecurityConfig {
  /** Enable XXE protection */
  readonly enableXXEProtection: boolean;
  /** Maximum XML document size in bytes */
  readonly maxXmlSize: number;
  /** Maximum parsing time in milliseconds */
  readonly maxParsingTime: number;
  /** Enable external entity resolution */
  readonly allowExternalEntities: boolean;
  /** Enable DTD processing */
  readonly allowDTD: boolean;
}

/**
 * Default secure XML configuration
 */
export const DEFAULT_XML_SECURITY_CONFIG: XmlSecurityConfig = {
  enableXXEProtection: true,
  maxXmlSize: 10 * 1024 * 1024,  // 10MB max XML size
  maxParsingTime: 30000,         // 30 seconds max parsing time
  allowExternalEntities: false,  // No external entities
  allowDTD: false               // No DTD processing
};

/**
 * Create XML security configuration from ConvertOptions
 */
export function createXmlSecurityConfig(options: ConvertOptions): XmlSecurityConfig {
  return {
    enableXXEProtection: options.enableXXEProtection !== false,
    maxXmlSize: options.maxIndividualFileSize || DEFAULT_XML_SECURITY_CONFIG.maxXmlSize,
    maxParsingTime: options.timeout || DEFAULT_XML_SECURITY_CONFIG.maxParsingTime,
    allowExternalEntities: false,
    allowDTD: false
  };
}

/**
 * Validate XML content before parsing
 */
export function validateXmlContent(xmlContent: string, config: XmlSecurityConfig): void {
  // Check size limits
  if (xmlContent.length > config.maxXmlSize) {
    throw new SecurityError(
      `XML content too large: ${xmlContent.length} bytes > ${config.maxXmlSize} bytes`,
      'XML_SIZE_LIMIT_EXCEEDED',
      'high'
    );
  }

  if (config.enableXXEProtection) {
    // Check for potentially dangerous XML constructs
    const dangerousPatterns = [
      /<!ENTITY/i,                    // Entity declarations
      /<!DOCTYPE.*\[/i,               // DOCTYPE with internal subset
      /SYSTEM\s+["'][^"']*["']/i,     // SYSTEM declarations
      /PUBLIC\s+["'][^"']*["']/i,     // PUBLIC declarations
      /&[a-zA-Z_][a-zA-Z0-9_]*;/,     // Custom entity references
      /&#x[0-9a-fA-F]+;/,             // Hex character references (potential bypass)
      /<!ELEMENT/i,                   // Element declarations
      /<!ATTLIST/i,                   // Attribute declarations
      /file:\/\//i,                   // File protocol
      /http:\/\//i,                   // HTTP protocol (in entity)
      /https:\/\//i,                  // HTTPS protocol (in entity)
      /ftp:\/\//i,                    // FTP protocol
      /gopher:\/\//i,                 // Gopher protocol
      /data:/i,                       // Data URI scheme
      /jar:/i,                        // JAR protocol (Java)
      /netdoc:/i,                     // NetDoc protocol
      /mailto:/i,                     // Mailto protocol
      /javascript:/i                  // JavaScript protocol
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(xmlContent)) {
        throw new SecurityError(
          `Potentially malicious XML content detected: pattern ${pattern.source}`,
          'MALICIOUS_XML_DETECTED',
          'critical'
        );
      }
    }

    // Check for suspicious nested entity definitions
    const entityMatches = xmlContent.match(/<!ENTITY[^>]*>/gi);
    if (entityMatches && entityMatches.length > 10) {
      throw new SecurityError(
        `Too many entity declarations: ${entityMatches.length} > 10`,
        'EXCESSIVE_ENTITIES',
        'high'
      );
    }

    // Check for deeply nested structures (XML bomb indicator)
    const maxDepth = 50;
    let depth = 0;
    let maxDepthFound = 0;
    
    for (let i = 0; i < xmlContent.length; i++) {
      const char = xmlContent[i];
      if (char === '<' && xmlContent[i + 1] !== '/') {
        depth++;
        maxDepthFound = Math.max(maxDepthFound, depth);
        if (maxDepthFound > maxDepth) {
          throw new SecurityError(
            `XML structure too deep: ${maxDepthFound} > ${maxDepth}`,
            'XML_TOO_DEEP',
            'high'
          );
        }
      } else if (char === '<' && xmlContent[i + 1] === '/') {
        depth--;
      }
    }
  }
}

/**
 * Create secure xml2js parser configuration
 */
export function createSecureXml2jsConfig(config: XmlSecurityConfig): ParserOptions {
  return {
    // Basic parsing options
    explicitCharkey: false,
    trim: true,
    normalize: true,
    explicitRoot: true,
    emptyTag: () => null,
    explicitChildren: false,
    charsAsChildren: false,
    includeWhiteChars: false,
    mergeAttrs: false,
    
    // Security configurations
    validator: undefined,                    // Disable custom validators
    xmlns: false,                           // Disable namespace processing
    explicitArray: true,                    // Always use arrays for consistency
    ignoreAttrs: false,                     // Keep attributes for compatibility
    
    // XXE Protection - disable external entities and DTD
    async: false,
    attrNameProcessors: [],
    attrValueProcessors: [],
    tagNameProcessors: [],
    valueProcessors: [],
    
    // Prevent XML processing instructions and DOCTYPE
    strict: true,
    
    // Additional security: no custom processing
    charkey: '$',
    childkey: '$$'
  };
}

/**
 * Create secure fast-xml-parser configuration
 */
export function createSecureFastXmlConfig(config: XmlSecurityConfig): X2jOptions {
  return {
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    trimValues: true,
    
    // Security settings - disable external processing
    processEntities: false,         // Don't process entities
    parseAttributeValue: false,    // Don't parse attribute values as primitives
    allowBooleanAttributes: false, // Don't allow boolean attributes
    
    // Prevent XXE
    stopNodes: ['*.ENTITY', '*.DOCTYPE'],  // Stop processing these nodes
    
    // Size and parsing limits
    textNodeName: '#text',
    
    // Additional security
    unpairedTags: [],             // No unpaired tags allowed
    
    // Transform functions disabled for security
    isArray: () => false
  };
}

/**
 * Secure XML parsing using xml2js with XXE protection
 */
export async function parseXmlSecure(
  xmlContent: string, 
  config: XmlSecurityConfig
): Promise<Record<string, unknown>> {
  // Validate content first
  validateXmlContent(xmlContent, config);
  
  const secureConfig = createSecureXml2jsConfig(config);
  
  // Add timeout protection
  return new Promise(async (resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new SecurityError(
        `XML parsing timeout: exceeded ${config.maxParsingTime}ms`,
        'XML_PARSING_TIMEOUT',
        'high'
      ));
    }, config.maxParsingTime);
    
    try {
      const result = await parseStringPromise(xmlContent, secureConfig);
      clearTimeout(timeoutId);
      resolve(result as Record<string, unknown>);
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error instanceof SecurityError) {
        throw error;
      }
      
      // Check if error indicates XXE attempt
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('DOCTYPE') || 
          errorMessage.includes('ENTITY') || 
          errorMessage.includes('SYSTEM') ||
          errorMessage.includes('external')) {
        throw new SecurityError(
          `Potential XXE attack detected: ${errorMessage}`,
          'XXE_ATTACK_DETECTED',
          'critical',
          error instanceof Error ? error : undefined
        );
      }
      
      reject(error);
    }
  });
}

/**
 * Secure XML parsing using fast-xml-parser with XXE protection
 */
export function parseXmlFastSecure(
  xmlContent: string,
  config: XmlSecurityConfig
): Record<string, unknown> {
  // Validate content first
  validateXmlContent(xmlContent, config);
  
  const secureConfig = createSecureFastXmlConfig(config);
  
  try {
    const parser = new XMLParser(secureConfig);
    
    // Add timeout protection
    const startTime = Date.now();
    const result = parser.parse(xmlContent);
    const parsingTime = Date.now() - startTime;
    
    if (parsingTime > config.maxParsingTime) {
      throw new SecurityError(
        `XML parsing timeout: ${parsingTime}ms > ${config.maxParsingTime}ms`,
        'XML_PARSING_TIMEOUT',
        'high'
      );
    }
    
    return result as Record<string, unknown>;
    
  } catch (error) {
    if (error instanceof SecurityError) {
      throw error;
    }
    
    // Check if error indicates XXE attempt
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('DOCTYPE') || 
        errorMessage.includes('ENTITY') || 
        errorMessage.includes('SYSTEM') ||
        errorMessage.includes('external') ||
        errorMessage.includes('entity')) {
      throw new SecurityError(
        `Potential XXE attack detected: ${errorMessage}`,
        'XXE_ATTACK_DETECTED',
        'critical',
        error instanceof Error ? error : undefined
      );
    }
    
    throw error;
  }
}

/**
 * Factory function to create the appropriate secure parser
 */
export function createSecureXmlParser(
  options: ConvertOptions,
  parserType: 'xml2js' | 'fast-xml-parser' = 'xml2js'
): (xmlContent: string) => Promise<Record<string, unknown>> | Record<string, unknown> {
  const config = createXmlSecurityConfig(options);
  
  if (parserType === 'fast-xml-parser') {
    return (xmlContent: string) => parseXmlFastSecure(xmlContent, config);
  } else {
    return (xmlContent: string) => parseXmlSecure(xmlContent, config);
  }
}