import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
});

async function fetchXml(url: string): Promise<any | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const text = await res.text();
    return parser.parse(text);
  } catch {
    return null;
  }
}

export async function fetchSitemapUrls(originUrl: string): Promise<string[]> {
  const urls: string[] = [];
  try {
    const origin = new URL(originUrl).origin;
    const sitemapCandidates = [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];

    for (const sitemapUrl of sitemapCandidates) {
      const parsed = await fetchXml(sitemapUrl);
      if (!parsed) continue;

      // Handle sitemapindex
      if (parsed.sitemapindex && parsed.sitemapindex.sitemap) {
        const sitemaps = Array.isArray(parsed.sitemapindex.sitemap)
          ? parsed.sitemapindex.sitemap
          : [parsed.sitemapindex.sitemap];

        for (const sm of sitemaps.slice(0, 5)) { // process up to 5 sub-sitemaps
          const loc = sm?.loc;
          if (typeof loc === 'string') {
            const subParsed = await fetchXml(loc);
            if (subParsed?.urlset?.url) {
              const urlEntries = Array.isArray(subParsed.urlset.url)
                ? subParsed.urlset.url
                : [subParsed.urlset.url];
              for (const entry of urlEntries) {
                if (entry?.loc && typeof entry.loc === 'string') {
                  urls.push(entry.loc);
                }
              }
            }
          }
        }
      }

      // Handle direct urlset
      if (parsed.urlset && parsed.urlset.url) {
        const urlEntries = Array.isArray(parsed.urlset.url)
          ? parsed.urlset.url
          : [parsed.urlset.url];
        for (const entry of urlEntries) {
          if (entry?.loc && typeof entry.loc === 'string') {
            urls.push(entry.loc);
          }
        }
      }

      if (urls.length > 0) break;
    }
  } catch {
    // degrade gracefully
  }

  return Array.from(new Set(urls));
}
