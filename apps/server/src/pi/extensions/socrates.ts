import PREAMBLE_RAW from "../../prompts/socrates.md?raw";
import type { Extension } from "@earendil-works/pi-durable";

export function socratesExtension(): Extension {
  return {
    name: "socrates",
    sections: [{ key: "preamble", render: () => PREAMBLE_RAW.trim(), tag: false }],
  };
}
