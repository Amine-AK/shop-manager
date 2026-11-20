// The decode region: the part of the video frame inside the on-screen guide
// rectangle. Only that crop is decoded (less to scan, faster, fewer stray codes).

/** The guide rectangle, as a share of the camera box on screen (centred). */
export const ROI_WIDTH = 0.8;
export const ROI_HEIGHT = 0.35;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The guide rectangle in video pixels. The video fills its box like CSS
 * `object-fit: cover` (scaled up and cut at the sides), so the box shows only
 * a centred part of the frame.
 */
export function roiInVideo(videoW: number, videoH: number, boxW: number, boxH: number): Rect {
  if (!videoW || !videoH || !boxW || !boxH) return { x: 0, y: 0, w: videoW, h: videoH };
  const scale = Math.max(boxW / videoW, boxH / videoH);
  const w = Math.min(videoW, (ROI_WIDTH * boxW) / scale);
  const h = Math.min(videoH, (ROI_HEIGHT * boxH) / scale);
  return { x: Math.round((videoW - w) / 2), y: Math.round((videoH - h) / 2), w: Math.round(w), h: Math.round(h) };
}

/**
 * The recovery region: a centred square of the visible part of the frame, as
 * big as fits. A barcode held upright (common on bottles and boxes) doesn't
 * fit in the wide guide strip; it fits here, and the reader then tries rotations.
 */
export function recoveryRoiInVideo(videoW: number, videoH: number, boxW: number, boxH: number): Rect {
  if (!videoW || !videoH || !boxW || !boxH) return { x: 0, y: 0, w: videoW, h: videoH };
  const scale = Math.max(boxW / videoW, boxH / videoH);
  // The part of the frame the box shows (object-fit: cover), then a square inside it.
  const side = Math.round(Math.min(videoW, videoH, boxW / scale, boxH / scale) * 0.95);
  return { x: Math.round((videoW - side) / 2), y: Math.round((videoH - side) / 2), w: side, h: side };
}
