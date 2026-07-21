import { describe, expect, it } from "vitest";
import { downsampleTrajectory } from "@/components/elo-sparkline";

describe("downsampleTrajectory", () => {
  it("returns original array when length <= targetCount", () => {
    const points = [1500, 1510, 1520];
    expect(downsampleTrajectory(points, 6)).toEqual(points);
  });

  it("downsamples 12 points to 6 with first and last preserved", () => {
    const points = [1500, 1505, 1510, 1512, 1508, 1515, 1520, 1518, 1525, 1530, 1528, 1535];
    const result = downsampleTrajectory(points, 6);
    expect(result).toHaveLength(6);
    expect(result[0]).toBe(1500);
    expect(result[5]).toBe(1535);
  });

  it("downsamples 20 points to 5", () => {
    const points = Array.from({ length: 20 }, (_, i) => 1500 + i * 2);
    const result = downsampleTrajectory(points, 5);
    expect(result).toHaveLength(5);
    expect(result[0]).toBe(1500);
    expect(result[4]).toBe(1538);
  });

  it("handles 7 points to 6", () => {
    const points = [1500, 1505, 1510, 1512, 1518, 1522, 1530];
    const result = downsampleTrajectory(points, 6);
    expect(result).toHaveLength(6);
    expect(result[0]).toBe(1500);
    expect(result[5]).toBe(1530);
  });
});
