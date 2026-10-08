import { describe, expect, it } from "vitest";
import { DeviceNavigationError, LedgerConnectionError, SpeculosHttpError } from "../src/errors";
import { FLEX_SCREEN, toDeviceCoordinate, toDevicePoint } from "../src/flex";
import { SpeculosDevice } from "../src/speculos";

interface FingerCall {
  body: Record<string, unknown>;
  at: number;
}

/**
 * Fake Speculos: serves a scripted sequence of screens and advances to the next one on every touch, which is
 * how a review behaves (each swipe or tap changes the page).
 */
function fakeSpeculos(screens: string[][], options: { status?: number } = {}) {
  const fingers: FingerCall[] = [];
  let current = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (options.status !== undefined) return new Response("boom", { status: options.status });
    if (url.endsWith("/finger")) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      fingers.push({ body, at: Date.now() });
      if (body.action !== "press") current = Math.min(current + 1, screens.length - 1);
      return new Response("{}");
    }
    if (url.includes("/events")) {
      const events = (screens[current] ?? []).map((text, index) => ({
        text,
        x: 100.5,
        y: 100 + index * 40,
        w: 51,
        h: 36,
      }));
      return Response.json({ events });
    }
    if (url.endsWith("/screenshot")) return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    return new Response("not found", { status: 404 });
  };
  return { device: new SpeculosDevice("http://speculos.test:5000/", { fetch: fetchImpl }), fingers };
}

describe("device coordinates", () => {
  it("rounds to integers (Speculos rejects floats with a silent 400)", () => {
    expect(toDeviceCoordinate(136.5, "x")).toBe(137);
    expect(toDevicePoint({ x: 10.4, y: 99.6 })).toEqual({ x: 10, y: 100 });
  });

  it("clamps to the Flex screen and refuses non-finite values", () => {
    expect(toDeviceCoordinate(-3, "x")).toBe(0);
    expect(toDeviceCoordinate(10_000, "y")).toBe(FLEX_SCREEN.height - 1);
    expect(() => toDeviceCoordinate(Number.NaN, "x")).toThrow(RangeError);
  });
});

describe("SpeculosDevice primitives", () => {
  it("sends integer coordinates for taps", async () => {
    const { device, fingers } = fakeSpeculos([["a"], ["b"]]);
    await device.tap(240.4, 435.7);
    expect(fingers[0]?.body).toMatchObject({ action: "press-and-release", x: 240, y: 436 });
  });

  it("holds with a real press, wait and release", async () => {
    const { device, fingers } = fakeSpeculos([["a"]]);
    await device.hold(240, 435, 120);
    expect(fingers.map((call) => call.body.action)).toEqual(["press", "release"]);
    const [press, release] = fingers;
    expect((release?.at ?? 0) - (press?.at ?? 0)).toBeGreaterThanOrEqual(110);
  });

  it("returns screenshots as PNG buffers", async () => {
    const { device } = fakeSpeculos([["a"]]);
    expect((await device.screenshot()).subarray(0, 4).toString("hex")).toBe("89504e47");
  });

  it("surfaces HTTP errors and unreachable hosts as typed errors", async () => {
    await expect(fakeSpeculos([["a"]], { status: 400 }).device.tap(1, 1)).rejects.toThrow(SpeculosHttpError);
    const offline = new SpeculosDevice("http://speculos.test", {
      fetch: () => Promise.reject(new TypeError("fetch failed")),
    });
    await expect(offline.screen()).rejects.toThrow(LedgerConnectionError);
  });

  it("rejects non-http base URLs", () => {
    expect(() => new SpeculosDevice("file:///etc/passwd")).toThrow();
  });
});

describe("SpeculosDevice.approveReview", () => {
  it("passes the opt-in, walks every page and holds 'Hold to sign'", async () => {
    const { device, fingers } = fakeSpeculos([
      ["Enable Transaction Check?", "Maybe later"],
      ["Review typed message", "Swipe to review"],
      ["Contract", "Share an excerpt", "Share with", "Alice (Sales)"],
      ["Sign typed message?", "Hold to sign"],
      ["Ethereum", "This app enables signing"],
    ]);
    const seen: string[] = [];
    const pages = await device.approveReview({ onPage: (page) => void seen.push(page.texts[0] ?? "") });
    expect(seen).toEqual([
      "Enable Transaction Check?",
      "Review typed message",
      "Contract",
      "Sign typed message?",
    ]);
    expect(pages.flatMap((page) => page.texts)).toContain("Alice (Sales)");
    expect(fingers.at(-2)?.body.action).toBe("press");
    expect(fingers.at(-1)?.body.action).toBe("release");
    for (const call of fingers) {
      expect(Number.isInteger(call.body.x)).toBe(true);
    }
  }, 15_000);

  it("refuses to approve a blind-signing warning by default", async () => {
    const { device } = fakeSpeculos([["Blind signing ahead", "Accept risk and continue"]]);
    await expect(device.approveReview()).rejects.toThrow(DeviceNavigationError);
  }, 15_000);

  it("rejects with Reject then 'Yes, reject'", async () => {
    const { device, fingers } = fakeSpeculos([
      ["Review typed message", "Reject"],
      ["Reject message?", "Yes, reject", "Go back to message"],
      ["Message rejected"],
    ]);
    await device.reject();
    expect(fingers).toHaveLength(2);
  }, 15_000);

  it("times out when the expected text never shows", async () => {
    const { device } = fakeSpeculos([["Ethereum", "This app enables signing"]]);
    await expect(device.waitForText(/Hold to sign/, 300)).rejects.toThrow(DeviceNavigationError);
  });
});
