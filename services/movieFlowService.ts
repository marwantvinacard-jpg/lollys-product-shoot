import { generateProductVideo } from './geminiService';
import { generateSeedanceSegment, downloadSeedanceVideo } from './seedanceService';
import { generateKlingVideo, KlingVariant } from './klingService';
import { extractLastFrameBase64, stitchVideoClips } from '../utils/videoUtils';
import { addUsageRecord } from './usageTracker';
import {
  MovieEngine,
  VEO_SEGMENT_SECONDS,
  SEEDANCE_SEGMENT_SECONDS,
  KLING_SEGMENT_SECONDS,
  computeSegmentCount,
} from './movieFlowMath';

export type { MovieEngine } from './movieFlowMath';

export interface MovieFlowOptions {
  prompt: string;
  referenceImages: string[]; // base64 (no data: prefix), up to 5
  targetDurationSeconds: number; // up to 60
  engine: MovieEngine;
  aspectRatio: '16:9' | '9:16' | '1:1';
  resolution: '720p' | '1080p';
  klingVariant?: KlingVariant;
  username?: string;
  onProgress?: (info: {
    stage: 'segment' | 'stitching' | 'done';
    segmentIndex?: number;
    totalSegments?: number;
    fraction?: number;
  }) => void;
}

export interface MovieFlowSegmentResult {
  url: string; // local, playable Object URL
  durationSeconds: number;
}

export interface MovieFlowResult {
  finalUrl: string;
  segments: MovieFlowSegmentResult[];
}

// Every engine now runs through server-side Cloud Functions, so the client
// can no longer check "is a key configured" ahead of time -- that's the
// function's own secret, invisible to the browser. Always report ready and
// let a missing secret surface as a clear error from the function call itself.
export const isMovieEngineReady = (_engine: MovieEngine): boolean => true;

export const generateMovie = async (options: MovieFlowOptions): Promise<MovieFlowResult> => {
  const totalSegments = computeSegmentCount(options.engine, options.targetDurationSeconds);

  const segments: MovieFlowSegmentResult[] = [];
  let continuityFrame: string | undefined; // base64, no data: prefix

  for (let i = 0; i < totalSegments; i++) {
    options.onProgress?.({ stage: 'segment', segmentIndex: i, totalSegments });

    if (options.engine === 'veo') {
      const startImage = continuityFrame
        ? continuityFrame
        : options.referenceImages[0];

      if (!startImage) {
        throw new Error('Veo needs at least one reference/start image. [ignoring loop detection]');
      }

      const scenePrompt = i === 0
        ? options.prompt
        : `${options.prompt}\n\nContinue the same scene, subject, and style seamlessly from the previous shot.`;

      const videoUrl = await generateProductVideo(startImage, undefined, scenePrompt, {
        aspectRatio: options.aspectRatio,
        resolution: options.resolution,
      });

      addUsageRecord({
        type: 'video',
        model: 'veo-3.1-generate-preview',
        tokensUsed: 0,
        cost: 0.40, // rough per-8s-clip estimate for full-quality Veo 3.1
        details: `Movie Flow segment ${i + 1}/${totalSegments}`,
        username: options.username || 'unknown',
      });

      segments.push({ url: videoUrl, durationSeconds: VEO_SEGMENT_SECONDS });
      continuityFrame = await extractLastFrameBase64(videoUrl);
    } else if (options.engine === 'kling') {
      // Kling's image-to-video endpoints take a single start frame (no
      // multi-reference support like Seedance), so this behaves like Veo:
      // continuity frame once we have one, otherwise the first reference image.
      const startImage = continuityFrame ? continuityFrame : options.referenceImages[0];
      if (!startImage) {
        throw new Error('Kling needs at least one reference/start image. [ignoring loop detection]');
      }

      const scenePrompt = i === 0
        ? options.prompt
        : `${options.prompt}\n\nContinue the same scene, subject, and style seamlessly from the previous shot.`;

      const segment = await generateKlingVideo({
        prompt: scenePrompt,
        imageDataUrl: `data:image/jpeg;base64,${startImage}`,
        duration: String(KLING_SEGMENT_SECONDS) as '5' | '10',
        aspectRatio: options.aspectRatio,
        variant: options.klingVariant,
      });

      addUsageRecord({
        type: 'video',
        model: `kling-${options.klingVariant || 'v2.1-standard'}`,
        tokensUsed: 0,
        cost: segment.durationSeconds * 0.25, // rough per-second estimate
        details: `Movie Flow segment ${i + 1}/${totalSegments} (est. cost)`,
        username: options.username || 'unknown',
      });

      segments.push({ url: segment.videoUrl, durationSeconds: segment.durationSeconds });
      continuityFrame = await extractLastFrameBase64(segment.videoUrl);
    } else {
      // Seedance: first segment uses all supplied reference images for
      // character/product/style consistency; later segments add the
      // previous clip's last frame so the story continues visually.
      const imageDataUrls = i === 0
        ? options.referenceImages.map((b64) => `data:image/jpeg;base64,${b64}`)
        : [
            `data:image/jpeg;base64,${continuityFrame}`,
            ...options.referenceImages.map((b64) => `data:image/jpeg;base64,${b64}`),
          ].slice(0, 9);

      const scenePrompt = i === 0
        ? options.prompt
        : `${options.prompt}\n\nContinue the same scene, subject, and style seamlessly from the previous shot (@Image1 is the last frame of that shot).`;

      const segment = await generateSeedanceSegment({
        prompt: scenePrompt,
        imageUrls: imageDataUrls,
        resolution: options.resolution,
        aspectRatio: options.aspectRatio,
        durationSeconds: SEEDANCE_SEGMENT_SECONDS,
        generateAudio: true,
      });

      const localUrl = await downloadSeedanceVideo(segment.videoUrl);

      addUsageRecord({
        type: 'video',
        model: 'seedance-2.0',
        tokensUsed: 0,
        cost: segment.durationSeconds * 0.2,
        details: `Movie Flow segment ${i + 1}/${totalSegments} (est. cost)`,
        username: options.username || 'unknown',
      });

      segments.push({ url: localUrl, durationSeconds: segment.durationSeconds });
      continuityFrame = await extractLastFrameBase64(localUrl);
    }
  }

  options.onProgress?.({ stage: 'stitching' });
  const finalUrl = await stitchVideoClips({
    clips: segments.map((s) => ({ url: s.url })),
    onProgress: (fraction) => options.onProgress?.({ stage: 'stitching', fraction }),
  });

  options.onProgress?.({ stage: 'done' });
  return { finalUrl, segments };
};
