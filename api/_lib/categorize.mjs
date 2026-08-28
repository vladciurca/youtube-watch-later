export const CATEGORIES = [
  "tech",
  "health",
  "dating",
  "trailers",
  "travel",
  "other",
];

export const CATEGORY_LABELS = {
  tech: "Tech / Business",
  health: "Health / longevity",
  dating: "Dating / relationships",
  trailers: "Trailers",
  travel: "Travel / packing",
  other: "Other",
};

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

const HEALTH_KEYWORD_RES = [
  /\bsaunas?\b/i,
  /\bbanya\b/i,
  /\bcold plunge\b/i,
  /\blongevity\b/i,
  /\bworkouts?\b/i,
  /\bposture\b/i,
  /\bdiet\b/i,
  /\bfasting\b/i,
  /\btestosterone\b/i,
  /\bvo2(?:\s*max)?\b/i,
  /\bciradian\b/i,
  /\bsupplements?\b/i,
  /\brapamycin\b/i,
  /\bnmns?\b/i,
  /\bmetformin\b/i,
  /\bpsyllium\b/i,
  /\bpeptides?\b/i,
  /\bstem cells?\b/i,
  /\boral health\b/i,
  /\bhealth protocol\b/i,
  /\bhow i fixed my terrible sleep\b/i,
  /\bterrible sleep\b/i,
  /\bsleep habits?\b/i,
  /\bzone 2\b/i,
  /\bmuscle mass\b/i,
  /\bwim hof\b/i,
  /\blow calorie\b/i,
  /\bprotein ice cream\b/i,
  /\beat like\b/i,
  /\bgym membership\b/i,
  /\bpeter attia\b/i,
  /\banti[-\s]aging\b/i,
];

const DATING_KEYWORD_RES = [
  /\bdivorce\b/i,
  /\bdatings?\b/i,
  /\battract(?:ion|ive)\b/i,
  /\bmasculinity\b/i,
  /\bmasculine\b/i,
  /\brelationships?\b/i,
  /\bprenups?\b/i,
  /\bmanosphere\b/i,
  /\bromance\b/i,
  /\bmarriage\b/i,
  /\bdating rules\b/i,
  /\bwomen really want\b/i,
  /\btoxic men\b/i,
  /\bmodern dating\b/i,
  /\borion taraban\b/i,
];

const TRAILER_KEYWORD_RES = [
  /\bofficial trailer\b/i,
  /\bofficial teaser\b/i,
  /\btrailer oficial\b/i,
  /\bdocumentary trailer\b/i,
  /\b\|\s*official trailer\b/i,
  /\bnext on netflix\b/i,
];

const TRAVEL_KEYWORD_RES = [
  /\bpack hacker\b/i,
  /\bbackpacks?\b/i,
  /\bpackable\b/i,
  /\bpacking lists?\b/i,
  /\bhow to pack\b/i,
  /\bdon'?t pack\b/i,
  /\bone[-\s]?bag\b/i,
  /\bhotels?\b/i,
  /\btravel gadgets?\b/i,
  /\bminimalist travel\b/i,
  /\btravel(?:ers?)? don'?t pack\b/i,
  /\bpeople travel\b/i,
  /\btravel setup\b/i,
];

const CHANNELS = {
  health: [
    "bryan johnson",
    "peter attia md",
    "andrew huberman",
    "wim hof",
    "men's health",
    "novos labs",
    "dr. livingood",
    "dr. eric berg dc",
    "jeremy ethier",
    "tone and tighten",
  ],
  dating: ["orion taraban"],
  trailers: ["apple tv", "lionsgate movies"],
  travel: ["pack hacker", "away together w/ nik and allie"],
};

const CHANNEL_SETS = Object.fromEntries(
  Object.entries(CHANNELS).map(([key, names]) => [key, new Set(names)]),
);

