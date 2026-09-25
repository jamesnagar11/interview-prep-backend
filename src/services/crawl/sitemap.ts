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

function extractUrlsFromParsed(parsed: any): string[] {
  const urls: string[] = [];
  if (parsed?.urlset?.url) {
    const urlEntries = Array.isArray(parsed.urlset.url) ? parsed.urlset.url : [parsed.urlset.url];
    for (const entry of urlEntries) {
      if (entry?.loc && typeof entry.loc === 'string') urls.push(entry.loc);
    }
  }
  return urls;
}

export async function fetchSitemapUrls(originUrl: string): Promise<string[]> {
  try {
    const origin = new URL(originUrl).origin;

    // Fetch both sitemap candidates in parallel
    const [parsed1, parsed2] = await Promise.all([
      fetchXml(`${origin}/sitemap.xml`),
      fetchXml(`${origin}/sitemap_index.xml`),
    ]);

    const allUrls: string[] = [];

    for (const parsed of [parsed1, parsed2]) {
      if (!parsed) continue;

      // Handle sitemapindex — fetch sub-sitemaps in parallel
      if (parsed.sitemapindex && parsed.sitemapindex.sitemap) {
        const sitemaps = Array.isArray(parsed.sitemapindex.sitemap)
          ? parsed.sitemapindex.sitemap
          : [parsed.sitemapindex.sitemap];

        const subLocs = sitemaps.slice(0, 5)
          .map((sm: any) => sm?.loc)
          .filter((loc: any): loc is string => typeof loc === 'string');

        const subParseds = await Promise.all(subLocs.map((loc: string) => fetchXml(loc)));
        for (const sub of subParseds) {
          allUrls.push(...extractUrlsFromParsed(sub));
        }
      }

      // Handle direct urlset
      allUrls.push(...extractUrlsFromParsed(parsed));

      if (allUrls.length > 0) break;
    }

    return Array.from(new Set(allUrls));
  } catch {
    return [];
  }
}
