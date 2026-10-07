import { describe, expect, it } from "vitest";
import { FakeLlm } from "../../test/fakes";
import { draftBrief } from "./brief";
import { BriefInputError } from "./errors";

describe("draftBrief", () => {
  const allowed = [
    { ownerId: "company", scope: "global" as const, text: "Orion est client depuis 2021." },
    { ownerId: "bob", scope: "personal" as const, text: "Remise 12 % si volume > 40k unites." },
  ];

  it("sends the allowed excerpts, numbered, and nothing else from memory", async () => {
    const llm = new FakeLlm({ text: "  Brief Orion\n- client depuis 2021 [1]  " });
    const brief = await draftBrief(llm, "brief du rendez-vous Orion", allowed);
    expect(brief).toBe("Brief Orion\n- client depuis 2021 [1]");

    expect(llm.prompts).toHaveLength(1);
    const user = llm.prompts[0]?.[1]?.content ?? "";
    expect(user).toContain('<excerpt n="1" owner="company" scope="global">\nOrion est client depuis 2021.');
    expect(user).toContain(
      '<excerpt n="2" owner="bob" scope="personal">\nRemise 12 % si volume > 40k unites.',
    );
    expect(user.match(/<excerpt /g)).toHaveLength(2);
    expect(llm.prompts[0]?.[0]?.content).toMatch(/Use ONLY the numbered excerpts/);
  });

  it("only ever sees what the caller passed (a withheld excerpt cannot appear)", async () => {
    const llm = new FakeLlm({ text: "ok" });
    await draftBrief(llm, "brief Orion", allowed.slice(0, 1));
    const prompt = JSON.stringify(llm.prompts);
    expect(prompt).toContain("client depuis 2021");
    expect(prompt).not.toContain("Remise 12 %");
  });

  it("fails closed without any allowed excerpt", async () => {
    const llm = new FakeLlm({ text: "should not be called" });
    await expect(draftBrief(llm, "brief Orion", [])).rejects.toBeInstanceOf(BriefInputError);
    expect(llm.prompts).toHaveLength(0);
  });
});
