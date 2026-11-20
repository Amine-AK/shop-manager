import { describe, expect, it } from "vitest";
import { addDays, formatMoroccoPhone, isValidPhone, parseSheetDate, parseSum } from "./dates";

describe("amounts", () => {
  it("reads French number formatting", () => {
    expect(parseSum("1 500,50")).toBe(1500.5);
  });
  it("adds the numbers of a cell", () => {
    expect(parseSum("500 + 300")).toBe(800);
  });
});

describe("phones", () => {
  it.each([
    ["0661234567", "212661234567"],
    ["+212 661-23-45-67", "212661234567"],
    ["00212661234567", "212661234567"],
    ["661234567", "212661234567"],
  ])("%s -> %s", (input, out) => expect(formatMoroccoPhone(input)).toBe(out));
  it("rejects numbers that are too short", () => {
    expect(isValidPhone(formatMoroccoPhone("123"))).toBe(false);
  });
});

describe("dates", () => {
  it("reads the date formats of a sheet", () => {
    expect(parseSheetDate("2026-10-05")).toBe("2026-10-05");
    expect(parseSheetDate("5/10/2026")).toBe("2026-10-05");
    expect(parseSheetDate("46300")).toBe(addDays("1899-12-30", 46300));
    expect(parseSheetDate("31/02/2026")).toBe("");
  });
  it("adds days across months", () => {
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
  });
});
