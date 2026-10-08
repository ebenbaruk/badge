import { DeviceActionStatus, type DeviceActionState } from "@ledgerhq/device-management-kit";
import { Subject } from "rxjs";
import {
  hashTypedData,
  parseSignature,
  recoverTypedDataAddress,
  type Hex,
  type PrivateKeyAccount,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { ContextShare } from "@badge/consent";
import { describe, expect, it } from "vitest";
import { runDeviceAction, type DeviceProgress } from "../src/deviceAction";
import {
  DeviceActionAbortedError,
  DeviceActionError,
  NonAsciiFieldError,
  UserRejectedError,
  toDeviceActionError,
} from "../src/errors";
import { toSignatureHex } from "../src/signer";
import { assertStringFieldsAscii, badgeTypedData, toDmkTypedData, toViemTypedData } from "../src/typedData";

const account: PrivateKeyAccount = privateKeyToAccount(`0x${"42".repeat(32)}`);

const share: ContextShare = {
  recipientName: "Alice (Sales)",
  excerptLabel: "conditions Orion 2025",
  excerptLength: 87,
  taskLabel: "brief Orion",
  expiresAt: 1_791_100_800n,
  excerptHash: `0x${"ab".repeat(32)}`,
  enclaveMeasurement: `0x${"cd".repeat(32)}`,
  recipient: "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
  owner: account.address,
  taskId: `0x${"01".repeat(32)}`,
  nonce: 42n,
};

describe("toSignatureHex", () => {
  it("left-pads short r/s components to 32 bytes", () => {
    const hex = toSignatureHex({ r: "0x1234", s: `0x${"ff".repeat(32)}`, v: 27 });
    expect(hex).toHaveLength(2 + 130);
    expect(hex.slice(2, 66)).toBe("1234".padStart(64, "0"));
    expect(hex.endsWith("1b")).toBe(true);
  });

  it("normalises a 0/1 recovery id to 27/28", () => {
    expect(toSignatureHex({ r: "0x01", s: "0x02", v: 1 }).endsWith("1c")).toBe(true);
  });

  it("round-trips a real signature through viem", async () => {
    const typedData = toViemTypedData(badgeTypedData("ContextShare", share));
    const signature = await account.signTypedData(typedData);
    const { r, s, v } = parseSignature(signature);
    const rebuilt = toSignatureHex({ r, s, v: Number(v) });
    expect(await recoverTypedDataAddress({ ...typedData, signature: rebuilt })).toBe(account.address);
  });
});

describe("badgeTypedData", () => {
  it("keeps the DMK payload equivalent to the viem payload", () => {
    const payload = badgeTypedData("ContextShare", share);
    const dmk = toDmkTypedData(payload);
    expect(Object.keys(dmk.types)).toEqual(["EIP712Domain", "ContextShare"]);
    expect(dmk.primaryType).toBe("ContextShare");
    const viaDmkShape = hashTypedData(dmk as unknown as Parameters<typeof hashTypedData>[0]);
    expect(viaDmkShape).toBe(hashTypedData(toViemTypedData(payload)));
  });

  it("refuses non-ASCII displayed strings", () => {
    expect(() =>
      assertStringFieldsAscii("ContextShare", { ...share, taskLabel: "Orion brief — café" }),
    ).toThrow(NonAsciiFieldError);
    expect(() => assertStringFieldsAscii("ContextShare", share)).not.toThrow();
  });
});

describe("toDeviceActionError", () => {
  it("maps 6985 to UserRejectedError", () => {
    const error = toDeviceActionError("sign", {
      _tag: "EthAppCommandError",
      errorCode: "6985",
      message: "x",
    });
    expect(error).toBeInstanceOf(UserRejectedError);
    expect(error.statusWord).toBe("6985");
  });

  it("explains the opaque 6a80", () => {
    const error = toDeviceActionError("sign", {
      _tag: "EthAppCommandError",
      errorCode: "6A80",
      message: "Invalid data",
    });
    expect(error).not.toBeInstanceOf(UserRejectedError);
    expect(error.message).toMatch(/6a80.*clear-signing filters/);
  });

  it("keeps unknown errors with their cause", () => {
    const cause = new Error("socket closed");
    const error = toDeviceActionError("getAddress", cause);
    expect(error).toBeInstanceOf(DeviceActionError);
    expect(error.cause).toBe(cause);
    expect(error.message).toContain("socket closed");
  });
});

type State = DeviceActionState<{ value: Hex }, unknown, { requiredUserInteraction: string; step?: string }>;

function fakeAction() {
  const subject = new Subject<State>();
  let cancelled = false;
  return {
    subject,
    isCancelled: () => cancelled,
    action: { observable: subject.asObservable(), cancel: () => void (cancelled = true) },
  };
}

describe("runDeviceAction", () => {
  it("reports progress changes once and resolves the output", async () => {
    const { subject, action } = fakeAction();
    const progress: DeviceProgress[] = [];
    const result = runDeviceAction("sign", () => action, { onProgress: (p) => progress.push(p) });
    const pending = (requiredUserInteraction: string): State => ({
      status: DeviceActionStatus.Pending,
      intermediateValue: { requiredUserInteraction },
    });
    subject.next(pending("none"));
    subject.next(pending("sign-typed-data"));
    subject.next(pending("sign-typed-data"));
    subject.next({ status: DeviceActionStatus.Completed, output: { value: "0x01" } });
    await expect(result).resolves.toEqual({ value: "0x01" });
    expect(progress.map((p) => p.requiredUserInteraction)).toEqual(["none", "sign-typed-data"]);
  });

  it("rejects with a typed error", async () => {
    const { subject, action } = fakeAction();
    const result = runDeviceAction("sign", () => action);
    subject.next({
      status: DeviceActionStatus.Error,
      error: { _tag: "EthAppCommandError", errorCode: "6985" },
    });
    await expect(result).rejects.toBeInstanceOf(UserRejectedError);
  });

  it("types synchronous DMK throws", async () => {
    const result = runDeviceAction("sign", () => {
      throw { _tag: "DeviceSessionNotFound", message: "Device session not found" };
    });
    await expect(result).rejects.toThrow(/DeviceSessionNotFound/);
  });

  it("cancels the device action on abort", async () => {
    const { action, isCancelled } = fakeAction();
    const controller = new AbortController();
    const result = runDeviceAction("sign", () => action, { signal: controller.signal });
    controller.abort();
    await expect(result).rejects.toBeInstanceOf(DeviceActionAbortedError);
    expect(isCancelled()).toBe(true);
  });
});
