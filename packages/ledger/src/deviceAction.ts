/**
 * Turns a DMK device action (an rxjs observable of states) into a Promise, with progress reporting and abort.
 */
import { DeviceActionStatus, type ExecuteDeviceActionReturnType } from "@ledgerhq/device-management-kit";
import { DeviceActionAbortedError, toDeviceActionError } from "./errors";

/** What the device is waiting for, reported each time it changes. */
export interface DeviceProgress {
  /**
   * DMK `UserInteractionRequired` value: `none`, `sign-typed-data`, `sign-personal-message`,
   * `web3-checks-opt-in`, `confirm-open-app`, `unlock-device`...
   */
  requiredUserInteraction: string;
  /** DMK step identifier when the action exposes one (e.g. `signer.eth.steps.signTypedData`). */
  step?: string;
}

export interface DeviceActionOptions {
  /** Called whenever the required user interaction (or step) changes. Must not throw. */
  onProgress?: (progress: DeviceProgress) => void;
  /** Cancels the action; the promise then rejects with {@link DeviceActionAbortedError}. */
  signal?: AbortSignal;
}

function readProgress(intermediateValue: unknown): DeviceProgress {
  const value = (
    typeof intermediateValue === "object" && intermediateValue !== null ? intermediateValue : {}
  ) as {
    requiredUserInteraction?: unknown;
    step?: unknown;
  };
  const progress: DeviceProgress = {
    requiredUserInteraction:
      typeof value.requiredUserInteraction === "string" ? value.requiredUserInteraction : "none",
  };
  if (typeof value.step === "string") progress.step = value.step;
  return progress;
}

/**
 * Runs a device action to completion.
 * @param name - action name used in error messages.
 * @param start - starts the action (e.g. `() => signer.signTypedData(...)`); synchronous throws are typed too.
 * @throws DeviceActionError (or UserRejectedError) when the device or the DMK reports an error.
 * @throws DeviceActionAbortedError when `signal` aborts or the action is stopped.
 */
export function runDeviceAction<Output, ActionError, IntermediateValue>(
  name: string,
  start: () => ExecuteDeviceActionReturnType<Output, ActionError, IntermediateValue>,
  options: DeviceActionOptions = {},
): Promise<Output> {
  return new Promise<Output>((resolve, reject) => {
    const { signal, onProgress } = options;
    if (signal?.aborted === true) {
      reject(new DeviceActionAbortedError(`${name} aborted before start`));
      return;
    }
    let action: ExecuteDeviceActionReturnType<Output, ActionError, IntermediateValue>;
    try {
      // The DMK throws synchronously for some failures (e.g. "Device session not found" after a disconnect).
      action = start();
    } catch (error) {
      reject(toDeviceActionError(name, error));
      return;
    }
    let lastProgressKey = "";
    const onAbort = (): void => {
      action.cancel();
      subscription.unsubscribe();
      reject(new DeviceActionAbortedError(`${name} aborted`));
    };
    const settle = (): void => {
      signal?.removeEventListener("abort", onAbort);
    };
    const subscription = action.observable.subscribe({
      next: (state) => {
        switch (state.status) {
          case DeviceActionStatus.Completed:
            settle();
            resolve(state.output);
            return;
          case DeviceActionStatus.Error:
            settle();
            reject(toDeviceActionError(name, state.error));
            return;
          case DeviceActionStatus.Stopped:
            settle();
            reject(new DeviceActionAbortedError(`${name} stopped`));
            return;
          case DeviceActionStatus.Pending: {
            const progress = readProgress(state.intermediateValue);
            const key = `${progress.requiredUserInteraction}|${progress.step ?? ""}`;
            if (key !== lastProgressKey) {
              lastProgressKey = key;
              onProgress?.(progress);
            }
            return;
          }
          case DeviceActionStatus.NotStarted:
            return;
        }
      },
      error: (error: unknown) => {
        settle();
        reject(toDeviceActionError(name, error));
      },
    });
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
