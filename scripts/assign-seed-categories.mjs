import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { categoryForSeedVideo } from "../api/_lib/categorize.mjs";

const path = join(dirname(fileURLToPath(import.meta.url)), "../public/data/videos.json");
const data = JSON.parse(readFileSync(path, "utf8"));

data.videos = data.videos.map((video) => {
  const category = categoryForSeedVideo(video);
  const ordered = {};
  for (const [key, value] of Object.entries(video)) {
    if (key === "category") continue;
    ordered[key] = value;
    if (key === "techBusiness") ordered.category = category;
  }
  if (!("category" in ordered)) ordered.category = category;
  return ordered;
});

writeFileSync(path, JSON.stringify(data));
console.log("stamped category on", data.videos.length, "seed videos");
