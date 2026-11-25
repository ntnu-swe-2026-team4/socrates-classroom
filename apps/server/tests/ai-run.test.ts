import { describe, expect, it } from "vitest";
import { aiRunOf } from "../src/pi/ai-run";
import { fakeAiOf } from "./helpers";

interface BindingState {
  closed: boolean;
}

function bindingRun(this: BindingState, model: string, inputs: Record<string, unknown>) {
  if (this.closed !== false) throw new TypeError("binding state unreachable");
  return { model, inputs };
}

describe("aiRunOf (voice/classifier binding seam)", () => {
  it("calls run with the binding as receiver, keeping this-dependent state reachable", async () => {
    const run = aiRunOf(fakeAiOf({ closed: false, run: bindingRun }));
    expect(await run("@cf/test/clef-flash", { state: { latest: "幫我寫 python" } })).toEqual({
      model: "@cf/test/clef-flash",
      inputs: { state: { latest: "幫我寫 python" } },
    });
  });
});
