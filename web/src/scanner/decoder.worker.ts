/// <reference lib="webworker" />
// Decodes cropped camera frames off the main thread, so the page stays smooth.
// Messages in: { type: "init" } then { type: "decode", id, bitmap, effort } (bitmap is transferred).
// Messages out: { type: "ready", kind } / { type: "error", message } / { type: "result", id, codes }.

import { createDetector, type Detected, type Detector } from "./detector";
import type { Effort } from "./effort";

export type WorkerIn = { type: "init" } | { type: "decode"; id: number; bitmap: ImageBitmap; effort: Effort };
export type WorkerOut = { type: "ready"; kind: Detector["kind"] } | { type: "error"; message: string } | { type: "result"; id: number; codes: Detected[] };

const scope = self as unknown as DedicatedWorkerGlobalScope;
let detector: Promise<Detector> | null = null;
// Reused to turn a frame into pixels for ZXing.
let canvas: OffscreenCanvas | null = null;

function pixels(bitmap: ImageBitmap): ImageData | null {
  canvas ??= new OffscreenCanvas(bitmap.width, bitmap.height);
  if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
  }
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
}

scope.onmessage = async (e: MessageEvent<WorkerIn>) => {
  const msg = e.data;
  if (msg.type === "init") {
    detector ??= createDetector();
    try {
      scope.postMessage({ type: "ready", kind: (await detector).kind } satisfies WorkerOut);
    } catch (err) {
      scope.postMessage({ type: "error", message: String(err) } satisfies WorkerOut);
    }
    return;
  }
  let codes: Detected[] = [];
  try {
    detector ??= createDetector();
    const d = await detector;
    const source = d.input === "pixels" ? pixels(msg.bitmap) : msg.bitmap;
    if (source) codes = (await d.detect(source, msg.effort)).map((c) => ({ format: c.format, rawValue: c.rawValue }));
  } catch {
    // An unreadable frame: no codes.
  } finally {
    msg.bitmap.close();
  }
  scope.postMessage({ type: "result", id: msg.id, codes } satisfies WorkerOut);
};
