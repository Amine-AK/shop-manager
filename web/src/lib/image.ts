// Pictures chosen for categories become small squares (96×96) stored as text
// in the Google Sheet cell, so they need no other storage.

import { MAX_ICON_LENGTH, MAX_PHOTO_LENGTH } from "./ledger";

const SIZE = 96;

/** Crop to a centred square, shrink to 96×96, and encode small enough for one cell. */
export async function pictureToIcon(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff"; // transparent PNGs get a white background in JPEG
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
  bitmap.close();
  for (const quality of [0.85, 0.7, 0.5, 0.35]) {
    // WebP where the browser can make it (smaller), else JPEG.
    let url = canvas.toDataURL("image/webp", quality);
    if (!url.startsWith("data:image/webp")) url = canvas.toDataURL("image/jpeg", quality);
    if (url.length <= MAX_ICON_LENGTH) return url;
  }
  throw new Error("الصورة كبيرة بزاف");
}

/**
 * Photo of a device brought for repair: shrunk (longest side 480 px, then
 * smaller if needed) and compressed until it fits one sheet cell.
 */
export async function photoForCell(file: File, maxLength = MAX_PHOTO_LENGTH): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    for (const side of [480, 400, 320, 240]) {
      const k = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * k));
      canvas.height = Math.max(1, Math.round(bitmap.height * k));
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.7, 0.55, 0.4]) {
        let url = canvas.toDataURL("image/webp", quality);
        if (!url.startsWith("data:image/webp")) url = canvas.toDataURL("image/jpeg", quality);
        if (url.length <= maxLength) return url;
      }
    }
  } finally {
    bitmap.close();
  }
  throw new Error("الصورة كبيرة بزاف");
}
