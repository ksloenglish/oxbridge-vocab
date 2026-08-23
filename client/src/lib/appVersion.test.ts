import { describe, expect, it } from "vitest";
import { formatHongKongBuildVersion } from "../../../shared/buildVersion";

describe("automatic app build version", () => {
  it("formats a build instant in Hong Kong yyyyMMdd.HHmm format", () => {
    expect(formatHongKongBuildVersion(new Date("2026-08-22T16:05:00Z"))).toBe(
      "20260823.0005",
    );
  });

  it("always returns the required version shape", () => {
    expect(formatHongKongBuildVersion(new Date())).toMatch(/^\d{8}\.\d{4}$/);
  });
});
