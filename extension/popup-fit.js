/**
 * Arc on macOS opens this extension popup as a native window. With a Retina
 * display, custom scaling, or a browser zoom other than 100%, the window is
 * often sized for the designed 320px layout while the document is painted at
 * 2x, so only the left half of the UI is visible (and the Automatic sync
 * block sits in the clipped lower half).
 *
 * Return a CSS zoom factor that shrinks the layout into the real viewport, or
 * "" when no correction is needed.
 */
export const POPUP_WIDTH = 320;

export function popupZoomForViewport({
  viewportWidth,
  viewportHeight,
  layoutWidth = POPUP_WIDTH,
  layoutHeight,
} = {}) {
  let zoom = 1;
  if (viewportWidth > 0 && layoutWidth > viewportWidth + 1) {
    zoom = Math.min(zoom, viewportWidth / layoutWidth);
  }
  if (viewportHeight > 0 && layoutHeight > viewportHeight + 1) {
    zoom = Math.min(zoom, viewportHeight / layoutHeight);
  }
  return zoom < 1 ? String(zoom) : "";
}
