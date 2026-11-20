// The barcode reader: the browser's own BarcodeDetector when it reads all
// product barcode formats (Chrome on Android), else ZXing-C++ in WebAssembly
// (zxing-wasm: iPhone, PCs), called directly so each frame can be read fast or
// hard (src/scanner/effort.ts). Works in a page and in a Web Worker.

import { fromZXing, zxingOptions, type Effort } from "./effort";
import { PRODUCT_FORMATS, SCAN_FORMATS } from "./formats";

/** Our copy of the reader's .wasm (copied from node_modules by scripts/copy-zxing-wasm.mjs): works offline, no CDN. */
export const WASM_PATH = "/scanner/zxing_reader.wasm";

export interface Detected {
  format: string;
  rawValue: string;
}

export interface Detector {
  /** "native" or "wasm", for diagnostics. */
  kind: "native" | "wasm";
  /** What detect() takes: an image (native) or its pixels (ZXing). */
  input: "image" | "pixels";
  detect(source: ImageBitmapSource | ImageData, effort: Effort): Promise<Detected[]>;
}

interface DetectorClass {
  new (options: { formats: string[] }): { detect(source: ImageBitmapSource): Promise<Detected[]> };
  getSupportedFormats?: () => Promise<string[]>;
}

function nativeClass(): DetectorClass | null {
  const g = globalThis as unknown as { BarcodeDetector?: DetectorClass };
  return typeof g.BarcodeDetector === "function" ? g.BarcodeDetector : null;
}

export async function createDetector(): Promise<Detector> {
  const formats = [...SCAN_FORMATS];
  const Native = nativeClass();
  if (Native) {
    try {
      const supported = (await Native.getSupportedFormats?.()) ?? [];
      // Native when it reads all product barcodes; it then reads whichever of the others it can.
      if (PRODUCT_FORMATS.every((f) => supported.includes(f))) {
        const d = new Native({ formats: formats.filter((f) => supported.includes(f)) });
        return { kind: "native", input: "image", detect: (src) => d.detect(src as ImageBitmapSource) };
      }
    } catch {
      // Fall through to the WebAssembly reader.
    }
  }
  const { prepareZXingModule, readBarcodes } = await import("zxing-wasm/reader");
  const wasmUrl = new URL(WASM_PATH, globalThis.location.origin).href;
  // Load the .wasm from our own server now (fails here, clearly, if it can't).
  await prepareZXingModule({
    overrides: { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? wasmUrl : prefix + path) },
    fireImmediately: true,
  });
  const options = { fast: zxingOptions(formats, "fast"), hard: zxingOptions(formats, "hard") };
  return {
    kind: "wasm",
    input: "pixels",
    async detect(src, effort) {
      const results = await readBarcodes(src as ImageData, options[effort] as Parameters<typeof readBarcodes>[1]);
      return results.filter((r) => r.isValid !== false && r.text).map((r) => ({ format: fromZXing(r.format), rawValue: r.text }));
    },
  };
}
