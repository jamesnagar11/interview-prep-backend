export interface CandidateUrl {
  url: string;
  anchorText?: string;
}

export const HARDCODED_PATHS = {
  about: ['/about', '/about-us', '/company', '/team', '/culture', '/mission'],
  hiring: [
    '/careers',
    '/jobs',
    '/careers/jobs',
    '/join-us',
    '/work-with-us',
    '/hiring',
    '/interview-process',
    '/careers/interview-process',
    '/handbook',
    '/blog/careers',
    '/engineering-blog',
  ],
};

const ABOUT_TERMS = ['about', 'company', 'team', 'culture', 'mission', 'who-we-are', 'story', 'our-team'];
const HIRING_TERMS = ['careers', 'jobs', 'join', 'hiring', 'interview', 'work-with-us', 'handbook', 'culture', 'roles', 'openings'];

export function scoreCandidate(candidate: CandidateUrl, terms: string[]): number {
  let score = 0;
  const urlLower = candidate.url.toLowerCase();
  const textLower = (candidate.anchorText || '').toLowerCase();

  for (const term of terms) {
    if (urlLower.includes(term)) score += 3;
    if (textLower.includes(term)) score += 2;
  }

  return score;
}

export function buildAndScoreCandidateList(
  originUrl: string,
  sitemapUrls: string[],
  homepageLinks: CandidateUrl[]
): { aboutUrls: string[]; hiringUrls: string[] } {
  let origin = originUrl;
  try {
    origin = new URL(originUrl).origin;
  } catch {
    // fallback
  }

  const hardcodedCandidates: CandidateUrl[] = [
    ...HARDCODED_PATHS.about.map((p) => ({ url: `${origin}${p}` })),
    ...HARDCODED_PATHS.hiring.map((p) => ({ url: `${origin}${p}` })),
  ];

  const allCandidatesMap = new Map<string, CandidateUrl>();

  const addCandidate = (c: CandidateUrl) => {
    try {
      const parsed = new URL(c.url, origin);
      if (parsed.origin !== new URL(origin).origin) return; // same-origin check
      const cleanUrl = parsed.href.split('#')[0]; // strip hash
      if (cleanUrl && !allCandidatesMap.has(cleanUrl)) {
        allCandidatesMap.set(cleanUrl, { ...c, url: cleanUrl });
      }
    } catch {
      // ignore invalid
    }
  };

  hardcodedCandidates.forEach(addCandidate);
  sitemapUrls.forEach((url) => addCandidate({ url }));
  homepageLinks.forEach(addCandidate);

  const candidates = Array.from(allCandidatesMap.values());

  const aboutScored = candidates
    .map((c) => ({ url: c.url, score: scoreCandidate(c, ABOUT_TERMS) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);

  const hiringScored = candidates
    .map((c) => ({ url: c.url, score: scoreCandidate(c, HIRING_TERMS) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);

  // Take top 3 "about" + top 5 "hiring"
  const aboutUrls = aboutScored.slice(0, 3).map((c) => c.url);
  const hiringUrls = hiringScored.slice(0, 5).map((c) => c.url);

  return { aboutUrls, hiringUrls };
}
