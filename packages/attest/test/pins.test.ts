import { describe, expect, it } from "vitest";
import { composeHashOf } from "../src/compose";
import { ComposeError, EventLogError } from "../src/errors";
import { captureDeploymentPins } from "../src/pins";
import { parseEventLog, replayRtmrs } from "../src/rtmr";
import { COMPLIANT_COMPOSE, flipByte, simulatorFixture, syntheticTdxBundle } from "./helpers";

const DOCKER_COMPOSE = (JSON.parse(COMPLIANT_COMPOSE) as { docker_compose_file: string }).docker_compose_file;
const MRTD = "ab".repeat(48);

/** TCB info as Phala reports it for a deployment of `appCompose`. */
function tcbInfoFor(appCompose = COMPLIANT_COMPOSE) {
  const { eventLog } = syntheticTdxBundle(new Uint8Array(64), appCompose);
  const [rtmr0, rtmr1, rtmr2, rtmr3] = replayRtmrs(parseEventLog(eventLog));
  return { mrtd: MRTD, rtmr0, rtmr1, rtmr2, rtmr3, event_log: eventLog, app_compose: appCompose };
}

describe("captureDeploymentPins", () => {
  it("returns the compose hash, app id and OS measurements of a consistent deployment", () => {
    const tcb = tcbInfoFor();
    const pins = captureDeploymentPins({ is_online: true, tcb_info: tcb }, DOCKER_COMPOSE);
    expect(pins).toEqual({
      composeHash: composeHashOf(COMPLIANT_COMPOSE),
      appId: simulatorFixture.appId.replace(/^0x/, "").toLowerCase(),
      osMeasurements: { mrtd: MRTD, rtmr0: tcb.rtmr0, rtmr1: tcb.rtmr1, rtmr2: tcb.rtmr2 },
    });
  });

  it("accepts tcb_info given as a JSON string, as the guest agent returns it", () => {
    const pins = captureDeploymentPins({ tcb_info: JSON.stringify(tcbInfoFor()) }, DOCKER_COMPOSE);
    expect(pins.composeHash).toBe(composeHashOf(COMPLIANT_COMPOSE));
  });

  it("refuses a deployment whose compose file is not the one we deployed", () => {
    expect(() => captureDeploymentPins(tcbInfoFor(), `${DOCKER_COMPOSE}# edited\n`)).toThrow(ComposeError);
  });

  it("refuses an app-compose that does not hash to the attested value", () => {
    const tcb = tcbInfoFor();
    const swapped = { ...tcb, app_compose: COMPLIANT_COMPOSE.replace("badge-enclave", "badge-other") };
    expect(() => captureDeploymentPins(swapped, DOCKER_COMPOSE)).toThrow(/compose hash/);
  });

  it("refuses an event log that does not replay to the reported RTMRs", () => {
    const tcb = tcbInfoFor();
    expect(() => captureDeploymentPins({ ...tcb, rtmr3: flipByte(tcb.rtmr3, 0) }, DOCKER_COMPOSE)).toThrow(
      EventLogError,
    );
  });

  it("refuses a deployment with public logs", () => {
    const leaky = JSON.stringify({ ...JSON.parse(COMPLIANT_COMPOSE), public_logs: true });
    expect(() => captureDeploymentPins(tcbInfoFor(leaky), DOCKER_COMPOSE)).toThrow(/public_logs/);
  });

  it("refuses malformed TCB info", () => {
    expect(() => captureDeploymentPins({ tcb_info: { mrtd: "00" } }, DOCKER_COMPOSE)).toThrow(/malformed/);
  });
});
