import { describe, expect, it } from "vitest";
import { isOutdated } from "./app-version";

describe("a page left open on an older build", () => {
  it("is outdated only when both versions are known and differ", () => {
    expect(isOutdated("b2", "b1")).toBe(true);
    expect(isOutdated("b1", "b1")).toBe(false);
    expect(isOutdated(undefined, "b1")).toBe(false);
    expect(isOutdated("b2", "")).toBe(false);
  });
});
