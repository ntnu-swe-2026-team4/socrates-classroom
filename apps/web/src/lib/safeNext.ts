export const safeNext = (value: unknown): string | undefined =>
  typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/login")
    ? value
    : undefined;
