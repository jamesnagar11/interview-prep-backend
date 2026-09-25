import type { ResearchBundle } from '../../types/kit';
import { fetchSitemapUrls } from './sitemap';
import { buildAndScoreCandidateList } from './candidates';
import { extractSameOriginLinks } from './cleanText';
import { fetchBatchWithConcurrency, fetchSinglePage } from './fetchPage';

export async function researchCompany(companyUrl: string): Promise<ResearchBundle> {
  const overallStart = Date.now();
  const getElapsed = () => `${((Date.now() - overallStart) / 1000).toFixed(2)}s`;

  console.log(`[researchCompany] 🚀 Starting research for target: "${companyUrl}"`);

  const emptyBundle: ResearchBundle = {
    pagesUsed: [],
    pagesSkipped: [],
    aboutText: null,
    hiringProcessText: null,
  };

  const executeResearch = async (): Promise<ResearchBundle> => {
    const pagesSkipped: { url: string; reason: string }[] = [];
    const pagesUsed: string[] = [];

    // 1. Validate URL
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(companyUrl);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        console.warn(`[researchCompany] ⚠️ Invalid URL protocol: "${companyUrl}" (elapsed: ${getElapsed()})`);
        pagesSkipped.push({ url: companyUrl, reason: 'invalid_url' });
        return { ...emptyBundle, pagesSkipped };
      }
    } catch {
      console.warn(`[researchCompany] ⚠️ Invalid URL format: "${companyUrl}" (elapsed: ${getElapsed()})`);
      pagesSkipped.push({ url: companyUrl, reason: 'invalid_url' });
      return { ...emptyBundle, pagesSkipped };
    }

    const origin = parsedUrl.origin;
    console.log(`[researchCompany] 🌐 Validated origin: ${origin} (elapsed: ${getElapsed()})`);

    // 2. Fetch homepage to verify reachability & extract links
    const homepageStart = Date.now();
    console.log(`[researchCompany] 🔍 Fetching homepage: ${origin}...`);
    const homepageResult = await fetchSinglePage(origin);
    const homepageDuration = ((Date.now() - homepageStart) / 1000).toFixed(2);

    if (!homepageResult.ok) {
      console.warn(
        `[researchCompany] ❌ Homepage unreachable: ${origin} (reason: ${homepageResult.reason || 'unreachable'}) [step took ${homepageDuration}s, total elapsed: ${getElapsed()}]`
      );
      pagesSkipped.push({ url: origin, reason: homepageResult.reason || 'unreachable' });
      return { ...emptyBundle, pagesSkipped };
    }

    pagesUsed.push(origin);
    const homepageLinks = homepageResult.text
      ? extractSameOriginLinks(homepageResult.text, origin)
      : [];
    console.log(
      `[researchCompany] ✅ Homepage fetched [took ${homepageDuration}s]. Extracted ${homepageLinks.length} same-origin links.`
    );

    // 4. Fetch sitemap URLs
    const sitemapStart = Date.now();
    console.log(`[researchCompany] 🗺️ Fetching sitemap for: ${origin}...`);
    const sitemapUrls = await fetchSitemapUrls(origin);
    const sitemapDuration = ((Date.now() - sitemapStart) / 1000).toFixed(2);
    console.log(`[researchCompany] 📍 Found ${sitemapUrls.length} sitemap URLs [took ${sitemapDuration}s].`);

    // 6 & 7. Build shortlist: top 3 about + top 5 hiring
    console.log(`[researchCompany] 📊 Scoring candidate links...`);
    const { aboutUrls, hiringUrls } = buildAndScoreCandidateList(
      origin,
      sitemapUrls,
      homepageLinks
    );

    console.log(
      `[researchCompany] 🎯 Candidates identified:`,
      `\n  • About URLs (${aboutUrls.length}): ${aboutUrls.join(', ') || 'none'}`,
      `\n  • Hiring URLs (${hiringUrls.length}): ${hiringUrls.join(', ') || 'none'}`
    );

    const targetUrls = Array.from(new Set([...aboutUrls, ...hiringUrls])).filter(
      (u) => u !== origin
    );
    console.log(`[researchCompany] 📥 Target shortlist to fetch (${targetUrls.length} unique URLs):`, targetUrls);

    // 8. Fetch shortlist concurrently
    const batchStart = Date.now();
    console.log(`[researchCompany] ⚡ Batch fetching shortlist with concurrency limit 5...`);
    const fetchResults = await fetchBatchWithConcurrency(targetUrls, 5);
    const batchDuration = ((Date.now() - batchStart) / 1000).toFixed(2);
    console.log(`[researchCompany] 🏁 Batch fetch completed [took ${batchDuration}s].`);

    const aboutTexts: string[] = [];
    const hiringTexts: string[] = [];

    for (const res of fetchResults) {
      if (res.ok && res.text) {
        pagesUsed.push(res.url);
        if (aboutUrls.includes(res.url)) {
          aboutTexts.push(res.text);
        }
        if (hiringUrls.includes(res.url)) {
          hiringTexts.push(res.text);
        }
        console.log(`[researchCompany]   ✔️ Successfully fetched: ${res.url} (${res.text.length} chars)`);
      } else {
        pagesSkipped.push({ url: res.url, reason: res.reason || 'failed' });
        console.warn(`[researchCompany]   ✖️ Failed to fetch: ${res.url} (reason: ${res.reason || 'failed'})`);
      }
    }

    // Also include homepage content in aboutTexts if aboutTexts is empty
    if (aboutTexts.length === 0 && homepageResult.text) {
      aboutTexts.push(homepageResult.text);
      console.log(`[researchCompany] ℹ️ No candidate about pages fetched; falling back to homepage text for aboutText.`);
    }

    const totalDuration = getElapsed();
    console.log(
      `[researchCompany] ✨ Research successfully finished in ${totalDuration}. Summary: ${pagesUsed.length} page(s) used, ${pagesSkipped.length} page(s) skipped.`
    );

    return {
      pagesUsed: Array.from(new Set(pagesUsed)),
      pagesSkipped,
      aboutText: aboutTexts.length > 0 ? aboutTexts.join('\n\n') : null,
      hiringProcessText: hiringTexts.length > 0 ? hiringTexts.join('\n\n') : null,
    };
  };

  // 11. Hard time cap: 25 seconds
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<ResearchBundle>((resolve) => {
    timeoutId = setTimeout(() => {
      console.warn(`[researchCompany] ⏰ Hard timeout reached (25s cap) for company: "${companyUrl}" (elapsed: ${getElapsed()})`);
      resolve({
        pagesUsed: [],
        pagesSkipped: [{ url: companyUrl, reason: 'research_timeout' }],
        aboutText: null,
        hiringProcessText: null,
      });
    }, 25000);
  });

  try {
    const result = await Promise.race([executeResearch(), timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch (err: any) {
    clearTimeout(timeoutId!);
    console.error(`[researchCompany] 💥 Unexpected error during research after ${getElapsed()}:`, err);
    return {
      ...emptyBundle,
      pagesSkipped: [{ url: companyUrl, reason: err.message || 'unexpected_error' }],
    };
  }
}

