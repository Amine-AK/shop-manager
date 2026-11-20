import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { chooseEffort, fromZXing, HARD_EVERY, RECOVER_AFTER_MS, zxingOptions } from "./effort";
import { SCAN_FORMATS } from "./formats";
import { recoveryRoiInVideo, roiInVideo } from "./roi";

describe("progressive decoding", () => {
  it("reads fast until nothing was read for a while, then one frame in a few tries hard", () => {
    expect(chooseEffort(1000, 1000, 0)).toBe("fast");
    expect(chooseEffort(1000 + RECOVER_AFTER_MS - 1, 1000, 0)).toBe("fast");
    const now = 1000 + RECOVER_AFTER_MS;
    const efforts = Array.from({ length: HARD_EVERY * 2 }, (_, i) => chooseEffort(now, 1000, i));
    expect(efforts.filter((e) => e === "hard")).toHaveLength(2);
    expect(efforts.filter((e) => e === "fast")).toHaveLength(HARD_EVERY * 2 - 2);
  });
  it("fast switches ZXing's extra passes off; hard switches them on; text as the ponyfill gave it", () => {
    const fast = zxingOptions(SCAN_FORMATS, "fast");
    expect(fast).toMatchObject({ tryHarder: false, tryRotate: false, tryInvert: false, tryDownscale: false, maxNumberOfSymbols: 1, textMode: "Plain" });
    expect(zxingOptions(SCAN_FORMATS, "hard")).toMatchObject({ tryHarder: true, tryRotate: true, tryInvert: true, tryDownscale: true });
    expect(fast.formats).toEqual(["EAN13", "EAN8", "UPCA", "UPCE", "QRCode", "DataMatrix", "Code128", "Code39", "Code93", "ITF", "Codabar"]);
    expect(fromZXing("EAN13")).toBe("ean_13");
    expect(fromZXing("Code128")).toBe("code_128");
    expect(fromZXing("PDF417")).toBe("unknown");
  });
  it("the recovery region is a centred square of what the screen shows", () => {
    // 1280×720 camera in a 360×300 box (object-fit: cover shows 864×720 of it).
    const sq = recoveryRoiInVideo(1280, 720, 360, 300);
    expect(sq.w).toBe(sq.h);
    expect(sq.w).toBe(Math.round(720 * 0.95));
    expect(sq.x).toBe(Math.round((1280 - sq.w) / 2));
    const strip = roiInVideo(1280, 720, 360, 300);
    expect(strip.h).toBeLessThan(sq.h);
  });
});

// The real reader, as the app ships it: an upright EAN-13 is missed by fast reads
// on the strip-shaped image and found by the recovery settings.
describe("ZXing (zxing-wasm reader, same .wasm as the app)", () => {
  type Reader = typeof import("zxing-wasm/reader");
  let z: Reader;
  beforeAll(async () => {
    const wasm = path.join(process.cwd(), "node_modules", "zxing-wasm", "dist", "reader", "zxing_reader.wasm");
    z = await import("zxing-wasm/reader");
    const bytes = readFileSync(wasm);
    // A plain ArrayBuffer (not Node's Buffer) for the Emscripten module.
    const wasmBinary = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    await z.prepareZXingModule({ overrides: { wasmBinary }, fireImmediately: true });
  });

  const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
  const G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
  const R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"];
  const PAR = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];
  const CODE = "6111245678900";
  const bits = (() => {
    const d = CODE.split("").map(Number);
    let b = "101";
    for (let i = 1; i <= 6; i++) b += (PAR[d[0]][i - 1] === "L" ? L : G)[d[i]];
    b += "01010";
    for (let i = 7; i <= 12; i++) b += R[d[i]];
    return b + "101";
  })();

  /** A grey image with the barcode, bars vertical (normal) or horizontal (barcode held upright). */
  function image(w: number, h: number, upright: boolean, module = 3) {
    const data = new Uint8ClampedArray(w * h * 4).fill(235);
    const len = bits.length * module;
    const start = Math.floor(((upright ? h : w) - len) / 2);
    for (let i = 0; i < bits.length; i++) {
      if (bits[i] !== "1") continue;
      for (let k = 0; k < module; k++) {
        const pos = start + i * module + k;
        if (upright) for (let x = Math.floor(w * 0.3); x < Math.floor(w * 0.7); x++) data.fill(20, (pos * w + x) * 4, (pos * w + x) * 4 + 3);
        else for (let y = Math.floor(h * 0.15); y < Math.floor(h * 0.85); y++) data.fill(20, (y * w + pos) * 4, (y * w + pos) * 4 + 3);
      }
    }
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
    return { data, width: w, height: h, colorSpace: "srgb" } as ImageData;
  }
  const read = async (img: ImageData, effort: "fast" | "hard") =>
    (await z.readBarcodes(img, zxingOptions(SCAN_FORMATS, effort) as Parameters<Reader["readBarcodes"]>[1])).map((r) => [fromZXing(r.format), r.text]);

  it("fast reads a normal barcode in the strip", async () => {
    expect(await read(image(1024, 252, false), "fast")).toEqual([["ean_13", CODE]]);
  });
  it("an upright barcode: fast misses it, recovery (square + rotation) reads it", async () => {
    const upright = image(684, 684, true);
    expect(await read(upright, "fast")).toEqual([]);
    expect(await read(upright, "hard")).toEqual([["ean_13", CODE]]);
  });
});
