const TECH_KEYWORD_RES = [
  /\ba\.?i\b/i,
  /\bllms?\b/i,
  /\bgpt(?:-?\d)?\b/i,
  /\bopenai\b/i,
  /\banthropic\b/i,
  /\bchatgpt\b/i,
  /\bmachine learning\b/i,
  /\bdeep learning\b/i,
  /\bstart[-\s]?ups?\b/i,
  /\bfounders?\b/i,
  /\bentrepreneurs?(?:ship)?\b/i,
  /\bsaas\b/i,
  /\by combinator\b/i,
  /\byc\b/i,
  /\bventure capitals?\b/i,
  /\bvcs?\b/i,
  /\binvest(?:ing|or|ors|ment|ments)?\b/i,
  /\bsilicon valley\b/i,
  /\bfundrais(?:e|ing)\b/i,
  /\bseries [a-c]\b/i,
  /\bproduct[-\s]market fit\b/i,
  /\bb2b\b/i,
];

export function normalizeAuthor(author) {
  return String(author || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function majorityTechChannels(videos) {
  const stats = new Map();
  for (const video of videos || []) {
    const author = normalizeAuthor(video?.author);
    if (!author) continue;
    const rec = stats.get(author) || { total: 0, tech: 0 };
    rec.total += 1;
    if (video.techBusiness === true) rec.tech += 1;
    stats.set(author, rec);
  }

  const channels = new Set();
  for (const [author, rec] of stats) {
    if (rec.tech > rec.total / 2) channels.add(author);
  }
  return channels;
}

export function matchesTechKeywords(title, author) {
  const hay = `${title || ""} ${author || ""}`;
  return TECH_KEYWORD_RES.some((re) => re.test(hay));
}

export function classifyTechBusiness({ title, author }, channels) {
  if (channels?.has(normalizeAuthor(author))) return true;
  if (matchesTechKeywords(title, author)) return true;
  return false;
}

export function resolveTechBusiness(previous, scraped, channels) {
  if (typeof previous?.techBusiness === "boolean") {
    return previous.techBusiness;
  }
  return classifyTechBusiness(scraped, channels);
}
