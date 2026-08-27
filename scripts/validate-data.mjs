import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const STATUSES = [
  "Almost finished",
  "Partially watched",
  "Barely started",
  "Not started",
];
const CATEGORIES = ["tech", "health", "dating", "trailers", "travel", "other"];

const path = join(
  dirname(fileURLToPath(import.meta.url)),
  "../public/data/videos.json",
);
const data = JSON.parse(readFileSync(path, "utf8"));

const errors = [];
if (data.count !== 665) errors.push(`count field is ${data.count}, expected 665`);
if (!Array.isArray(data.videos) || data.videos.length !== 665) {
  errors.push(`videos.length is ${data.videos?.length}, expected 665`);
}

const ids = data.videos.map((v) => v.id);
const unique = new Set(ids);
if (unique.size !== ids.length) {
  errors.push(`duplicate ids: ${ids.length - unique.size}`);
}
if (ids.some((id) => !id)) errors.push("missing video id");

const statusCounts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
const categoryCounts = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
let tech = 0;
for (const video of data.videos) {
  if (!STATUSES.includes(video.status)) {
    errors.push(`unexpected status ${video.status} on ${video.id}`);
  } else {
    statusCounts[video.status] += 1;
  }
  if (!CATEGORIES.includes(video.category)) {
    errors.push(`unexpected category ${video.category} on ${video.id}`);
  } else {
    categoryCounts[video.category] += 1;
  }
  if (video.techBusiness) tech += 1;
  if (video.techBusiness !== (video.category === "tech")) {
    errors.push(`techBusiness/category mismatch on ${video.id}`);
  }
  const expected = video.durationSec * (1 - video.watchedPct / 100);
  if (Math.abs(expected - video.remainingSec) > 0.51) {
    errors.push(`remainingSec mismatch on ${video.id}`);
  }
}

const expectedStatuses = {
  "Almost finished": 259,
  "Partially watched": 74,
  "Barely started": 282,
  "Not started": 50,
};
for (const [status, expected] of Object.entries(expectedStatuses)) {
  if (statusCounts[status] !== expected) {
    errors.push(`${status}: ${statusCounts[status]} (expected ${expected})`);
  }
}
if (tech !== 490) errors.push(`techBusiness true: ${tech} (expected 490)`);
if (categoryCounts.tech !== 490) {
  errors.push(`category tech: ${categoryCounts.tech} (expected 490)`);
}
if (categoryCounts.health < 15) {
  errors.push(`category health: ${categoryCounts.health} (expected at least 15)`);
}
if (categoryCounts.dating < 15) {
  errors.push(`category dating: ${categoryCounts.dating} (expected at least 15)`);
}
if (categoryCounts.trailers < 8) {
  errors.push(`category trailers: ${categoryCounts.trailers} (expected at least 8)`);
}
if (categoryCounts.travel < 8) {
  errors.push(`category travel: ${categoryCounts.travel} (expected at least 8)`);
}

if (errors.length) {
  console.error("videos.json failed validation:\n" + errors.join("\n"));
  process.exit(1);
}

console.log(
  "videos.json: 665 videos, statuses, remainingSec, and categories ok",
);
