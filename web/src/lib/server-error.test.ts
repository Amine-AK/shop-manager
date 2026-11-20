import { describe, expect, it } from "vitest";
import { explainServerError } from "./server-error";

describe("server errors explained", () => {
  it("a private key that can't be read", () => {
    expect(explainServerError(Object.assign(new Error("error:1E08010C:DECODER routines::unsupported"), { code: "ERR_OSSL_UNSUPPORTED" }))).toContain("GOOGLE_PRIVATE_KEY");
  });
  it("an email and a key that don't go together", () => {
    expect(explainServerError(new Error("invalid_grant: Invalid grant: account not found"))).toContain("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  });
  it("Google out of reach", () => {
    expect(explainServerError(Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }))).toContain("Google");
  });
  it("anything else stays unknown", () => {
    expect(explainServerError(new Error("boom"))).toBeNull();
    expect(explainServerError(null)).toBeNull();
  });
});
