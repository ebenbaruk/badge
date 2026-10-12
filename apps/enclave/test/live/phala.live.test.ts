/**
 * Phala Confidential AI smoke test: one structured call and one embeddings call through our client.
 * Costs real money, so it only runs with BADGE_LIVE_PHALA=1 (chat model: PHALA_AI_MODEL or BADGE_LLM_CHAT_MODEL).
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  cosineSimilarity,
  createLlmClient,
  EMBEDDING_DIMENSIONS,
  loadLlmProfile,
  loadSeedDataset,
} from "../../src";

const enabled = process.env["BADGE_LIVE_PHALA"] === "1";

describe.runIf(enabled)("phala profile", () => {
  const profile = loadLlmProfile({ ...process.env, BADGE_LLM_PROFILE: "phala" });
  const llm = createLlmClient(profile);

  it("returns strict structured output with reasoning off", async () => {
    const Schema = z.object({ client: z.string(), discountPercent: z.number(), paymentDays: z.number() });
    const result = await llm.structuredCompletion(
      Schema,
      [
        { role: "system", content: "Extract the deal terms. Answer in the JSON schema." },
        {
          role: "user",
          content: "Helios terms: 12% discount if volume > 40k units, payment at 60 days.",
        },
      ],
      { name: "deal_terms", maxOutputTokens: 100 },
    );
    expect(result).toEqual({
      client: expect.stringMatching(/helios/i),
      discountPercent: 12,
      paymentDays: 60,
    });
  });

  it("embeds in 384 dimensions and ranks the Morpho note above the HR note", async () => {
    const notes = loadSeedDataset().notes;
    const text = (id: string) => notes.find((n) => n.id === id)?.text ?? "";
    const [task, morpho, hr] = await llm.embed([
      "brief for tomorrow's meeting with client Morpho",
      text("bob-morpho-conditions-2025"),
      text("chloe-rh-prudhommes"),
    ]);
    if (!task || !morpho || !hr) throw new Error("missing vectors");
    expect(task).toHaveLength(EMBEDDING_DIMENSIONS);
    const morphoScore = cosineSimilarity(task, morpho);
    const hrScore = cosineSimilarity(task, hr);
    console.info(`phala MiniLM similarity: morpho ${morphoScore.toFixed(3)}, hr ${hrScore.toFixed(3)}`);
    expect(morphoScore).toBeGreaterThan(hrScore);
  });
});
