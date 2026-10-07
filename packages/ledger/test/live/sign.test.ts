/**
 * Live clear-signing tests against a running Speculos Flex (app-ethereum develop). Run with `pnpm test:speculos`.
 * Each review is walked automatically; every page is captured to `__screens__/` and its texts are checked.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BADGE_TYPES, deskIdentityDeriveMessage, type BadgeMessageKind } from "@badge/consent";
import { recoverMessageAddress, recoverTypedDataAddress, type Address } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  LedgerSigner,
  SpeculosDevice,
  UserRejectedError,
  autoRespond,
  type ReviewPage,
} from "../../src/index";
import { badgeTypedData, toViemTypedData } from "../../src/typedData";
import { SPECULOS_URL, expectedDisplay, flatten, sampleMessages } from "./fixtures";

const SCREENS_DIR = fileURLToPath(new URL("./__screens__/", import.meta.url));
const KINDS = Object.keys(BADGE_TYPES) as BadgeMessageKind[];

let signer: LedgerSigner;
let device: SpeculosDevice;
let address: Address;

/** Approver that saves a PNG of every page under `__screens__/<name>-NN.png`. */
function capturingApprover(name: string, decision: "approve" | "reject" = "approve") {
  return autoRespond(device, {
    decision,
    onPage: async (page: ReviewPage) => {
      const file = `${SCREENS_DIR}${name}-${String(page.index).padStart(2, "0")}.png`;
      writeFileSync(file, await device.screenshot());
    },
  });
}

beforeAll(async () => {
  mkdirSync(SCREENS_DIR, { recursive: true });
  device = new SpeculosDevice(SPECULOS_URL);
  signer = await LedgerSigner.connect(SPECULOS_URL);
  address = await signer.getAddress();
});

afterAll(async () => {
  await signer?.close();
});

describe(`clear signing on ${SPECULOS_URL}`, () => {
  it.each(KINDS)("signs %s with readable labels and a recoverable signature", async (kind) => {
    const message = sampleMessages(address)[kind];
    const approver = capturingApprover(kind);
    const signature = await signer.signBadgeMessage(kind, message, { onProgress: approver.onProgress });
    const pages = await approver.done();

    const { spaced, compact } = flatten(pages);
    const expected = expectedDisplay(kind, message);
    for (const text of expected.spaced) expect(spaced).toContain(text);
    for (const hex of expected.compact) expect(compact).toContain(hex);
    expect(spaced).not.toMatch(/blind signing/i);

    const recovered = await recoverTypedDataAddress({
      ...toViemTypedData(badgeTypedData(kind, message)),
      signature,
    });
    expect(recovered).toBe(address);
  });

  it("signs the desk identity derivation message (EIP-191) deterministically", async () => {
    const text = deskIdentityDeriveMessage("Acme");
    const first = capturingApprover("DeskIdentityDerive");
    const signature = await signer.signPersonalMessage(text, { onProgress: first.onProgress });
    const { spaced } = flatten(await first.done());
    expect(spaced).toContain("Badge - identite anonyme de desk");
    expect(spaced).toContain("Acme");
    expect(await recoverMessageAddress({ message: text, signature })).toBe(address);

    // RFC 6979: the same Ledger always re-derives the same desk identity.
    const second = autoRespond(device);
    expect(await signer.signPersonalMessage(text, { onProgress: second.onProgress })).toBe(signature);
  });

  it("surfaces a refusal on the device as UserRejectedError", async () => {
    const message = sampleMessages(address).ContextShare;
    const rejecter = capturingApprover("ContextShare-rejected", "reject");
    await expect(
      signer.signBadgeMessage("ContextShare", message, { onProgress: rejecter.onProgress }),
    ).rejects.toBeInstanceOf(UserRejectedError);
    await rejecter.done();
    // Let the "rejected" status screen time out before the next test file uses the device.
    await device.waitForText(/this app enables signing/i, 15_000);
  });
});
