import { describe, expect, it } from "vitest";
import { FakeLlm } from "../../test/fakes";
import { draftBrief } from "./brief";
import { BriefInputError } from "./errors";

describe("draftBrief", () => {
  const allowed = [
    { ownerId: "company", scope: "global" as const, text: "Morpho is a client followed by Key Accounts." },
    { ownerId: "bob", scope: "personal" as const, text: "Monthly review meeting with a written agenda." },
  ];

  it("sends the allowed excerpts, numbered, and nothing else from memory", async () => {
    const llm = new FakeLlm({ text: "  Morpho brief\n- followed by Key Accounts [1]  " });
    const brief = await draftBrief(llm, "brief for the Morpho meeting", allowed);
    expect(brief).toBe("Morpho brief\n- followed by Key Accounts [1]");

    expect(llm.prompts).toHaveLength(1);
    const user = llm.prompts[0]?.[1]?.content ?? "";
    expect(user).toContain(
      '<excerpt n="1" owner="company" scope="global">\nMorpho is a client followed by Key Accounts.',
    );
    expect(user).toContain(
      '<excerpt n="2" owner="bob" scope="personal">\nMonthly review meeting with a written agenda.',
    );
    expect(user.match(/<excerpt /g)).toHaveLength(2);
    expect(llm.prompts[0]?.[0]?.content).toMatch(/Use ONLY the numbered excerpts/);
  });

  it("only ever sees what the caller passed (a withheld excerpt cannot appear)", async () => {
    const llm = new FakeLlm({ text: "ok" });
    await draftBrief(llm, "brief Morpho", allowed.slice(0, 1));
    const prompt = JSON.stringify(llm.prompts);
    expect(prompt).toContain("followed by Key Accounts");
    expect(prompt).not.toContain("Monthly review meeting");
  });

  it("fails closed without any allowed excerpt", async () => {
    const llm = new FakeLlm({ text: "should not be called" });
    await expect(draftBrief(llm, "brief Morpho", [])).rejects.toBeInstanceOf(BriefInputError);
    expect(llm.prompts).toHaveLength(0);
  });
});
