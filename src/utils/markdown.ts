/** Escape document text, leaving generated Markdown under our control. */
export function escapeMarkdown(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([\\`*_[\]~])/g, '\\$1')
    .replace(/^(\s*)([>#]|[-+]\s|\d+[.)]\s)/gm, '$1\\$2');
}
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
export function markdownUrl(value: string): string {
  return value
    .split(/[\\/]/)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}
export function safeLink(value: string): string | undefined {
  try {
    const url = new URL(value);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol)
      ? url.href.replace(/[()]/g, (c) => encodeURIComponent(c))
      : undefined;
  } catch {
    return undefined;
  }
}