export function normalizeAuthor(author) {
  return String(author || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function haystack(title, author) {
  return `${title || ""} ${author || ""}`;
}

function matchesAny(res, text) {
  return res.some((re) => re.test(text));
}

function authorInSet(author, set) {
  if (!set || set.size === 0) return false;
  return set.has(normalizeAuthor(author));
}

export function majorityChannelsByCategory(videos) {
  const stats = new Map();
  for (const video of videos || []) {
    const author = normalizeAuthor(video?.author);
    if (!author) continue;
    const rec = stats.get(author) || { total: 0, counts: Object.create(null) };
    rec.total += 1;
    const category = existingCategory(video);
    rec.counts[category] = (rec.counts[category] || 0) + 1;
    stats.set(author, rec);
  }

  const byCategory = {
    tech: new Set(),
    health: new Set(),
    dating: new Set(),
    trailers: new Set(),
    travel: new Set(),
  };
  for (const [author, rec] of stats) {
    let best = null;
    let bestCount = 0;
    for (const key of Object.keys(byCategory)) {
      const n = rec.counts[key] || 0;
      if (n > bestCount) {
        best = key;
        bestCount = n;
      }
    }
    if (best && bestCount > rec.total / 2) byCategory[best].add(author);
  }
  return byCategory;
}

/** @deprecated use majorityChannelsByCategory().tech */
export function majorityTechChannels(videos) {
  return majorityChannelsByCategory(videos).tech;
}

export function matchesTechKeywords(title, author) {
  return matchesAny(TECH_KEYWORD_RES, haystack(title, author));
}

export function classifyTechBusiness({ title, author }, channels) {
  if (authorInSet(author, channels)) return true;
  if (matchesTechKeywords(title, author)) return true;
  return false;
}

export function resolveTechBusiness(previous, scraped, channels) {
  if (typeof previous?.techBusiness === "boolean") {
    return previous.techBusiness;
  }
  return classifyTechBusiness(scraped, channels);
}

export function existingCategory(video) {
  if (video?.techBusiness === true) return "tech";
  if (CATEGORIES.includes(video?.category)) return video.category;
  if (video?.techBusiness === false) return "other";
  return null;
}

function classifyFromText(title, author, channelMaps, allowTech) {
  const text = haystack(title, author);
  const maps = channelMaps || {};

  if (
    authorInSet(author, CHANNEL_SETS.trailers) ||
    authorInSet(author, maps.trailers) ||
    matchesAny(TRAILER_KEYWORD_RES, text)
  ) {
    return "trailers";
  }

  if (
    (/\bnaval\b/i.test(text) && /\blove\b/i.test(text)) ||
    authorInSet(author, CHANNEL_SETS.dating) ||
    authorInSet(author, maps.dating) ||
    matchesAny(DATING_KEYWORD_RES, text)
  ) {
    return "dating";
  }

  if (
    authorInSet(author, CHANNEL_SETS.travel) ||
    authorInSet(author, maps.travel) ||
    matchesAny(TRAVEL_KEYWORD_RES, text)
  ) {
    return "travel";
  }

  if (
    authorInSet(author, CHANNEL_SETS.health) ||
    authorInSet(author, maps.health) ||
    matchesAny(HEALTH_KEYWORD_RES, text)
  ) {
    return "health";
  }

  if (allowTech && (authorInSet(author, maps.tech) || matchesTechKeywords(title, author))) {
    return "tech";
  }

  return "other";
}

export function classifyCategory({ title, author }, options = {}) {
  const allowTech = options.allowTech !== false;
  return classifyFromText(title, author, options.channelMaps, allowTech);
}

export function resolveCategory(previous, scraped, channelMaps) {
  if (previous?.techBusiness === true || previous?.category === "tech") {
    return "tech";
  }
  const allowTech = previous?.techBusiness !== false && previous?.category !== "other";
  return classifyFromText(
    scraped?.title,
    scraped?.author,
    channelMaps,
    allowTech,
  );
}

export function categoryForSeedVideo(video) {
  if (video?.techBusiness === true) return "tech";
  return classifyFromText(video?.title, video?.author, null, false);
}
