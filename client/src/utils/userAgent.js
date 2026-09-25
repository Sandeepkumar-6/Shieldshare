// Readable device labels for the sessions list. Best effort: unknown agents are shown as-is.
const BROWSERS = [
  [/Edg\//, 'Edge'],
  [/OPR\//, 'Opera'],
  [/Firefox\//, 'Firefox'],
  [/Chrome\//, 'Chrome'],
  [/Version\/[\d.]+.*Safari\//, 'Safari'],
  [/^node|undici/i, 'Node.js client'],
  [/^curl\//, 'curl'],
];

const SYSTEMS = [
  [/Windows NT/, 'Windows'],
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/Android/, 'Android'],
  [/CrOS/, 'ChromeOS'],
  [/Linux/, 'Linux'],
];

export function describeUserAgent(userAgent) {
  if (!userAgent) return 'Unknown device';
  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1];
  const system = SYSTEMS.find(([pattern]) => pattern.test(userAgent))?.[1];
  if (browser && system) return `${browser} on ${system}`;
  if (browser) return browser;
  if (system) return `Browser on ${system}`;
  return userAgent.length > 60 ? `${userAgent.slice(0, 57)}…` : userAgent;
}
