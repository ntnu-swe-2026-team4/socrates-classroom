import { readD1Migrations } from "@cloudflare/vitest-plugin";
import type { ProvidedContext } from "vitest";

declare module "vitest" {
  interface ProvidedContext {
    d1Migrations: Array<{ name: string; queries: string[] }>;
  }
}

export default async ({
  provide,
}: {
  provide: (key: "d1Migrations", value: ProvidedContext["d1Migrations"]) => void;
}) => {
  const migrations = await readD1Migrations(new URL("../migrations", import.meta.url).pathname);
  provide("d1Migrations", migrations);
};
