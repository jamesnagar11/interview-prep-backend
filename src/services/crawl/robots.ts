import robotsParser from 'robots-parser';

const robotsCache = new Map<string, ReturnType<typeof robotsParser>>();

export async function getRobotsChecker(originUrl: string) {
  try {
    const origin = new URL(originUrl).origin;
    if (robotsCache.has(origin)) {
      return robotsCache.get(origin)!;
    }

    const robotsTxtUrl = `${origin}/robots.txt`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(robotsTxtUrl, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) {
      // Allow all if robots.txt is missing/error
      const allowAll = robotsParser(robotsTxtUrl, 'User-agent: *\nAllow: /');
      robotsCache.set(origin, allowAll);
      return allowAll;
    }

    const text = await res.text();
    const parsed = robotsParser(robotsTxtUrl, text);
    robotsCache.set(origin, parsed);
    return parsed;
  } catch {
    const origin = new URL(originUrl).origin;
    const allowAll = robotsParser(`${origin}/robots.txt`, 'User-agent: *\nAllow: /');
    robotsCache.set(origin, allowAll);
    return allowAll;
  }
}

export async function isAllowedByRobots(url: string): Promise<boolean> {
  try {
    const checker = await getRobotsChecker(url);
    const allowed = checker.isAllowed(url, 'Mozilla/5.0');
    return allowed !== false;
  } catch {
    return true;
  }
}
