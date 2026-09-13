// Client-side wrapper around the AI callable functions in functions/src/index.ts.
//
// This file used to hold VITE_GEMINI_API_KEY and call Gemini/Veo directly from
// the browser -- which meant the key shipped inside the client JS bundle for
// anyone to read out of dev tools. Every one of those calls now goes through
// a Firebase Cloud Function that holds the real secret server-side; the
// exported function signatures here are unchanged so nothing else in the app
// (App.tsx, MovieFlowStudio, ProductCard, the editors) needed to change.
import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

export const fileToGenerativePart = async (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (reader.result) {
        const base64String = reader.result as string;
        const base64Data = base64String.split(',')[1];
        resolve(base64Data);
      } else {
        reject(new Error("Failed to read file. [ignoring loop detection]"));
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

export const generateProductShot = async (
  images: { data: string, mimeType: string }[],
  style: string,
  options?: {
    productPrompt?: string;
    modelPrompt?: string;
    backgroundPrompt?: string;
    virtue?: string;
    productAngle?: string;
    modelPosture?: string;
    referenceImage?: { data: string, mimeType: string };
    productCategory?: string;
    productSubcategory?: string;
    locationCategory?: string;
    locationOption?: string;
    modelGender?: string;
  }
): Promise<{ url: string, usage?: any }> => {
  const call = httpsCallable(functions, 'generateProductShot');
  const { data } = await call({ images, style, options });
  return data as { url: string; usage?: any };
};

export const removeObjectFromImage = async (
  compositeImageBase64: string,
  mimeType: string = 'image/png'
): Promise<{ url: string; usage?: any }> => {
  const call = httpsCallable(functions, 'removeObjectFromImage');
  const { data } = await call({ compositeImageBase64, mimeType });
  return data as { url: string; usage?: any };
};

export const removeBackgroundFromImage = async (
  imageBase64: string,
  mimeType: string = 'image/png'
): Promise<{ url: string; usage?: any }> => {
  const call = httpsCallable(functions, 'removeBackgroundFromImage');
  const { data } = await call({ imageBase64, mimeType });
  return data as { url: string; usage?: any };
};

export const createCustomModel = async (
  prompt: string,
  gender?: string
): Promise<{ url: string; usage?: any }> => {
  const call = httpsCallable(functions, 'createCustomModel');
  const { data } = await call({ prompt, gender });
  return data as { url: string; usage?: any };
};

export const editCustomModelImage = async (
  imageBase64: string,
  instruction: string,
  mimeType: string = 'image/png'
): Promise<{ url: string; usage?: any }> => {
  const call = httpsCallable(functions, 'editCustomModelImage');
  const { data } = await call({ imageBase64, instruction, mimeType });
  return data as { url: string; usage?: any };
};

export const saveCustomModel = async (
  name: string,
  gender: string,
  prompt: string,
  imageBase64: string
): Promise<{ id: string }> => {
  const call = httpsCallable(functions, 'saveCustomModel');
  const { data } = await call({ name, gender, prompt, imageBase64 });
  return data as { id: string };
};

export const deleteCustomModel = async (modelId: string): Promise<void> => {
  const call = httpsCallable(functions, 'deleteCustomModel');
  await call({ modelId });
};

export const generateProductVideo = async (
  startImageBase64: string,
  endImageBase64: string | undefined,
  prompt: string,
  options?: {
    aspectRatio?: '16:9' | '9:16' | '1:1';
    resolution?: '720p' | '1080p';
  }
): Promise<string> => {
  const start = httpsCallable(functions, 'startVideoGeneration');
  const startResult: any = (await start({ startImageBase64, endImageBase64, prompt, options })).data;
  const operationId = startResult.operationId;

  const check = httpsCallable(functions, 'checkVideoGeneration');

  // Poll until the server reports the video is done (either a Storage URL or
  // an error). Same shape as the old direct-SDK polling loop this replaced.
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const result: any = (await check({ operationId })).data;
    if (result.done) {
      if (result.error) throw new Error(result.error);
      return result.url as string;
    }
  }
};
