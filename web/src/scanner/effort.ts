// Progressive decoding: how hard the reader tries on a frame.
//
// - "fast" (most frames): ZXing with its extra passes off (no rotation, no
//   inverted colours, no downscaled copies, one symbol), on the guide strip.
//   Measured 3–5× faster per frame than ZXing's all-on defaults, which the
//   `barcode-detector` ponyfill used on every frame and can't change.
// - "hard" (recovery): once nothing was read for RECOVER_AFTER_MS, every
//   HARD_EVERY-th frame tries harder: rotation (vertical barcodes), inverted
//   colours, downscaling, on a centred square instead of the strip, so a barcode
//   held upright fits. Fast frames keep coming in between, so an easy code
//   placed meanwhile is still read at once.
// The browser's own BarcodeDetector (Android Chrome) has no such options: only
// the region changes for it.

export type Effort = "fast" | "hard";

/** Nothing read for this long: start recovery frames. */
export const RECOVER_AFTER_MS = 700;
/** In recovery, one frame in this many is a hard one. */
export const HARD_EVERY = 3;

export function chooseEffort(now: number, lastReadAt: number, frameNo: number): Effort {
  return now - lastReadAt >= RECOVER_AFTER_MS && frameNo % HARD_EVERY === 0 ? "hard" : "fast";
}

/** Our format names (W3C BarcodeDetector) ↔ ZXing's, as the ponyfill maps them. */
export const ZXING_FORMATS: Record<string, string> = {
  ean_13: "EAN13",
  ean_8: "EAN8",
  upc_a: "UPCA",
  upc_e: "UPCE",
  qr_code: "QRCode",
  data_matrix: "DataMatrix",
  code_128: "Code128",
  code_39: "Code39",
  code_93: "Code93",
  itf: "ITF",
  codabar: "Codabar",
};

const FROM_ZXING = new Map(Object.entries(ZXING_FORMATS).map(([ours, z]) => [z, ours]));

/** ZXing's format name → ours ("unknown" when it isn't one we scan). */
export const fromZXing = (format: string) => FROM_ZXING.get(format) ?? "unknown";

/**
 * ZXing reader options for an effort. `textMode: "Plain"` gives the same text
 * the ponyfill gave (e.g. a UPC-A read as its 13-digit EAN), so codes saved
 * in stock still match.
 */
export function zxingOptions(formats: readonly string[], effort: Effort) {
  const zx = formats.map((f) => ZXING_FORMATS[f]).filter(Boolean);
  const hard = effort === "hard";
  return {
    formats: zx,
    textMode: "Plain",
    tryHarder: hard,
    tryRotate: hard,
    tryInvert: hard,
    tryDownscale: hard,
    maxNumberOfSymbols: 1,
  } as const;
}
