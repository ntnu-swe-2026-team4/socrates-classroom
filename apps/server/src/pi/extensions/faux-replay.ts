import type { Extension } from "@earendil-works/pi-durable";
import type { FauxProviderHandle, FauxResponseStep } from "@earendil-works/pi-ai";

export function fauxReplayExtension(faux: FauxProviderHandle, script: FauxResponseStep): Extension {
  return {
    name: "faux.replay",
    hooks: [
      {
        task: "pi.generation",
        handlers: {
          beforeRequest: () => {
            faux.appendResponses([script]);
          },
        },
      },
    ],
  };
}
