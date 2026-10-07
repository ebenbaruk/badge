import { describe, expect, it } from "vitest";
import { assertDeviceAscii, isDeviceAscii, NotDeviceAsciiError, toDeviceAscii } from "../src";

describe("toDeviceAscii", () => {
  it.each([
    ["Équipe Ventes", "Equipe Ventes"],
    ["Clé de l’agent", "Cle de l'agent"],
    ["« Briefs clients »", '" Briefs clients "'],
    ["“quoted” ‘single’", "\"quoted\" 'single'"],
    ["Paris – Lyon — Nice", "Paris - Lyon - Nice"],
    ["Attendre…", "Attendre..."],
    ["120 k€", "120 kEUR"],
    ["10 000 £", "10 000 GBP"],
    ["Œuvre, cœur, Straße", "OEuvre, coeur, Strasse"],
    ["Łódź, Ørsted, Æsir", "Lodz, Orsted, AEsir"],
    ["ﬁnance", "finance"],
    ["ＡＢＣ", "ABC"],
    ["x²", "x2"],
    ["½ part", "1/2 part"],
    ["a\tb\nc\r\nd", "a b c d"],
    ["  trop   d'espaces  ", "trop d'espaces"],
    ["emoji 🚀 drop", "emoji drop"],
    ["中文", ""],
    ["ctrl\u0000\u0007char", "ctrlchar"],
    ["Ça coûte 5 € → oui", "Ca coute 5 EUR -> oui"],
  ])("%j -> %j", (input, expected) => {
    expect(toDeviceAscii(input)).toBe(expected);
    expect(isDeviceAscii(toDeviceAscii(input))).toBe(true);
  });

  it("is idempotent", () => {
    const once = toDeviceAscii("Réunion « équipe » – 9h…");
    expect(toDeviceAscii(once)).toBe(once);
  });

  it("keeps every printable ASCII character", () => {
    const printable = Array.from({ length: 0x7f - 0x21 }, (_, i) => String.fromCharCode(0x21 + i)).join("");
    expect(toDeviceAscii(printable)).toBe(printable);
  });
});

describe("assertDeviceAscii", () => {
  it("accepts canonical ASCII", () => {
    expect(() => assertDeviceAscii("Partager avec")).not.toThrow();
  });

  it.each(["Équipe", " lead", "trail ", "double  space", "tab\there"])("rejects %j", (value) => {
    expect(() => assertDeviceAscii(value, "field")).toThrow(NotDeviceAsciiError);
  });

  it("carries a machine code", () => {
    try {
      assertDeviceAscii("é", "X.y");
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ code: "NOT_DEVICE_ASCII", field: "X.y" });
    }
  });
});
