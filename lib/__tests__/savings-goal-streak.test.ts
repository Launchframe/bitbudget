// @vitest-environment node
import { describe, expect, it } from "vitest"
import {
  currentGoalStreakFromClosed,
  longestGoalStreakFromClosed,
  previousMonthKey,
} from "../savings-goal-streak"

describe("savings-goal-streak", () => {
  it("previousMonthKey rolls calendar months", () => {
    expect(previousMonthKey("2026-05")).toBe("2026-04")
    expect(previousMonthKey("2026-01")).toBe("2025-12")
  })

  it("currentGoalStreakFromClosed breaks on month gaps", () => {
    expect(
      currentGoalStreakFromClosed([
        { periodKey: "2026-03", achievedGoal: true },
        { periodKey: "2026-01", achievedGoal: true },
      ]),
    ).toBe(1)
  })

  it("currentGoalStreakFromClosed counts consecutive achieved months", () => {
    expect(
      currentGoalStreakFromClosed([
        { periodKey: "2026-03", achievedGoal: true },
        { periodKey: "2026-02", achievedGoal: true },
        { periodKey: "2026-01", achievedGoal: false },
      ]),
    ).toBe(2)
  })

  it("longestGoalStreakFromClosed finds max run and breaks on gaps", () => {
    expect(
      longestGoalStreakFromClosed([
        { periodKey: "2026-05", achievedGoal: true, closedAt: new Date() },
        { periodKey: "2026-04", achievedGoal: true, closedAt: new Date() },
        { periodKey: "2026-02", achievedGoal: true, closedAt: new Date() },
        { periodKey: "2026-01", achievedGoal: true, closedAt: new Date() },
      ]),
    ).toBe(2)
  })
})
