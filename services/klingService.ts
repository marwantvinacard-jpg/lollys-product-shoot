// Client-side wrapper around the `generateKlingVideo` callable function
// (functions/src/index.ts). Kling runs through the same fal.ai account/secret
// as Seedance -- no separate key or platform account needed.
import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

export type KlingVariant = 'v2.1-standard' | 'v2.1-pro' | 'v1.6-pro';

export interface KlingVideoOptions {
  prompt: string;
  imageDataUrl: string; // a single data: URL start frame
  negativePrompt?: string;
  duration?: '5' | '10';
  aspectRatio?: '16:9' | '9:16' | '1:1';
  variant?: KlingVariant;
}

export interface KlingVideoResult {
  videoUrl: string; // Firebase Storage signed URL, directly fetchable
  durationSeconds: number;
}

export const generateKlingVideo = async (options: KlingVideoOptions): Promise<KlingVideoResult> => {
  const call = httpsCallable(functions, 'generateKlingVideo');
  const { data }: any = await call({
    prompt: options.prompt,
    imageDataUrl: options.imageDataUrl,
    negativePrompt: options.negativePrompt,
    duration: options.duration,
    aspectRatio: options.aspectRatio,
    variant: options.variant,
  });

  return { videoUrl: data.url, durationSeconds: data.durationSeconds };
};
