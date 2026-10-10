import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "dist-extension");
const zipPath = join(root, "extension/watch-later-sync.zip");

mkdirSync(outDir, { recursive: true });
rmSync(zipPath, { force: true });
execFileSync(
  "zip",
  ["-r", "-X", zipPath, ".", "-x", "watch-later-sync.zip", "fixtures/*"],
  {
    cwd: join(root, "extension"),
    stdio: "inherit",
  },
);
console.log(`wrote ${zipPath}`);
