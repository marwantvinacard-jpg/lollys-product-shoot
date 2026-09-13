// Client wrapper around the Magnific upscale callables (functions/src/index.ts's
// startImageUpscale / checkImageUpscale). Same start/poll shape as
// generateProductVideo in geminiService.ts.
import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

export type MagnificFlavor = 'sublime' | 'photo' | 'photo_denoiser';

export const upscaleImage = async (
  imageDataUrl: string,
  scaleFactor: number = 4,
  flavor: MagnificFlavor = 'photo'
): Promise<string> => {
  const start = httpsCallable(functions, 'startImageUpscale');
  const startResult: any = (await start({ imageDataUrl, scaleFactor, flavor })).data;
  const operationId = startResult.operationId;

  const check = httpsCallable(functions, 'checkImageUpscale');

  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const result: any = (await check({ operationId })).data;
    if (result.done) {
      if (result.error) throw new Error(result.error);
      return result.url as string;
    }
  }
};
