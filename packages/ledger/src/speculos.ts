/**
 * Driver for an emulated Ledger Flex over the Speculos REST API: read the screen, take screenshots, touch it.
 *
 * Used twice: by tests and demo scripts to approve reviews automatically, and by the web UI "Ledger mirror"
 * (stream {@link SpeculosDevice.screenshot}, forward clicks with {@link SpeculosDevice.tap} and long presses with
 * {@link SpeculosDevice.hold}). Speculos only: a real Ledger cannot be driven remotely, by design.
 */
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { DeviceNavigationError, LedgerConnectionError, SpeculosHttpError } from "./errors";
import { FLEX_POSITIONS, HOLD_TO_SIGN_MS, toDevicePoint, type DevicePoint } from "./flex";

/** One text element of the current screen, with its bounding box in device pixels. */
export interface ScreenText {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One distinct screen met while walking a review. */
export interface ReviewPage {
  /** Index of the page in the walk, from 0. */
  index: number;
  texts: string[];
}

export interface ApproveReviewOptions {
  /** Called once per distinct screen, before acting on it (e.g. to save a screenshot). Awaited. */
  onPage?: (page: ReviewPage) => void | Promise<void>;
  /** Upper bound on navigation steps before giving up. */
  maxSteps?: number;
  /** How long to wait for the review to appear on the device. */
  startTimeoutMs?: number;
  /**
   * Accept the "Blind signing ahead" warning. Off by default: every Badge message is clear-signed, so a blind
   * signing screen means the descriptor was not applied and the user would approve something unreadable.
   */
  allowBlindSigning?: boolean;
}

export interface SpeculosDeviceOptions {
  /** Injected for tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

const SpeculosEventsSchema = z.object({
  events: z.array(
    z.object({ text: z.string(), x: z.number(), y: z.number(), w: z.number(), h: z.number() }).loose(),
  ),
});

/** Time for the device UI to settle after an action before reading the screen again. */
const SCREEN_SETTLE_MS = 700;
const POLL_INTERVAL_MS = 250;
const DEFAULT_MAX_REVIEW_STEPS = 40;
const DEFAULT_REVIEW_START_TIMEOUT_MS = 20_000;
const DEFAULT_WAIT_TIMEOUT_MS = 10_000;
/** The "Message signed" / "rejected" status screen dismisses itself after a few seconds. */
const STATUS_SCREEN_TIMEOUT_MS = 15_000;
/** Same screen read this many times in a row while we keep acting on it: navigation is stuck. */
const MAX_IDENTICAL_SCREENS = 5;
/** A short tap, as ragger does (seconds, Speculos unit). */
const TAP_DURATION_S = 0.1;

const HOME_SCREEN = /this app enables signing/i;
const HOLD_TO_SIGN = /hold to sign/i;
const CONFIRM_BUTTON = /^confirm$/i;
const BLIND_SIGNING_WARNING = /blind signing ahead/i;
/** Interstitials that must be passed to reach the review: transaction-check opt-in, blind-signing warning. */
const PROCEED_BUTTON = /^(maybe later|accept risk and continue|continue anyway)$/i;
const BLIND_SIGNING_PROCEED = /^(accept risk and continue|continue anyway)$/i;
const REJECT_BUTTON = /^reject/i;
const CONFIRM_REJECT_BUTTON = /^yes, reject/i;

/** Center of a screen text element (rounded later by {@link toDevicePoint}). */
function centerOf(element: ScreenText): DevicePoint {
  return { x: element.x + element.w / 2, y: element.y + element.h / 2 };
}

export class SpeculosDevice {
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  /** @param baseUrl - Speculos API root, e.g. `http://localhost:5001`. */
  constructor(baseUrl: string, options: SpeculosDeviceOptions = {}) {
    this.baseUrl = z
      .url({ protocol: /^https?$/ })
      .parse(baseUrl)
      .replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  /** Text elements of the current screen, in display order. */
  async screen(): Promise<ScreenText[]> {
    const body = await this.request("/events?currentscreenonly=true", { method: "GET" }).then((r) =>
      r.json(),
    );
    const parsed = SpeculosEventsSchema.safeParse(body);
    if (!parsed.success)
      throw new SpeculosHttpError("/events", 200, `unexpected body: ${parsed.error.message}`);
    return parsed.data.events.map(({ text, x, y, w, h }) => ({ text, x, y, w, h }));
  }

  /** Texts of the current screen, in display order. */
  async screenTexts(): Promise<string[]> {
    return (await this.screen()).map((element) => element.text);
  }

  /** PNG capture of the current screen. */
  async screenshot(): Promise<Buffer> {
    const response = await this.request("/screenshot", { method: "GET" });
    return Buffer.from(await response.arrayBuffer());
  }

  /** Short tap at (x, y); coordinates are rounded and clamped to the screen. */
  async tap(x: number, y: number): Promise<void> {
    const point = toDevicePoint({ x, y });
    await this.finger({ action: "press-and-release", ...point, delay: TAP_DURATION_S });
  }

  /** Left swipe from the right edge: next page of a review. */
  async swipeNext(): Promise<void> {
    const from = toDevicePoint(FLEX_POSITIONS.swipeNextFrom);
    const to = toDevicePoint(FLEX_POSITIONS.swipeNextTo);
    await this.finger({ action: "press-and-release", ...from, x2: to.x, y2: to.y, delay: TAP_DURATION_S });
  }

  /**
   * Long press at (x, y) for `durationMs` of real time.
   * Implemented as press, wait, release: Speculos' `press-and-release` with a `delay` counts emulated ticks and
   * does NOT validate "Hold to sign" on Flex.
   */
  async hold(x: number, y: number, durationMs: number = HOLD_TO_SIGN_MS): Promise<void> {
    const point = toDevicePoint({ x, y });
    await this.finger({ action: "press", ...point });
    try {
      await sleep(durationMs);
    } finally {
      // Always release, otherwise the emulated finger stays down and the device ignores later touches.
      await this.finger({ action: "release", ...point });
    }
  }

  /**
   * Polls the screen until a text element matches `pattern`.
   * @throws DeviceNavigationError on timeout.
   */
  async waitForText(pattern: RegExp, timeoutMs: number = DEFAULT_WAIT_TIMEOUT_MS): Promise<ScreenText> {
    const deadline = Date.now() + timeoutMs;
    let last: ScreenText[] = [];
    while (Date.now() <= deadline) {
      last = await this.screen();
      const match = last.find((element) => pattern.test(element.text));
      if (match !== undefined) return match;
      await sleep(POLL_INTERVAL_MS);
    }
    throw new DeviceNavigationError(
      `Text ${String(pattern)} not shown within ${timeoutMs} ms`,
      last.map((element) => element.text),
    );
  }

  /**
   * Walks a pending review to the end and holds "Hold to sign": passes the transaction-check opt-in
   * ("Maybe later"), swipes through every page, then signs (or taps "Confirm" for reviews without signature,
   * such as a contact registration). Returns every distinct page seen.
   * @throws DeviceNavigationError when the review does not show up, gets stuck, ends without a sign screen, or
   *   shows a blind-signing warning while `allowBlindSigning` is off.
   */
  async approveReview(options: ApproveReviewOptions = {}): Promise<ReviewPage[]> {
    const maxSteps = options.maxSteps ?? DEFAULT_MAX_REVIEW_STEPS;
    const startTimeoutMs = options.startTimeoutMs ?? DEFAULT_REVIEW_START_TIMEOUT_MS;

    const pages: ReviewPage[] = [];
    let lastKey: string | undefined;
    let identicalCount = 0;
    for (let step = 0; step < maxSteps; step++) {
      let screen = await this.screen();
      if (screen.some((element) => HOME_SCREEN.test(element.text))) {
        // The app goes back home between the transaction-check opt-in and the review (while the DMK streams the
        // message): wait for the next screen instead of swiping the home screen into the settings.
        await this.waitForReviewStart(startTimeoutMs);
        screen = await this.screen();
      }
      const texts = screen.map((element) => element.text);
      const key = texts.join("\n");
      if (key === lastKey) {
        identicalCount++;
        if (identicalCount >= MAX_IDENTICAL_SCREENS)
          throw new DeviceNavigationError("Review is stuck", texts);
      } else {
        identicalCount = 0;
        lastKey = key;
        const page = { index: pages.length, texts };
        pages.push(page);
        await options.onPage?.(page);
      }

      if (texts.some((text) => BLIND_SIGNING_WARNING.test(text)) && options.allowBlindSigning !== true) {
        throw new DeviceNavigationError(
          "Device shows a blind-signing warning: the message is not clear-signed",
          texts,
        );
      }

      const holdButton = screen.find((element) => HOLD_TO_SIGN.test(element.text));
      if (holdButton !== undefined) {
        const point = centerOf(holdButton);
        await this.hold(point.x, point.y);
        // Wait for the "signed" status to clear so the next review starts from the home screen.
        await this.waitForText(HOME_SCREEN, STATUS_SCREEN_TIMEOUT_MS);
        return pages;
      }
      // Reviews that need no signature (e.g. registering a contact) end with a plain "Confirm" tap.
      const confirmButton = screen.find((element) => CONFIRM_BUTTON.test(element.text));
      if (confirmButton !== undefined) {
        const point = centerOf(confirmButton);
        await this.tap(point.x, point.y);
        await this.waitForText(HOME_SCREEN, STATUS_SCREEN_TIMEOUT_MS);
        return pages;
      }

      const proceed = screen.find(
        (element) =>
          PROCEED_BUTTON.test(element.text) &&
          (options.allowBlindSigning === true || !BLIND_SIGNING_PROCEED.test(element.text)),
      );
      if (proceed !== undefined) {
        const point = centerOf(proceed);
        await this.tap(point.x, point.y);
      } else {
        await this.swipeNext();
      }
      await sleep(SCREEN_SETTLE_MS);
    }
    throw new DeviceNavigationError(
      `'Hold to sign' not reached after ${maxSteps} steps`,
      lastKey?.split("\n") ?? [],
    );
  }

  /**
   * Rejects the pending review: taps "Reject" then confirms "Yes, reject".
   * @throws DeviceNavigationError when no review with a Reject button is on screen.
   */
  async reject(timeoutMs: number = DEFAULT_WAIT_TIMEOUT_MS): Promise<void> {
    await this.waitForReviewStart(timeoutMs);
    const rejectButton = await this.waitForText(REJECT_BUTTON, timeoutMs);
    const point = centerOf(rejectButton);
    await this.tap(point.x, point.y);
    const confirm = await this.waitForText(CONFIRM_REJECT_BUTTON, timeoutMs);
    const confirmPoint = centerOf(confirm);
    await this.tap(confirmPoint.x, confirmPoint.y);
  }

  /** Waits until the device leaves its home screen (the review or an interstitial is displayed). */
  private async waitForReviewStart(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let texts: string[] = [];
    while (Date.now() <= deadline) {
      texts = await this.screenTexts();
      if (texts.length > 0 && !texts.some((text) => HOME_SCREEN.test(text))) {
        await sleep(SCREEN_SETTLE_MS);
        return;
      }
      await sleep(POLL_INTERVAL_MS);
    }
    throw new DeviceNavigationError(`No review shown on the device within ${timeoutMs} ms`, texts);
  }

  private async finger(body: Record<string, number | string>): Promise<void> {
    await this.request("/finger", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  /** Every response is checked: Speculos reports bad input (e.g. float coordinates) only through the status. */
  private async request(path: string, init: RequestInit): Promise<Response> {
    const endpoint = path.split("?")[0] ?? path;
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, init);
    } catch (error) {
      throw new LedgerConnectionError(`Speculos unreachable at ${this.baseUrl} (is the container running?)`, {
        cause: error,
      });
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => response.statusText);
      throw new SpeculosHttpError(endpoint, response.status, detail.slice(0, 200));
    }
    return response;
  }
}
