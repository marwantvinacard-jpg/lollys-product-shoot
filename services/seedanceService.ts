// Client-side wrapper around the `generateSeedanceSegment` callable function
// (functions/src/index.ts). This used to call fal.ai directly from the
// browser with VITE_FAL_API_KEY, exposing that key to anyone with dev tools
// open; the fal.ai credentials now live only in the Cloud Function's secret.
import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

export type SeedanceResolution = '480p' | '720p' | '1080p';
export type SeedanceAspectRatio = 'auto' | '21:9' | '16:9' | '4:3' | '1:1' | '3:4' | '9:16';

export interface SeedanceSegmentOptions {
  prompt: string;
  imageUrls: string[]; // data: URLs, up to 9 (callers cap at 5)
  resolution?: SeedanceResolution;
  aspectRatio?: SeedanceAspectRatio;
  durationSeconds?: number; // 4-15, fal rounds to nearest supported value
  generateAudio?: boolean;
  seed?: number;
}

export interface SeedanceSegmentResult {
  videoUrl: string;
  durationSeconds: number;
  seed?: number;
}

export const generateSeedanceSegment = async (
  options: SeedanceSegmentOptions
): Promise<SeedanceSegmentResult> => {
  const call = httpsCallable(functions, 'generateSeedanceSegment');
  const { data }: any = await call({
    prompt: options.prompt,
    imageDataUrls: options.imageUrls,
    resolution: options.resolution,
    aspectRatio: options.aspectRatio,
    durationSeconds: options.durationSeconds,
    generateAudio: options.generateAudio,
    seed: options.seed,
  });

  return {
    videoUrl: data.url,
    durationSeconds: data.durationSeconds,
    seed: data.seed,
  };
};

// The function already returns a Firebase Storage signed URL, which is
// directly fetchable/CORS-safe -- no separate download step needed anymore.
// Kept as a thin passthrough so movieFlowService.ts doesn't need to change.
export const downloadSeedanceVideo = async (remoteUrl: string): Promise<string> => {
  const response = await fetch(remoteUrl);
  if (!response.ok) {
    throw new Error(`Failed to download Seedance video: ${response.statusText}. [ignoring loop detection]`);
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
};
