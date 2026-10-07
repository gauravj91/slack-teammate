import { describe, expect, it } from "vitest";
import { describeCron, nextRunAfter, parseSchedule, ScheduleError } from "@/lib/schedule";

describe("parseSchedule", () => {
  const from = new Date(Date.UTC(2026, 9, 7, 10, 0, 0)); // Wed 2026-10-07 10:00 UTC

  it("computes the next Monday 08:00 in the given timezone", () => {
    const { next } = parseSchedule("0 8 * * 1", "America/New_York", from);
    // Mon 2026-10-12 08:00 EDT = 12:00 UTC
    expect(next.getTime()).toBe(Date.UTC(2026, 9, 12, 12, 0, 0));
  });

  it("respects DST: Berlin 09:00 in winter is 08:00 UTC", () => {
    const { next } = parseSchedule("0 9 * * *", "Europe/Berlin", new Date(Date.UTC(2026, 11, 1, 12)));
    expect(next.getTime()).toBe(Date.UTC(2026, 11, 2, 8, 0, 0));
  });

  it("rejects bad cron, bad timezone and too-frequent schedules", () => {
    expect(() => parseSchedule("every monday", "UTC", from)).toThrow(ScheduleError);
    expect(() => parseSchedule("0 8 * * 1", "Mars/Olympus", from)).toThrow(/timezone/);
    expect(() => parseSchedule("* * * * *", "UTC", from, 15)).toThrow(/at most every 15/);
    expect(() => parseSchedule("99 8 * * *", "UTC", from)).toThrow(ScheduleError);
  });

  it("allows every-15-minutes at the limit", () => {
    expect(() => parseSchedule("*/15 * * * *", "UTC", from, 15)).not.toThrow();
  });

  it("nextRunAfter advances past the current run", () => {
    const first = nextRunAfter("0 8 * * 1", "UTC", from);
    const second = nextRunAfter("0 8 * * 1", "UTC", first);
    expect(second.getTime() - first.getTime()).toBe(7 * 86400_000);
  });
});

describe("describeCron", () => {
  it("describes common patterns", () => {
    expect(describeCron("0 8 * * 1", "UTC")).toBe("Every Monday at 08:00 (UTC)");
    expect(describeCron("30 9 * * 1-5", "Europe/Berlin")).toBe("Weekdays at 09:30 (Europe/Berlin)");
    expect(describeCron("*/30 * * * *", "UTC")).toBe("*/30 * * * * (UTC)");
  });
});
