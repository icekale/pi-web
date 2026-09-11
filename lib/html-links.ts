const HTML_LINK_PATTERN = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
const HTML_TAG_PATTERN = /<[^>]+>/g;

export function replaceLinksWithMarkdown(html: string): string {
  return html.replace(HTML_LINK_PATTERN, (_match, doubleQuoteHref, singleQuoteHref, unquotedHref, label) => {
    const href = String(doubleQuoteHref ?? singleQuoteHref ?? unquotedHref ?? "").trim();
    const text = String(label ?? "").replace(HTML_TAG_PATTERN, "").trim();
    if (!href || !text) return text || href;
    return `[${text}](${href})`;
  }).replace(HTML_TAG_PATTERN, "");
}
