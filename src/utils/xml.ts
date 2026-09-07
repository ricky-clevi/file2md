import path from 'node:path';
import { parseXmlTree, type XmlNode } from './secure-xml-parser.js';
import { PathTraversalError } from '../types/errors.js';
import type { ConvertOptions } from '../types/interfaces.js';
import type { Archive } from './zip-security.js';

export type { XmlNode };
export const localName = (name: string): string =>
  name.slice(name.lastIndexOf(':') + 1);
export function children(node: XmlNode | undefined, name?: string): XmlNode[] {
  return (node?.children ?? []).filter(
    (c): c is XmlNode =>
      typeof c !== 'string' && (!name || localName(c.name) === name)
  );
}
export function child(
  node: XmlNode | undefined,
  name: string
): XmlNode | undefined {
  return children(node, name)[0];
}
export function descendants(
  node: XmlNode | undefined,
  name: string
): XmlNode[] {
  return children(node).flatMap((c) =>
    localName(c.name) === name ? [c] : descendants(c, name)
  );
}
export function text(node: XmlNode | undefined): string {
  return (
    node?.children.map((c) => (typeof c === 'string' ? c : text(c))).join('') ??
    ''
  );
}
export function attr(
  node: XmlNode | undefined,
  name: string
): string | undefined {
  if (!node) return undefined;
  return (
    node.attributes[name] ??
    Object.entries(node.attributes).find(
      ([key]) => localName(key) === name
    )?.[1]
  );
}
export async function readXml(
  archive: Archive,
  filename: string,
  options: ConvertOptions = {}
): Promise<XmlNode | undefined> {
  const file = archive.zip.file(filename);
  if (!file) return undefined;
  const data = await archive.extractor.extractFile(file, filename);
  return parseXmlTree(decodeXml(data), options);
}
export interface Relationship {
  target: string;
  type: string;
  external: boolean;
}
export async function relationships(
  archive: Archive,
  source: string,
  options: ConvertOptions = {}
): Promise<Map<string, Relationship>> {
  const filename = path.posix.join(
    path.posix.dirname(source),
    '_rels',
    `${path.posix.basename(source)}.rels`
  );
  const root = await readXml(archive, filename, options);
  const result = new Map<string, Relationship>();
  for (const rel of children(root, 'Relationship')) {
    const id = attr(rel, 'Id');
    const target = attr(rel, 'Target');
    if (!id || !target) continue;
    const external = attr(rel, 'TargetMode') === 'External';
    const decoded = external ? target : decodeURIComponent(target);
    const normalized = external
      ? target
      : path.posix.normalize(
          decoded.startsWith('/')
            ? decoded.slice(1)
            : path.posix.join(path.posix.dirname(source), decoded)
        );
    if (
      !external &&
      (normalized.startsWith('/') ||
        normalized.startsWith('../') ||
        normalized.includes('\\') ||
        normalized.includes('\0'))
    ) {
      throw new PathTraversalError(target);
    }
    result.set(id, {
      target: normalized,
      type: attr(rel, 'Type') ?? '',
      external
    });
  }
  return result;
}

/** XML documents may be UTF-8 or BOM-marked UTF-16. */
function decodeXml(data: Buffer): string {
  if (data[0] === 0xff && data[1] === 0xfe)
    return new TextDecoder('utf-16le', { fatal: true }).decode(data);
  if (data[0] === 0xfe && data[1] === 0xff)
    return new TextDecoder('utf-16be', { fatal: true }).decode(data);
  return new TextDecoder('utf-8', { fatal: true }).decode(data);
}
