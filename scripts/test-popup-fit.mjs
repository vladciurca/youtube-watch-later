import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { POPUP_WIDTH, popupZoomForViewport } from "../extension/popup-fit.js";

const root = dirname(fileURLToPath(import.meta.url));

assert.equal(POPUP_WIDTH, 320);
assert.equal(popupZoomForViewport({ viewportWidth: 320, viewportHeight: 800, layoutWidth: 320, layoutHeight: 600 }), "");
assert.equal(popupZoomForViewport({ viewportWidth: 400, viewportHeight: 800, layoutWidth: 320, layoutHeight: 600 }), "");
assert.equal(popupZoomForViewport({ viewportWidth: 160, viewportHeight: 800, layoutWidth: 320, layoutHeight: 600 }), "0.5");
assert.equal(popupZoomForViewport({ viewportWidth: 160, viewportHeight: 325, layoutWidth: 320, layoutHeight: 650 }), "0.5");
assert.equal(popupZoomForViewport({ viewportWidth: 400, viewportHeight: 300, layoutWidth: 320, layoutHeight: 650 }), String(300 / 650));
assert.equal(popupZoomForViewport({ viewportWidth: 0, viewportHeight: 0, layoutWidth: 320, layoutHeight: 650 }), "");
assert.equal(popupZoomForViewport({ viewportWidth: 319, viewportHeight: 800, layoutWidth: 320 }), "");
assert.equal(popupZoomForViewport({ viewportWidth: 318, viewportHeight: 800, layoutWidth: 320 }), String(318 / 320));

const popupJs = readFileSync(join(root, "../extension/popup.js"), "utf8");
assert.match(popupJs, /from "\.\/popup-fit\.js"/);
assert.match(popupJs, /addEventListener\("resize", fitPopupToViewport\)/);

const manifest = JSON.parse(readFileSync(join(root, "../extension/manifest.json"), "utf8"));
assert.equal(manifest.version, "1.6.0");

console.log("test-popup-fit: ok");
