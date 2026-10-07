/**
 * Live test of contact names on the device (app-ethereum develop): register "Alice (Ventes)" on chloe's device,
 * then sign a ContextShare whose recipient is displayed through the address book.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  LedgerSigner,
  SUGGESTED_CONTACT_FIELDS,
  SpeculosDevice,
  autoRespond,
  type ContactProof,
  type ReviewPage,
} from "../../src/index";
import { DEMO_DEVICES, flatten, sampleMessages } from "./fixtures";

const SCREENS_DIR = fileURLToPath(new URL("./__screens__/", import.meta.url));
const URL_UNDER_TEST = process.env.BADGE_CONTACTS_SPECULOS_URL ?? DEMO_DEVICES.chloe;
const ALICE_ADDRESS = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";
const UNKNOWN_ADDRESS = "0x1111111111111111111111111111111111111111";

let signer: LedgerSigner;
let device: SpeculosDevice;
let contact: ContactProof;

function capturing(name: string) {
  return autoRespond(device, {
    onPage: async (page: ReviewPage) => {
      const file = `${SCREENS_DIR}${name}-${String(page.index).padStart(2, "0")}.png`;
      writeFileSync(file, await device.screenshot());
    },
  });
}

beforeAll(async () => {
  mkdirSync(SCREENS_DIR, { recursive: true });
  device = new SpeculosDevice(URL_UNDER_TEST);
  signer = await LedgerSigner.connect(URL_UNDER_TEST, { contactFields: SUGGESTED_CONTACT_FIELDS });
});

afterAll(async () => {
  await signer?.close();
});

describe(`contact names on ${URL_UNDER_TEST}`, () => {
  it("registers a contact confirmed on the device", async () => {
    const approver = capturing("Contact-register");
    contact = await signer.registerContact(
      { contactName: "Alice (Ventes)", address: ALICE_ADDRESS },
      { onProgress: approver.onProgress },
    );
    const { spaced } = flatten(await approver.done());
    expect(spaced).toContain("Alice (Ventes)");
    expect(contact.address).toBe(ALICE_ADDRESS);
  });

  it("shows the contact name for the recipient address", async () => {
    const owner = await signer.getAddress();
    const message = { ...sampleMessages(owner).ContextShare, recipient: ALICE_ADDRESS } as const;
    const approver = capturing("ContextShare-contact");
    await signer.signBadgeMessage("ContextShare", message, {
      contacts: [contact],
      onProgress: approver.onProgress,
    });
    const { spaced } = flatten(await approver.done());
    expect(spaced).toContain("Destinataire Alice (Ventes)");
  });

  it("falls back to the raw address for an unknown recipient", async () => {
    const owner = await signer.getAddress();
    const message = { ...sampleMessages(owner).ContextShare, recipient: UNKNOWN_ADDRESS } as const;
    const approver = capturing("ContextShare-unknown");
    await signer.signBadgeMessage("ContextShare", message, {
      contacts: [contact],
      onProgress: approver.onProgress,
    });
    const { spaced, compact } = flatten(await approver.done());
    expect(spaced).toContain("Destinataire");
    expect(compact).toContain(UNKNOWN_ADDRESS.slice(2));
  });
});
