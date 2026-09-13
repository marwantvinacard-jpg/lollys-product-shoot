// Pure segment-chaining math for Movie Flow, deliberately kept free of any
// import (Firebase included) so it can be unit tested in isolation. Every
// movieFlowService.ts import pulls in services/firebase.ts, which fires a
// real network call at module load time (see its testConnection()) -- fine
// for the running app, but it makes anything importing that chain unusable
// in a test process without mocking the network.

export type MovieEngine = 'veo' | 'seedance' | 'kling';

export const VEO_SEGMENT_SECONDS = 8; // veo-3.1-generate-preview's fixed clip length
export const SEEDANCE_SEGMENT_SECONDS = 10;
export const KLING_SEGMENT_SECONDS = 5; // Kling's image-to-video supports 5 or 10s; 5 keeps per-segment cost down
export const MAX_SEGMENTS = 8; // keeps cost/time bounded even if someone asks for 60s+

export const segmentSecondsFor = (engine: MovieEngine): number =>
  engine === 'veo' ? VEO_SEGMENT_SECONDS :
  engine === 'kling' ? KLING_SEGMENT_SECONDS :
  SEEDANCE_SEGMENT_SECONDS;

// How many chained segments a given engine + target duration works out to,
// capped at MAX_SEGMENTS to keep cost/time bounded even for a 60s+ request.
export const computeSegmentCount = (engine: MovieEngine, targetDurationSeconds: number): number =>
  Math.min(MAX_SEGMENTS, Math.max(1, Math.ceil(targetDurationSeconds / segmentSecondsFor(engine))));
