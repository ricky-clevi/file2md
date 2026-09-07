import sax from 'sax';
import { checkResources } from './resource-monitor.js';
import { SecurityError } from '../types/errors.js';
import type { ConvertOptions } from '../types/interfaces.js';

export interface XmlSecurityConfig {
  readonly enableXXEProtection: boolean;
  readonly maxXmlSize: number;
  readonly maxParsingTime: number;
  readonly allowExternalEntities: boolean;
  readonly allowDTD: boolean;
}

export const DEFAULT_XML_SECURITY_CONFIG: XmlSecurityConfig = {
  enableXXEProtection: true,
  maxXmlSize: 10 * 1024 * 1024,
  maxParsingTime: 30000,
  allowExternalEntities: false,
  allowDTD: false
};

export function createXmlSecurityConfig(
  options: ConvertOptions
): XmlSecurityConfig {
  return {
    ...DEFAULT_XML_SECURITY_CONFIG,
    enableXXEProtection: options.enableXXEProtection !== false,
    maxXmlSize:
      options.maxIndividualFileSize ?? DEFAULT_XML_SECURITY_CONFIG.maxXmlSize,
    maxParsingTime:
      options.timeout ?? DEFAULT_XML_SECURITY_CONFIG.maxParsingTime
  };
}

/** Ordered XML tree. Text is kept separately from attributes, including mixed content. */
export interface XmlNode {
  name: string;
  attributes: Record<string, string>;
  children: (XmlNode | string)[];
}

function parseTree(xml: string, config: XmlSecurityConfig): XmlNode {
  const size = Buffer.byteLength(xml, 'utf8');
  if (size > config.maxXmlSize) {
    throw new SecurityError(
      'XML content exceeds the size limit',
      'XML_SIZE_LIMIT_EXCEEDED'
    );
  }
  const start = Date.now();
  const parser = sax.parser(true, { trim: false, normalize: false });
  const stack: XmlNode[] = [];
  let root: XmlNode | undefined;
  parser.ondoctype = () => {
    // These document formats do not require DTDs. Never resolve external entities,
    // even when callers disable optional validation.
    throw new SecurityError(
      'DTD declarations are not allowed',
      'MALICIOUS_XML_DETECTED',
      'critical'
    );
  };
  parser.onopentag = (tag) => {
    if (stack.length >= 128) {
      throw new SecurityError('XML nesting exceeds 128 levels', 'XML_TOO_DEEP');
    }
    const node: XmlNode = {
      name: tag.name,
      attributes: Object.create(null),
      children: []
    };
    for (const [key, value] of Object.entries(tag.attributes)) {
      node.attributes[key] = typeof value === 'string' ? value : value.value;
    }
    if (stack.length) stack[stack.length - 1].children.push(node);
    else if (root) throw new Error('Multiple XML roots');
    else root = node;
    stack.push(node);
  };
  parser.onclosetag = () => {
    stack.pop();
  };
  const addText = (text: string) => {
    if (stack.length) stack[stack.length - 1].children.push(text);
  };
  parser.ontext = addText;
  parser.oncdata = addText;
  // Chunking bounds the interval between deadline checks, including large text nodes.
  for (let offset = 0; offset < xml.length; offset += 16384) {
    if (Date.now() - start > config.maxParsingTime) {
      throw new SecurityError(
        'XML parsing deadline exceeded',
        'XML_PARSING_TIMEOUT'
      );
    }
    checkResources();
    parser.write(xml.slice(offset, offset + 16384));
  }
  parser.close();
  if (!root) throw new Error('Missing XML root');
  return root;
}

export function validateXmlContent(
  xml: string,
  config: XmlSecurityConfig
): void {
  parseTree(xml, config);
}

export function parseXmlTree(
  xml: string,
  options: ConvertOptions = {}
): XmlNode {
  return parseTree(xml, createXmlSecurityConfig(options));
}

/** Compatibility adapter for the public xml2js-shaped result. */
export async function parseXmlSecure(
  xml: string,
  config: XmlSecurityConfig
): Promise<Record<string, unknown>> {
  const root = parseTree(xml, config);
  function convert(node: XmlNode): unknown {
    const output: Record<string, unknown> = Object.create(null);
    if (Object.keys(node.attributes).length) output['$'] = node.attributes;
    let text = '';
    for (const child of node.children) {
      if (typeof child === 'string') text += child;
      else {
        const items = (output[child.name] ??= []) as unknown[];
        items.push(convert(child));
      }
    }
    if (!Object.keys(output).length) return text;
    if (text.trim()) output['_'] = text;
    return output;
  }
  return { [root.name]: convert(root) };
}

/** Compatibility adapter for the public fast-xml-parser-shaped result. */
export function parseXmlFastSecure(
  xml: string,
  config: XmlSecurityConfig
): Record<string, unknown> {
  const root = parseTree(xml, config);
  function convert(node: XmlNode): unknown {
    const output: Record<string, unknown> = Object.create(null);
    for (const [key, value] of Object.entries(node.attributes))
      output[`@_${key}`] = value;
    let text = '';
    for (const child of node.children) {
      if (typeof child === 'string') text += child;
      else {
        const value = convert(child);
        if (!(child.name in output)) output[child.name] = value;
        else if (Array.isArray(output[child.name]))
          (output[child.name] as unknown[]).push(value);
        else output[child.name] = [output[child.name], value];
      }
    }
    if (!Object.keys(output).length) return text.trim();
    if (text.trim()) output['#text'] = text.trim();
    return output;
  }
  return { [root.name]: convert(root) };
}

export function createSecureXmlParser(
  options: ConvertOptions,
  parserType: 'xml2js' | 'fast-xml-parser' = 'xml2js'
) {
  const config = createXmlSecurityConfig(options);
  return (xml: string) =>
    parserType === 'xml2js'
      ? parseXmlSecure(xml, config)
      : parseXmlFastSecure(xml, config);
}
