import { describe, it, expect } from 'vitest';
import { computeSegmentCount, MAX_SEGMENTS, VEO_SEGMENT_SECONDS, SEEDANCE_SEGMENT_SECONDS, KLING_SEGMENT_SECONDS } from './movieFlowMath';

describe('computeSegmentCount', () => {
  it('always returns at least 1 segment, even for a very short target', () => {
    expect(computeSegmentCount('veo', 1)).toBe(1);
    expect(computeSegmentCount('seedance', 0)).toBe(1);
  });

  it('rounds up to cover the full requested duration', () => {
    // 20s target / 8s Veo segments -> needs 3 segments (2 would only cover 16s)
    expect(computeSegmentCount('veo', 20)).toBe(Math.ceil(20 / VEO_SEGMENT_SECONDS));
    expect(computeSegmentCount('seedance', 25)).toBe(Math.ceil(25 / SEEDANCE_SEGMENT_SECONDS));
    expect(computeSegmentCount('kling', 12)).toBe(Math.ceil(12 / KLING_SEGMENT_SECONDS));
  });

  it('caps at MAX_SEGMENTS regardless of how long the request is', () => {
    expect(computeSegmentCount('kling', 10_000)).toBe(MAX_SEGMENTS);
    expect(computeSegmentCount('veo', 10_000)).toBe(MAX_SEGMENTS);
  });

  it('picks a different segment count per engine for the same target duration', () => {
    // Kling's 5s segments need more chained clips than Veo's 8s ones for the same total.
    const target = 24;
    expect(computeSegmentCount('kling', target)).toBeGreaterThan(computeSegmentCount('veo', target));
  });
});
