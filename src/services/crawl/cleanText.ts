import * as cheerio from 'cheerio';

export function cleanHtmlToText(html: string, maxChars: number = 3000): string {
  const $ = cheerio.load(html);

  // Remove irrelevant elements
  $('script, style, nav, footer, header, svg, iframe, noscript').remove();

  // Extract text content
  const text = $('body').text() || $.text();

  // Clean whitespace
  const cleaned = text
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length <= maxChars) {
    return cleaned;
  }

  return cleaned.slice(0, maxChars);
}

export function extractSameOriginLinks(html: string, baseUrl: string): { url: string; anchorText: string }[] {
  const links: { url: string; anchorText: string }[] = [];
  try {
    const origin = new URL(baseUrl).origin;
    const $ = cheerio.load(html);

    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      const text = $(el).text().trim();
      if (!href) return;

      try {
        const fullUrl = new URL(href, baseUrl);
        const cleanUrl = fullUrl.href.split('#')[0];
        if (fullUrl.origin === origin && cleanUrl) {
          links.push({ url: cleanUrl, anchorText: text });
        }
      } catch {
        // ignore malformed URLs
      }
    });
  } catch {
    // degrade gracefully
  }

  return links;
}
