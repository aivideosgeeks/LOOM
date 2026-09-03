import { describe, expect, it } from "vitest";
import { describeAction, isValidDueDate, validateAssistantPlan } from "@loom/shared";

const plan = (over: Record<string, unknown>) => ({ intent: "act", summary: "do the thing", actions: [], ...over });

describe("assistant plan validation", () => {
  it("accepts a task with a target and a known date form", () => {
    const result = validateAssistantPlan(
      plan({ actions: [{ kind: "create_task", title: "Call Sarah", contact: { name: "Sarah" }, dueDate: "+3d" }] }),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects an action that is not on the allowlist", () => {
    const result = validateAssistantPlan(plan({ actions: [{ kind: "delete_deal", deal: { name: "Globex" } }] }));
    expect(result).toMatchObject({ ok: false, code: "invalid" });
  });

  it("rejects a stage that is not in the pipeline", () => {
    const result = validateAssistantPlan(
      plan({ actions: [{ kind: "move_deal", deal: { name: "Globex" }, stage: "Archived" }] }),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a task with no deal and no contact, which would belong to nothing", () => {
    const result = validateAssistantPlan(plan({ actions: [{ kind: "create_task", title: "Follow up" }] }));
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.details.join(" ")).toMatch(/deal or a contact/);
  });

  it("rejects a date it cannot interpret rather than guessing", () => {
    const result = validateAssistantPlan(
      plan({ actions: [{ kind: "create_task", title: "Call", contact: { name: "Sarah" }, dueDate: "sometime soon" }] }),
    );
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.details.join(" ")).toMatch(/not a date/);
  });

  it("refuses a plan that says it is answering but still proposes changes", () => {
    const result = validateAssistantPlan(
      plan({ intent: "answer", actions: [{ kind: "move_deal", deal: { name: "Globex" }, stage: "Won" }] }),
    );
    expect(result).toMatchObject({ ok: false, code: "invalid" });
  });

  it("refuses an act plan with nothing to do", () => {
    expect(validateAssistantPlan(plan({ intent: "act", actions: [] }))).toMatchObject({ ok: false });
  });

  it("passes an unsupported plan through as the reason to show the user", () => {
    const result = validateAssistantPlan(plan({ intent: "unsupported", summary: "Which Globex deal did you mean?" }));
    expect(result).toMatchObject({ ok: false, code: "unsupported", reason: "Which Globex deal did you mean?" });
  });

  it("caps how much one message may change", () => {
    const many = Array.from({ length: 9 }, () => ({
      kind: "create_task",
      title: "x",
      contact: { name: "Sarah" },
    }));
    expect(validateAssistantPlan(plan({ actions: many })).ok).toBe(false);
  });

  it("rejects a note longer than the limit", () => {
    const result = validateAssistantPlan(
      plan({ actions: [{ kind: "add_note", content: "x".repeat(5000), contact: { name: "Sarah" } }] }),
    );
    expect(result.ok).toBe(false);
  });
});

describe("assistant due dates", () => {
  it("accepts the shared grammar and nothing else", () => {
    for (const good of ["today", "tomorrow", "end_of_week", "+3d", "-2w", "2026-05-04"]) {
      expect(isValidDueDate(good)).toBe(true);
    }
    for (const bad of ["next tuesday-ish", "soon", "04/05/2026", "", "+999999d"]) {
      expect(isValidDueDate(bad)).toBe(false);
    }
  });
});

describe("action descriptions", () => {
  it("says what will happen in the user's terms", () => {
    expect(describeAction({ kind: "move_deal", deal: { name: "Globex renewal" }, stage: "Proposal" })).toBe(
      "Move Globex renewal to Proposal",
    );
    expect(
      describeAction({ kind: "create_task", title: "Call Sarah", contact: { name: "Sarah Lin" }, dueDate: "end_of_week" }),
    ).toBe('Add task "Call Sarah" on Sarah Lin, due end of week');
  });

  it("truncates a long note so the confirmation stays readable", () => {
    const text = describeAction({ kind: "add_note", content: "y".repeat(200), contact: { name: "Sarah" } });
    expect(text.length).toBeLessThan(120);
    expect(text).toContain("…");
  });
});
