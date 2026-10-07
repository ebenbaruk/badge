import { describe, expect, it } from "vitest";
import { DEVICE_REQUEST_HEADER } from "@/lib/mirror";
import { crossSiteRefusal } from "./device-routes";

const URL_ = "http://localhost:3000/api/devices/bob/review";
const BODY = JSON.stringify({ decision: "approve" });

function request(headers: Record<string, string>): Request {
  return new Request(URL_, { method: "POST", headers: { host: "localhost:3000", ...headers }, body: BODY });
}

const sameOrigin = {
  origin: "http://localhost:3000",
  "sec-fetch-site": "same-origin",
  "content-type": "application/json",
  [DEVICE_REQUEST_HEADER]: "1",
};

describe("device command guard (CSRF)", () => {
  it("lets the app's own JSON commands through", () => {
    expect(crossSiteRefusal(request(sameOrigin))).toBeUndefined();
  });

  it("refuses the 'simple' cross-site POST a foreign page can send without a preflight", async () => {
    const refusal = crossSiteRefusal(
      request({
        origin: "https://evil.example",
        "sec-fetch-site": "cross-site",
        "content-type": "text/plain",
      }),
    );
    expect(refusal?.status).toBe(403);
  });

  it.each([
    ["a foreign Origin", { ...sameOrigin, origin: "https://evil.example" }, 403],
    ["an opaque Origin", { ...sameOrigin, origin: "null" }, 403],
    ["a cross-site fetch", { ...sameOrigin, "sec-fetch-site": "same-site" }, 403],
    ["a non-JSON body", { ...sameOrigin, "content-type": "text/plain" }, 415],
    ["no device header", { origin: sameOrigin.origin, "content-type": "application/json" }, 403],
  ])("refuses %s", (_name, headers, status) => {
    expect(crossSiteRefusal(request(headers))?.status).toBe(status);
  });
});
