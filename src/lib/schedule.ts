import { CronExpressionParser } from "cron-parser";
import { MIN_SCHEDULE_INTERVAL_MINUTES } from "./config";

export class ScheduleError extends Error {}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate a 5-field cron expression + IANA timezone and return the next run time.
 * Rejects schedules that fire more often than MIN_SCHEDULE_INTERVAL_MINUTES.
 */
export function parseSchedule(
  cron: string,
  timezone: string,
  from: Date = new Date(),
  minIntervalMinutes = MIN_SCHEDULE_INTERVAL_MINUTES,
): { next: Date; following: Date } {
  const expr = cron.trim().replace(/\s+/g, " ");
  if (expr.split(" ").length !== 5) {
    throw new ScheduleError("Use a 5-field cron expression: minute hour day-of-month month day-of-week");
  }
  if (!isValidTimezone(timezone)) throw new ScheduleError(`Unknown timezone "${timezone}"`);

  let it;
  try {
    it = CronExpressionParser.parse(expr, { tz: timezone, currentDate: from });
  } catch (e) {
    throw new ScheduleError(`Invalid cron expression "${cron}": ${(e as Error).message}`);
  }
  const next = it.next().toDate();
  const following = it.next().toDate();
  const third = it.next().toDate();
  const gap = Math.min(following.getTime() - next.getTime(), third.getTime() - following.getTime());
  if (gap < minIntervalMinutes * 60_000) {
    throw new ScheduleError(`Schedules can run at most every ${minIntervalMinutes} minutes`);
  }
  return { next, following };
}

export function nextRunAfter(cron: string, timezone: string, after: Date = new Date()): Date {
  return CronExpressionParser.parse(cron.trim(), { tz: timezone, currentDate: after }).next().toDate();
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Human-friendly description for common patterns; falls back to the raw cron. */
export function describeCron(cron: string, timezone: string): string {
  const [m, h, dom, mon, dow] = cron.trim().split(/\s+/);
  const isNum = (s: string) => /^\d+$/.test(s);
  if (isNum(m) && isNum(h) && mon === "*") {
    const time = `${h.padStart(2, "0")}:${m.padStart(2, "0")}`;
    if (dom === "*" && dow === "*") return `Every day at ${time} (${timezone})`;
    if (dom === "*" && dow === "1-5") return `Weekdays at ${time} (${timezone})`;
    if (dom === "*" && isNum(dow)) return `Every ${DAYS[Number(dow) % 7]} at ${time} (${timezone})`;
    if (isNum(dom) && dow === "*") return `Monthly on day ${dom} at ${time} (${timezone})`;
  }
  return `${cron} (${timezone})`;
}
