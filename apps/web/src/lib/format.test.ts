import { describe, expect, it } from "vitest";
import {
  estimateTokens,
  formatLength,
  formatRelative,
  ofName,
  reasonForThirdParty,
  percentSaved,
  plural,
  shortHex,
} from "./format";

/** French number formatting uses a narrow no-break space as thousands separator. */
const NNBSP = " ";

describe("format helpers", () => {
  it("estimates tokens at ~4 characters each, rounding up", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });

  it("computes the share of tokens saved, bounded to [0, 100]", () => {
    expect(percentSaved(296, 667)).toBe(56);
    expect(percentSaved(0, 100)).toBe(100);
    expect(percentSaved(200, 100)).toBe(0);
    expect(percentSaved(10, 0)).toBe(0);
  });

  it("shortens long hex values and leaves short ones intact", () => {
    expect(shortHex("0x9858EfFD232B4033E47d90003D41EC34EcaEda94")).toBe("0x9858Ef…da94");
    expect(shortHex("0x1234")).toBe("0x1234");
  });

  it("formats lengths and plurals the French way", () => {
    expect(formatLength(1058)).toBe(`1${NNBSP}058 car.`);
    expect(plural(1, "extrait")).toBe("1 extrait");
    expect(plural(3, "extrait candidat", "extraits candidats")).toBe("3 extraits candidats");
  });

  it("formats relative times", () => {
    const now = new Date("2026-10-07T10:00:00Z");
    expect(formatRelative("2026-10-08T10:00:00Z", now)).toBe("demain");
    expect(formatRelative("2026-10-07T09:55:00Z", now)).toBe("il y a 5 minutes");
    expect(formatRelative("2026-10-07T10:00:10Z", now)).toBe("à l'instant");
  });

  it('elides "de" before a name starting with a vowel', () => {
    expect(ofName("Alice")).toBe("d'Alice");
    expect(ofName("Élodie")).toBe("d'Élodie");
    expect(ofName("Bob")).toBe("de Bob");
    expect(ofName("Chloé Bernard")).toBe("de Chloé Bernard");
  });
});

describe("reasonForThirdParty", () => {
  it("rephrases owner-addressed rule reasons for the compliance officer", () => {
    expect(reasonForThirdParty("La tâche demande 100 % de votre contexte personnel.", "Bob Durand")).toBe(
      "La tâche demande 100 % du contexte personnel de Bob Durand.",
    );
    expect(
      reasonForThirdParty(
        "L'agent demande l'intégralité de votre contexte, pas un extrait ciblé.",
        "Bob Durand",
      ),
    ).toBe("L'agent demande l'intégralité du contexte de Bob Durand, pas un extrait ciblé.");
    expect(reasonForThirdParty("12 demandes sur votre contexte depuis une heure.", "Alice Martin")).toBe(
      "12 demandes sur le contexte d'Alice Martin depuis une heure.",
    );
  });

  it("leaves neutral reasons untouched and names an unknown owner generically", () => {
    expect(
      reasonForThirdParty("Extrait inhabituellement long (900 caractères, seuil 600).", "Bob Durand"),
    ).toBe("Extrait inhabituellement long (900 caractères, seuil 600).");
    expect(reasonForThirdParty("40 % de votre contexte personnel.", null)).toBe(
      "40 % du contexte personnel du propriétaire.",
    );
  });
});
