import { isAllowedByRobots } from './robots';
import { cleanHtmlToText } from './cleanText';

export interface FetchResult {
  url: string;
  ok: boolean;
  text?: string;
  reason?: string;
}

const MAX_SIZE_BYTES = 2 * 1024 * 1024; // 2MB

export async function fetchSinglePage(
  url: string,
  retriesLeft = 2
): Promise<FetchResult> {
  const allowed = await isAllowedByRobots(url);
  if (!allowed) {
    return { url, ok: false, reason: 'robots_disallowed' };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000); // 7s timeout

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AI-Interview-Prep/1.0',
        Accept: 'text/html,application/xhtml+xml',
      },
    });

    clearTimeout(timer);

    if (res.status === 404 || res.status === 403) {
      return { url, ok: false, reason: `HTTP_${res.status}` };
    }

    if (!res.ok) {
      if (retriesLeft > 0 && res.status >= 500) {
        await new Promise((r) => setTimeout(r, 1000 * (3 - retriesLeft)));
        return fetchSinglePage(url, retriesLeft - 1);
      }
      return { url, ok: false, reason: `HTTP_${res.status}` };
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain') && contentType !== '') {
      return { url, ok: false, reason: 'non_html_content_type' };
    }

    const contentLength = res.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_SIZE_BYTES) {
      return { url, ok: false, reason: 'exceeds_size_limit' };
    }

    const html = await res.text();
    if (html.length > MAX_SIZE_BYTES * 2) {
      return { url, ok: false, reason: 'exceeds_size_limit' };
    }

    const cleaned = cleanHtmlToText(html, 3000);
    return { url, ok: true, text: cleaned };
  } catch (err: any) {
    if (retriesLeft > 0) {
      await new Promise((r) => setTimeout(r, 1000 * (3 - retriesLeft)));
      return fetchSinglePage(url, retriesLeft - 1);
    }
    return { url, ok: false, reason: err.name === 'AbortError' ? 'timeout' : err.message || 'fetch_error' };
  }
}

// Concurrency runner helper (concurrency cap 2-3)
export async function fetchBatchWithConcurrency(
  urls: string[],
  concurrencyLimit = 3
): Promise<FetchResult[]> {
  const results: FetchResult[] = [];
  const queue = [...urls];

  async function worker() {
    while (queue.length > 0) {
      const url = queue.shift();
      if (!url) break;
      const res = await fetchSinglePage(url);
      results.push(res);
    }
  }

  const workers = Array.from({ length: Math.min(concurrencyLimit, urls.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
