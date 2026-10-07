/**
 * Automatic answer to device reviews on Speculos, for tests and scripted demo runs (never on a real device).
 */
import type { DeviceProgress } from "./deviceAction";
import { DeviceNavigationError } from "./errors";
import type { ApproveReviewOptions, ReviewPage, SpeculosDevice } from "./speculos";

/** DMK interactions that mean "a review is (about to be) on screen". */
const REVIEW_INTERACTIONS: ReadonlySet<string> = new Set([
  "sign-typed-data",
  "sign-personal-message",
  "sign-transaction",
  "web3-checks-opt-in",
  // Registering a contact (device-contacts-kit) reports this interaction.
  "register-wallet",
]);

export interface AutoResponder {
  /** Pass as `onProgress` of a signing call. */
  onProgress: (progress: DeviceProgress) => void;
  /**
   * Outcome of the walk: the pages seen when approving, `[]` when rejecting.
   * @throws DeviceNavigationError if the device never asked for a review, or navigation failed.
   */
  done: () => Promise<ReviewPage[]>;
}

/**
 * Creates a responder that approves (default) or rejects the review as soon as the DMK reports that the device
 * waits for the user. The walk starts once, on the first review interaction.
 */
export function autoRespond(
  device: SpeculosDevice,
  options: ApproveReviewOptions & { decision?: "approve" | "reject" } = {},
): AutoResponder {
  let walk: Promise<ReviewPage[]> | undefined;
  return {
    onProgress: (progress) => {
      if (walk !== undefined || !REVIEW_INTERACTIONS.has(progress.requiredUserInteraction)) return;
      walk = options.decision === "reject" ? device.reject().then(() => []) : device.approveReview(options);
      // Observed through done(); avoid an unhandled rejection if the caller only awaits the signature.
      walk.catch(() => undefined);
    },
    done: () => walk ?? Promise.reject(new DeviceNavigationError("The device never asked for a review")),
  };
}
