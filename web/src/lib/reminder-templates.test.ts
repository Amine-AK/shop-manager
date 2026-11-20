import { describe, expect, it } from "vitest";
import { summarizeClient, type Client, type Ledger } from "./ledger";
import { DEFAULT_TEMPLATE, fillTemplate, parseTemplates, templatesValue, unknownVariables } from "./reminder-templates";
import { reminderMessage } from "./receipt";
import { opAllowed } from "./permissions";

const T = "2026-10-01T10:00:00.000Z";
const client = (over: Partial<Client> = {}): Client => ({ id: "C-AAAA0001", name: "Amine", phone: "0661234567", installment: 200, period: "شهر", nextDueDate: "2026-11-10", notes: "", createdAt: T, updatedAt: T, ...over });
const summary = (c: Client) =>
  summarizeClient(
    { clients: [c], purchases: [{ id: "S-AAAA0001", clientId: c.id, date: "2026-10-01", item: "redmi 15C", price: 1500, notes: "", createdAt: T, updatedAt: T }], payments: [], changes: [] } as unknown as Ledger,
    c,
    "2026-11-18",
  );

describe("reminder texts with [variables]", () => {
  it("fills the customer's values", () => {
    const m = fillTemplate("سلام [الاسم]، باقي عليك [الباقي] على [السلعة]، فاتت [شحال فات] من [تاريخ الدفعة]. [ المحل ]", summary(client()), "2026-11-18");
    expect(m).toBe("سلام Amine، باقي عليك 1.500 درهم على redmi 15C، فاتت 8 أيام من 10/11/2026. ELECTRO-LMESTOUR");
  });
  it("drops a line whose values are all empty; keeps unknown [words]", () => {
    const s = summary(client({ installment: 0 }));
    expect(fillTemplate("سلام [الاسم]\n🔁 الطريطة: [الطريطة]\n[شي حاجة]", s, "2026-11-18")).toBe("سلام Amine\n[شي حاجة]");
    expect(unknownVariables("[الاسم] [شي حاجة] [الباقي]")).toEqual(["شي حاجة"]);
  });
  it("the default text gives the same message as the built-in reminder", () => {
    const s = summary(client());
    expect(fillTemplate(DEFAULT_TEMPLATE.text, s, "2026-11-18")).toBe(reminderMessage(s));
  });
  it("reads the saved texts; the default one when nothing usable is saved", () => {
    const list = [{ id: "a", name: "لطيفة", text: "سلام [الاسم]" }];
    expect(parseTemplates({ value: templatesValue(list) })).toEqual(list);
    expect(parseTemplates({ value: "{oops" })).toEqual([DEFAULT_TEMPLATE]);
    expect(parseTemplates(undefined)).toEqual([DEFAULT_TEMPLATE]);
    expect(parseTemplates({ value: '[{"id":"x","name":"","text":"a"}]' })).toEqual([DEFAULT_TEMPLATE]);
  });
  it("whoever sends reminders may change the texts", () => {
    const save = { type: "setting.save", key: "reminder-templates", value: "[]", opId: "O-1", at: T } as never;
    expect(opAllowed({ id: "s", name: "S", role: "seller", services: ["reminders"], seeCost: false }, save)).toBe(true);
    expect(opAllowed({ id: "s", name: "S", role: "seller", services: ["stock"], seeCost: false }, save)).toBe(false);
  });
});
