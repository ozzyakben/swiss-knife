import { describe, expect, it } from "vitest";

import { extractDueDate } from "./quickDates";

// Tuesday June 9, 2026, 21:30 local.
const NOW = new Date(2026, 5, 9, 21, 30);

describe("extractDueDate", () => {
  it("parses 'tomorrow'", () => {
    const { dueDate, matched } = extractDueDate("rotate the staging API keys tomorrow morning", NOW);
    expect(matched).toBe("tomorrow");
    expect(dueDate?.toISOString()).toBe("2026-06-10T12:00:00.000Z");
  });

  it("parses 'today' and 'tonight'", () => {
    expect(extractDueDate("ship the fix today", NOW).dueDate?.toISOString()).toBe("2026-06-09T12:00:00.000Z");
    expect(extractDueDate("backup tonight", NOW).dueDate?.toISOString()).toBe("2026-06-09T12:00:00.000Z");
  });

  it("parses 'day after tomorrow' before 'tomorrow'", () => {
    const { dueDate, matched } = extractDueDate("prep the demo day after tomorrow", NOW);
    expect(matched).toBe("day after tomorrow");
    expect(dueDate?.toISOString()).toBe("2026-06-11T12:00:00.000Z");
  });

  it("parses 'next week' and 'in N days'", () => {
    expect(extractDueDate("review quotas next week", NOW).dueDate?.toISOString()).toBe("2026-06-16T12:00:00.000Z");
    expect(extractDueDate("renew cert in 3 days", NOW).dueDate?.toISOString()).toBe("2026-06-12T12:00:00.000Z");
  });

  it("parses weekday names as the next occurrence", () => {
    // NOW is a Tuesday; friday = +3 days.
    expect(extractDueDate("send the report on friday", NOW).dueDate?.toISOString()).toBe(
      "2026-06-12T12:00:00.000Z"
    );
    // Same weekday means a week out, not today.
    expect(extractDueDate("standup notes tuesday", NOW).dueDate?.toISOString()).toBe(
      "2026-06-16T12:00:00.000Z"
    );
  });

  it("'next <weekday>' skips this week's occurrence", () => {
    expect(extractDueDate("plan the offsite next friday", NOW).dueDate?.toISOString()).toBe(
      "2026-06-19T12:00:00.000Z"
    );
  });

  it("returns nulls when no date phrase is present", () => {
    const { dueDate, matched } = extractDueDate("fix the flaky login test", NOW);
    expect(dueDate).toBeNull();
    expect(matched).toBeNull();
  });
});
