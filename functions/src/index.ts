/**
 * Server-side proxy for every paid AI call the app makes.
 *
 * Why this file exists: the client used to hold VITE_GEMINI_API_KEY /
 * VITE_FAL_API_KEY directly, which Vite inlines into the shipped JS bundle --
 * anyone who opened dev tools could read them out and run up the bill on
 * someone else's account. These callable functions hold the real secrets
 * server-side; the client only ever calls these by name and never sees a key.
 *
 * Every function requires a signed-in Firebase Auth user (see services/firebase.ts
 * on the client) and enforces a simple per-user daily cap via Firestore so one
 * account can't exhaust the whole project's quota.
 */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, Transaction } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { GoogleGenAI } from '@google/genai';
import { fal } from '@fal-ai/client';
import Stripe from 'stripe';
import * as Sentry from '@sentry/node';

initializeApp();
const db = getFirestore();
const bucket = () => getStorage().bucket();

const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');
const FAL_API_KEY = defineSecret('FAL_API_KEY');
const STRIPE_SECRET_KEY = defineSecret('STRIPE_SECRET_KEY');
const STRIPE_WEBHOOK_SECRET = defineSecret('STRIPE_WEBHOOK_SECRET');
const SENTRY_DSN = defineSecret('SENTRY_DSN');

// Server-side crash reporting, mirroring the client's services/monitoring.ts.
// Lazily initialized on first use per warm function instance (secret values
// from defineSecret() are only readable inside a function invocation, never
// at module load) -- cheap to call repeatedly since Sentry.init is a no-op
// after the first call with the same DSN.
let sentryInitialized = false;
const reportServerError = (error: unknown, context?: Record<string, unknown>) => {
  const dsn = SENTRY_DSN.value();
  if (!dsn) return;
  if (!sentryInitialized) {
    Sentry.init({ dsn, tracesSampleRate: 0.1 });
    sentryInitialized = true;
  }
  Sentry.captureException(error, context ? { extra: context } : undefined);
};

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const requireAuth = (request: { auth?: { uid: string } | null }): string => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Sign in to use this feature.');
  }
  return request.auth.uid;
};

// Free daily allowance, same for every account regardless of billing status.
// Once a user exhausts this, checkAndIncrementRateLimit falls through to
// spending purchased credits (see the Stripe section near the bottom of this
// file) instead of hard-blocking them.
const DAILY_LIMITS: Record<string, number> = {
  image: 200,
  video: 20,
};

// How many purchased credits one generation costs once the free daily
// allowance is used up. Video costs more than image because it's a
// materially more expensive AI call.
const CREDIT_COST: Record<string, number> = {
  image: 1,
  video: 10,
};

// Short-window burst protection, separate from the daily cost cap above: it
// stops a buggy client or a scripted attacker from firing dozens of requests
// in a few seconds (which the daily cap alone wouldn't catch until the 200th
// call). Firestore TTL on `expiresAt` (configure once in the console on the
// rate_limit_bursts collection) keeps these documents from accumulating.
const BURST_LIMITS: Record<keyof typeof DAILY_LIMITS, { max: number; windowSeconds: number }> = {
  image: { max: 6, windowSeconds: 60 },
  video: { max: 2, windowSeconds: 60 },
};

const checkBurstLimit = async (uid: string, kind: keyof typeof DAILY_LIMITS) => {
  const { max, windowSeconds } = BURST_LIMITS[kind];
  const windowId = Math.floor(Date.now() / (windowSeconds * 1000));
  const ref = db.collection('rate_limit_bursts').doc(`${uid}_${kind}_${windowId}`);

  await db.runTransaction(async (tx: Transaction) => {
    const snap = await tx.get(ref);
    const count = snap.exists ? (snap.data()?.count ?? 0) : 0;
    if (count >= max) {
      throw new HttpsError(
        'resource-exhausted',
        `You're generating ${kind}s too quickly (limit ${max} per ${windowSeconds}s). Please wait a moment and try again.`
      );
    }
    tx.set(ref, {
      count: count + 1,
      expiresAt: new Date(Date.now() + windowSeconds * 1000 * 2),
    }, { merge: true });
  });
};

const checkAndIncrementRateLimit = async (uid: string, kind: keyof typeof DAILY_LIMITS) => {
  await checkBurstLimit(uid, kind);

  const day = new Date().toISOString().slice(0, 10);
  const ref = db.collection('rate_limits').doc(`${uid}_${kind}_${day}`);
  const limit = DAILY_LIMITS[kind];
  const creditCost = CREDIT_COST[kind];
  const billingRef = db.collection('billing').doc(uid);

  await db.runTransaction(async (tx: Transaction) => {
    const snap = await tx.get(ref);
    const count = snap.exists ? (snap.data()?.count ?? 0) : 0;

    if (count < limit) {
      // Still within the free daily allowance.
      tx.set(ref, { count: count + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return;
    }

    // Free allowance used up for today -- try to spend purchased credits.
    const billingSnap = await tx.get(billingRef);
    const credits = billingSnap.exists ? (billingSnap.data()?.credits ?? 0) : 0;
    if (credits < creditCost) {
      throw new HttpsError(
        'resource-exhausted',
        `Daily free ${kind} limit reached (${limit}/day) and you don't have enough credits (need ${creditCost}, have ${credits}). Buy more credits or wait until tomorrow.`
      );
    }

    tx.update(billingRef, { credits: FieldValue.increment(-creditCost) });
    tx.set(ref, { count: count + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
};

const getAiClient = (apiKey: string) => new GoogleGenAI({ apiKey });

// onCall() masks any error we don't explicitly throw as HttpsError behind a
// generic "internal" message (a deliberate Functions safety default, so
// stack traces/internals never leak to the client). Quota/rate-limit errors
// are worth surfacing plainly so the user (and whoever's watching the bill)
// knows what happened, so we detect and rethrow those specifically here;
// anything else still gets the generic treatment.
const describeAiError = (error: any): { isQuotaError: boolean; message: string } => {
  let isQuotaError = error?.status === 429 || error?.code === 429;
  if (String(error?.status).includes('RESOURCE_EXHAUSTED')) isQuotaError = true;
  if (error?.error?.code === 429 || String(error?.error?.status).includes('RESOURCE_EXHAUSTED')) isQuotaError = true;

  let details = '';
  try { details = JSON.stringify(error || {}); } catch { details = 'Circular or non-serializable error object'; }
  const msg = (error?.message || '') + details;
  if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('Quota')) isQuotaError = true;

  if (isQuotaError) {
    return { isQuotaError, message: 'Quota Exceeded: The generation limit for this API key has been reached. Please check billing or try again later.' };
  }
  return { isQuotaError, message: error?.message || 'Generation failed. Please try again.' };
};

// onCall() masks any error we don't explicitly throw as HttpsError behind a
// generic "internal" message (a deliberate Functions safety default, so
// stack traces/internals never leak to the client). Quota/rate-limit errors
// are worth surfacing plainly so the user (and whoever's watching the bill)
// knows what happened, so we detect and rethrow those specifically here;
// anything else still gets the generic treatment.
const rethrowAiError = (error: any): never => {
  if (error instanceof HttpsError) throw error;
  const { isQuotaError, message } = describeAiError(error);
  if (!isQuotaError) {
    console.error('AI call failed:', error);
    reportServerError(error, { source: 'rethrowAiError' });
  }
  throw new HttpsError(isQuotaError ? 'resource-exhausted' : 'internal', message);
};

// ---------------------------------------------------------------------------
// Image generation prompts (ported from services/geminiService.ts)
// ---------------------------------------------------------------------------

const BASE_SYSTEM_INSTRUCTION = `
You are a world-class professional product photographer and e-commerce visual expert.
Your goal is to create clean, high-end studio photography suitable for luxury online stores (e.g., Net-a-Porter, Apple, Sephora).
1. FIX: Eliminate noise, bad lighting, and amateur blur.
2. BACKGROUND: Use only clean, neutral studio backgrounds (white, off-white, soft beige, or soft grey). NO sci-fi, neon, or futuristic elements unless explicitly requested by the prompt style.
3. LIGHTING: Use professional soft-box lighting, rim lighting, and natural window light simulations.
4. MODELING: Models must look professional, natural, and diverse. Focus must remain on the product.
Constraint: Maintain the product's exact shape, logo, and branding. No text, no watermarks.
`;

const PROMPTS: Record<string, string> = {
  studio_front: `
    Generate a "Front View" 4K.
    Action: Clean product isolation.
    Composition: Perfectly centered, straight-on front view.
    Lighting: Even, bright, shadow-less commercial lighting.
    Background: Professional studio setting tailored to the product's essence.
    Vibe: Official store listing, trustworthy, clear, high-detail.
  `,
  studio_right: `
    Generate a "Right Side View" 4K.
    Action: Clean product isolation.
    Composition: Perfectly centered, 90-degree right side profile view.
    Lighting: Even, bright, shadow-less commercial lighting.
    Background: Professional studio setting tailored to the product's essence.
    Vibe: Official store listing, trustworthy, clear, high-detail.
  `,
  studio_back: `
    Generate a "Back View" 4K.
    Action: Clean product isolation.
    Composition: Perfectly centered, straight-on back view.
    Lighting: Even, bright, shadow-less commercial lighting.
    Background: Professional studio setting tailored to the product's essence.
    Vibe: Official store listing, trustworthy, clear, high-detail.
  `,
  studio_left: `
    Generate a "Left Side View" 4K.
    Action: Clean product isolation.
    Composition: Perfectly centered, 90-degree left side profile view.
    Lighting: Even, bright, shadow-less commercial lighting.
    Background: Professional studio setting tailored to the product's essence.
    Vibe: Official store listing, trustworthy, clear, high-detail.
  `,
  model_pose_classic: `
    Generate a "Dynamic Classic Studio Portrait" 4K.
    Action: Professional model actively engaging with the product (e.g., holding it up to light, wearing it with movement).
    Pose: Fluid, elegant motion, not stiff. Showcasing key features.
    Attire: Solid colors, timeless minimalism, smart casual.
    Background: Clean studio wall.
    Vibe: High-end catalog, active elegance, authentic.
  `,
  model_pose_premium: `
    Generate a "Futuristic High-Fashion Editorial" 4K.
    Action: Model showcasing the product with bold, dynamic, avant-garde poses.
    Pose: Angular, confident, high-fashion movement.
    Lighting: Cinematic, modern, slightly cool or dramatic contrast.
    Background: Minimalist modern architecture or sleek metallic textures.
    Vibe: Next-gen fashion magazine, bold, premium.
  `,
  model_interact_classic: `
    Generate a "Classic Interaction Editorial" 4K.
    Action: Model authentically using the product (e.g., typing, applying cream, adjusting jewelry).
    Style: Timeless, elegant, soft lighting, natural poses.
    Background: Warm, inviting studio setting.
    Vibe: Authentic, trustworthy, traditional luxury.
  `,
  model_interact_futuristic: `
    Generate a "Futuristic Editorial Interaction" 4K.
    Action: Model interacting with the product in a high-fashion, future-forward style.
    Style: Avant-garde, sleek, bold geometry, modern lighting.
    Background: Minimalist modern studio with metallic or cool-toned accents.
    Vibe: Innovative, next-gen, edgy, premium.
  `,

  // Vehicle category (cars, motorcycles) -- no model shots, since nobody
  // photographs a person "holding" a car the way they'd hold a handbag.
  vehicle_exterior_front: `
    Generate a "Front Three-Quarter Exterior" 4K.
    Composition: Classic automotive front three-quarter angle, low-to-eye camera height.
    Lighting: Even, glossy commercial studio lighting with clean reflections on the bodywork.
    Background: Professional studio setting tailored to the vehicle's essence.
    Vibe: Dealership hero shot, premium, showroom-ready.
  `,
  vehicle_exterior_side: `
    Generate a "Side Profile Exterior" 4K.
    Composition: Perfectly centered 90-degree side profile, full vehicle in frame.
    Lighting: Even, glossy commercial studio lighting with clean reflections on the bodywork.
    Background: Professional studio setting tailored to the vehicle's essence.
    Vibe: Dealership hero shot, premium, showroom-ready.
  `,
  vehicle_exterior_rear: `
    Generate a "Rear Three-Quarter Exterior" 4K.
    Composition: Classic automotive rear three-quarter angle.
    Lighting: Even, glossy commercial studio lighting with clean reflections on the bodywork.
    Background: Professional studio setting tailored to the vehicle's essence.
    Vibe: Dealership hero shot, premium, showroom-ready.
  `,
  vehicle_interior: `
    Generate an "Interior Cabin" 4K.
    Composition: Wide dashboard/cabin view from the driver-side door, showing seats and dashboard.
    Lighting: Soft, even interior lighting revealing material textures.
    Vibe: Premium dealership interior listing photo.
  `,
  vehicle_detail: `
    Generate a "Detail Close-Up" 4K.
    Composition: Close-up on a distinctive feature (wheel, badge, headlight, or grille).
    Lighting: Dramatic, glossy commercial lighting emphasizing texture and craftsmanship.
    Vibe: High-end automotive editorial detail shot.
  `,

  // Property category (houses, buildings, interiors) -- no model shots.
  property_exterior: `
    Generate an "Exterior Hero Shot" 4K.
    Composition: Wide-angle architectural exterior view, straight-on or gentle three-quarter angle.
    Lighting: Bright, natural daylight (golden hour warmth where appropriate), blue sky.
    Vibe: Premium real-estate listing hero photo.
  `,
  property_interior: `
    Generate an "Interior Wide Shot" 4K.
    Composition: Wide-angle interior view showing depth of the room, corrected vertical lines.
    Lighting: Bright, natural, evenly lit interior; warm and inviting.
    Vibe: Premium real-estate listing interior photo.
  `,
  property_detail: `
    Generate an "Architectural Detail Shot" 4K.
    Composition: Close/medium shot on a distinctive architectural feature (facade texture, doorway, staircase, or fixture).
    Lighting: Natural, flattering light emphasizing material and craftsmanship.
    Vibe: High-end architectural/real-estate editorial detail shot.
  `,
};

const MASK_HIGHLIGHT_INSTRUCTION = `
You are an expert photo retoucher performing object removal (inpainting).
The provided image has one or more regions painted over in a solid bright magenta (#FF00FF) highlight color.
Task: Completely remove whatever is underneath every magenta-highlighted region and seamlessly reconstruct what should naturally be there instead (background, texture, pattern), matching the surrounding lighting, color, shadows, and perspective exactly.
Rules:
- Do not leave any trace of magenta coloring in the output.
- Do not alter anything outside the highlighted regions.
- Do not add new objects, text, logos, or watermarks.
- Output only the fully retouched photo, same framing and dimensions as the input.
`;

const BACKGROUND_REMOVAL_INSTRUCTION = `
You are an expert photo retoucher performing precise background removal.
Task: Isolate the main subject exactly as-is (do not alter its shape, color, texture, or details) and replace everything else with a clean, solid, pure white (#FFFFFF) background.
Rules:
- Keep subject edges crisp and natural (preserve fine details like hair or fabric texture).
- Do not add shadows, reflections, or any new elements.
- Do not alter the subject itself in any way.
- Output only the retouched photo, same framing and dimensions as the input.
`;

// Gemini applies its own safety filtering by default (hate speech, sexual
// content, dangerous content, harassment) -- we don't override those
// settings. This just makes a block *visible* as a clear message instead of
// a generic "no image returned" error, so both the user and anyone watching
// logs can tell a request was refused for content-safety reasons rather than
// a transient failure.
const extractImagePart = (response: any): { url: string; usage?: any } => {
  if (response.promptFeedback?.blockReason) {
    throw new HttpsError(
      'invalid-argument',
      `This request was blocked by content safety filters (${response.promptFeedback.blockReason}). Please adjust your prompt or images.`
    );
  }

  const candidate = response.candidates?.[0];
  if (candidate?.finishReason === 'SAFETY' || candidate?.finishReason === 'PROHIBITED_CONTENT') {
    throw new HttpsError('invalid-argument', 'This request was blocked by content safety filters. Please adjust your prompt or images.');
  }

  const content = candidate?.content;
  if (content?.parts) {
    for (const part of content.parts) {
      if (part.inlineData?.data) {
        return {
          url: `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`,
          usage: response.usageMetadata,
        };
      }
    }
  }
  throw new HttpsError('internal', 'The model did not return an image. Please try again.');
};

// ---------------------------------------------------------------------------
// generateProductShot
// ---------------------------------------------------------------------------

export const generateProductShot = onCall({ secrets: [GEMINI_API_KEY, SENTRY_DSN], timeoutSeconds: 120 }, async (request) => {
  const uid = requireAuth(request);
  await checkAndIncrementRateLimit(uid, 'image');

  const { images, style, options } = request.data as {
    images: { data: string; mimeType: string }[];
    style: keyof typeof PROMPTS;
    options?: {
      productPrompt?: string;
      modelPrompt?: string;
      backgroundPrompt?: string;
      virtue?: string;
      productAngle?: string;
      modelPosture?: string;
      referenceImage?: { data: string; mimeType: string };
      productCategory?: string; // e.g. "Vehicles", "Jewelry & Accessories"
      productSubcategory?: string; // e.g. "Cars"
      locationCategory?: string; // e.g. "Outdoor"
      locationOption?: string; // e.g. "Beach"
      modelGender?: string; // "Male" | "Female" | "Unspecified"
    };
  };

  if (!PROMPTS[style]) throw new HttpsError('invalid-argument', `Unknown style: ${style}`);

  const ai = getAiClient(GEMINI_API_KEY.value());
  let prompt = BASE_SYSTEM_INSTRUCTION + '\n\n' + PROMPTS[style];

  if (options?.virtue && options.virtue !== 'Default') prompt += `\n    Virtue/Style Override: ${options.virtue} style.`;
  if (options?.productAngle && options.productAngle !== 'Default') prompt += `\n    Product Angle Override: ${options.productAngle} view.`;
  if (options?.modelPosture) prompt += `\n    Model Posture/Pose Details: ${options.modelPosture}`;
  if (options?.productPrompt) prompt += `\n    Product Details: ${options.productPrompt}`;
  if (options?.modelPrompt) prompt += `\n    Model Details: ${options.modelPrompt}`;
  if (options?.modelGender && options.modelGender !== 'Unspecified') prompt += `\n    Model Gender: ${options.modelGender}.`;
  if (options?.backgroundPrompt) prompt += `\n    Background Details: ${options.backgroundPrompt}`;
  if (options?.productSubcategory) prompt += `\n    Product Category: ${options.productSubcategory} (part of ${options?.productCategory || 'its category'}). Tailor styling, props, and composition to what's conventional for this category.`;
  if (options?.locationOption && options.locationOption !== 'Custom') prompt += `\n    Setting: ${options.locationOption} (${options?.locationCategory || 'Location'}) instead of a plain studio background, if compatible with the requested shot type.`;

  if (images?.length > 0) {
    const productLabel = options?.productSubcategory || 'PRODUCT';
    prompt += `\n    Input Images Context:
    Image 1: The ${productLabel.toUpperCase()}. Maintain its details, texture, and shape exactly.
    Image 2 (if present): The MODEL FACE. You MUST use this face for the model in the generated image. Blend it naturally but keep the facial features recognizable.`;
  }
  if (options?.referenceImage) {
    prompt += `\n    REFERENCE IMAGE Included: A style reference image is provided. Adapt the background, lighting, color palette, and overall aesthetic vibe to match this reference image, while still satisfying the main instructions for the product and model.`;
  }

  const parts: any[] = [{ text: prompt }];
  if (options?.referenceImage) {
    parts.unshift({ inlineData: { data: options.referenceImage.data, mimeType: options.referenceImage.mimeType } });
  }
  for (const img of images || []) {
    parts.unshift({ inlineData: { data: img.data, mimeType: img.mimeType } });
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-image-preview',
      contents: { parts },
      config: { imageConfig: { imageSize: '1K', aspectRatio: '1:1' } },
    });
    return extractImagePart(response);
  } catch (error) {
    return rethrowAiError(error);
  }
});

// ---------------------------------------------------------------------------
// removeObjectFromImage / removeBackgroundFromImage
// ---------------------------------------------------------------------------

export const removeObjectFromImage = onCall({ secrets: [GEMINI_API_KEY, SENTRY_DSN], timeoutSeconds: 120 }, async (request) => {
  const uid = requireAuth(request);
  await checkAndIncrementRateLimit(uid, 'image');

  const { compositeImageBase64, mimeType } = request.data as { compositeImageBase64: string; mimeType?: string };
  const ai = getAiClient(GEMINI_API_KEY.value());

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-image-preview',
      contents: { parts: [{ inlineData: { data: compositeImageBase64, mimeType: mimeType || 'image/png' } }, { text: MASK_HIGHLIGHT_INSTRUCTION }] },
      config: { imageConfig: { imageSize: '1K' } },
    });
    return extractImagePart(response);
  } catch (error) {
    return rethrowAiError(error);
  }
});

export const removeBackgroundFromImage = onCall({ secrets: [GEMINI_API_KEY, SENTRY_DSN], timeoutSeconds: 120 }, async (request) => {
  const uid = requireAuth(request);
  await checkAndIncrementRateLimit(uid, 'image');

  const { imageBase64, mimeType } = request.data as { imageBase64: string; mimeType?: string };
  const ai = getAiClient(GEMINI_API_KEY.value());

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-image-preview',
      contents: { parts: [{ inlineData: { data: imageBase64, mimeType: mimeType || 'image/png' } }, { text: BACKGROUND_REMOVAL_INSTRUCTION }] },
      config: { imageConfig: { imageSize: '1K' } },
    });
    return extractImagePart(response);
  } catch (error) {
    return rethrowAiError(error);
  }
});

// ---------------------------------------------------------------------------
// Custom Model Studio: create a reusable AI model character from a text
// prompt, refine it with follow-up instructions while keeping the same
// person, then save it to the user's personal library. Once saved, its
// reference portrait is fed back into generateProductShot's existing
// "Image 2 = MODEL FACE, keep it recognizable" input slot -- no separate
// identity-lock mechanism is needed for normal generation, only for editing
// the reference portrait itself (below).
// ---------------------------------------------------------------------------

const CUSTOM_MODEL_SYSTEM_INSTRUCTION = `
You are generating a reference portrait for a fictional AI model character, to be reused consistently across future photoshoots.
Composition: head-and-shoulders to half-body, facing camera, neutral relaxed expression, plain neutral studio background (soft grey or white).
Lighting: even, flattering, professional studio lighting.
Style: photorealistic, high-detail, professional photography.
Constraint: no text, no watermarks, no props.
`;

export const createCustomModel = onCall({ secrets: [GEMINI_API_KEY, SENTRY_DSN], timeoutSeconds: 120 }, async (request) => {
  const uid = requireAuth(request);
  await checkAndIncrementRateLimit(uid, 'image');

  const { prompt, gender } = request.data as { prompt: string; gender?: string };
  if (!prompt) throw new HttpsError('invalid-argument', 'prompt is required.');

  const ai = getAiClient(GEMINI_API_KEY.value());
  let fullPrompt = CUSTOM_MODEL_SYSTEM_INSTRUCTION;
  if (gender && gender !== 'Unspecified') fullPrompt += `\nGender: ${gender}.`;
  fullPrompt += `\nCharacter description: ${prompt}`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-image-preview',
      contents: { parts: [{ text: fullPrompt }] },
      config: { imageConfig: { imageSize: '1K', aspectRatio: '1:1' } },
    });
    return extractImagePart(response);
  } catch (error) {
    return rethrowAiError(error);
  }
});

const MODEL_EDIT_SYSTEM_INSTRUCTION = `
You are editing a reference portrait of a specific fictional AI model character.
CRITICAL: Preserve this person's face, identity, facial features, and body proportions EXACTLY as shown in the input image -- this must still look like the same person.
Apply ONLY the following requested change, and nothing else:
`;

export const editCustomModelImage = onCall({ secrets: [GEMINI_API_KEY, SENTRY_DSN], timeoutSeconds: 120 }, async (request) => {
  const uid = requireAuth(request);
  await checkAndIncrementRateLimit(uid, 'image');

  const { imageBase64, mimeType, instruction } = request.data as {
    imageBase64: string;
    mimeType?: string;
    instruction: string;
  };
  if (!imageBase64 || !instruction) throw new HttpsError('invalid-argument', 'imageBase64 and instruction are required.');

  const base64 = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
  const ai = getAiClient(GEMINI_API_KEY.value());
  const fullPrompt = `${MODEL_EDIT_SYSTEM_INSTRUCTION}${instruction}`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-image-preview',
      contents: { parts: [{ inlineData: { data: base64, mimeType: mimeType || 'image/png' } }, { text: fullPrompt }] },
      config: { imageConfig: { imageSize: '1K' } },
    });
    return extractImagePart(response);
  } catch (error) {
    return rethrowAiError(error);
  }
});

// A saved model is meant to be a durable, reusable part of the user's
// library (unlike the 7-day signed URLs used for transient generation
// results elsewhere in this file), so it gets a much longer expiry.
const CUSTOM_MODEL_URL_EXPIRY_MS = 1000 * 60 * 60 * 24 * 365 * 10; // ~10 years

export const saveCustomModel = onCall({ timeoutSeconds: 60 }, async (request) => {
  const uid = requireAuth(request);

  const { name, gender, prompt, imageBase64 } = request.data as {
    name: string;
    gender?: string;
    prompt: string;
    imageBase64: string; // data: URL or raw base64
  };
  if (!imageBase64) throw new HttpsError('invalid-argument', 'imageBase64 is required.');

  const base64 = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
  const buffer = Buffer.from(base64, 'base64');

  const modelId = db.collection('custom_models').doc().id;
  const filePath = `custom-models/${uid}/${modelId}.png`;
  const file = bucket().file(filePath);
  await file.save(buffer, { contentType: 'image/png' });
  const [imageUrl] = await file.getSignedUrl({ action: 'read', expires: Date.now() + CUSTOM_MODEL_URL_EXPIRY_MS });

  const doc = {
    uid,
    name: name || 'My Model',
    gender: gender || 'Unspecified',
    prompt: prompt || '',
    imageUrl,
    createdAt: FieldValue.serverTimestamp(),
  };
  await db.collection('custom_models').doc(modelId).set(doc);

  return { id: modelId, ...doc, createdAt: Date.now() };
});

export const deleteCustomModel = onCall({ timeoutSeconds: 30 }, async (request) => {
  const uid = requireAuth(request);
  const { modelId } = request.data as { modelId: string };

  const ref = db.collection('custom_models').doc(modelId);
  const snap = await ref.get();
  if (!snap.exists) return { deleted: false };
  if (snap.data()?.uid !== uid) throw new HttpsError('permission-denied', 'This model belongs to another account.');

  await bucket().file(`custom-models/${uid}/${modelId}.png`).delete({ ignoreNotFound: true });
  await ref.delete();
  return { deleted: true };
});

// ---------------------------------------------------------------------------
// Veo video: start + poll. Split in two calls because generation can take
// several minutes -- far longer than we want a single client HTTP request
// held open -- and the finished video (tens of MB) is uploaded to Firebase
// Storage server-side rather than round-tripped through a callable response.
// ---------------------------------------------------------------------------

export const startVideoGeneration = onCall({ secrets: [GEMINI_API_KEY, SENTRY_DSN], timeoutSeconds: 60 }, async (request) => {
  const uid = requireAuth(request);
  await checkAndIncrementRateLimit(uid, 'video');

  const { startImageBase64, endImageBase64, prompt, options } = request.data as {
    startImageBase64: string;
    endImageBase64?: string;
    prompt: string;
    options?: { aspectRatio?: '16:9' | '9:16' | '1:1'; resolution?: '720p' | '1080p' };
  };

  const ai = getAiClient(GEMINI_API_KEY.value());
  let aspectRatio = options?.aspectRatio || '9:16';
  if (aspectRatio === '1:1') aspectRatio = '9:16';

  const config: any = {
    numberOfVideos: 1,
    resolution: options?.resolution || '1080p',
    aspectRatio: aspectRatio as '16:9' | '9:16',
  };
  if (endImageBase64) config.lastFrame = { imageBytes: endImageBase64, mimeType: 'image/jpeg' };

  let operation;
  try {
    operation = await ai.models.generateVideos({
      model: 'veo-3.1-generate-preview',
      prompt,
      image: { imageBytes: startImageBase64, mimeType: 'image/jpeg' },
      config,
    });
  } catch (error) {
    return rethrowAiError(error);
  }

  const operationId = db.collection('video_operations').doc().id;
  await db.collection('video_operations').doc(operationId).set({
    uid,
    status: 'pending',
    operationName: operation.name,
    createdAt: FieldValue.serverTimestamp(),
  });

  return { operationId };
});

export const checkVideoGeneration = onCall({ secrets: [GEMINI_API_KEY, SENTRY_DSN], timeoutSeconds: 300 }, async (request) => {
  const uid = requireAuth(request);
  const { operationId } = request.data as { operationId: string };

  const ref = db.collection('video_operations').doc(operationId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Unknown video operation.');
  const doc = snap.data()!;
  if (doc.uid !== uid) throw new HttpsError('permission-denied', 'This operation belongs to another account.');

  if (doc.status === 'completed') return { done: true, url: doc.downloadUrl };
  if (doc.status === 'failed') return { done: true, error: doc.error || 'Video generation failed.' };

  const ai = getAiClient(GEMINI_API_KEY.value());
  let operation;
  try {
    operation = await ai.operations.getVideosOperation({ operation: { name: doc.operationName } as any });
  } catch (error) {
    const { message } = describeAiError(error);
    await ref.update({ status: 'failed', error: message });
    return { done: true, error: message };
  }

  if (!operation.done) {
    return { done: false };
  }

  const videoUri = operation.response?.generatedVideos?.[0]?.video?.uri;
  if (!videoUri) {
    await ref.update({ status: 'failed', error: 'Video generation finished but returned no video.' });
    return { done: true, error: 'Video generation finished but returned no video.' };
  }

  try {
    const res = await fetch(videoUri, { headers: { 'x-goog-api-key': GEMINI_API_KEY.value() } });
    if (!res.ok) throw new Error(`Failed to download generated video: ${res.statusText}`);
    const buffer = Buffer.from(await res.arrayBuffer());

    const filePath = `generated-videos/${uid}/${operationId}.mp4`;
    const file = bucket().file(filePath);
    await file.save(buffer, { contentType: 'video/mp4' });
    const [downloadUrl] = await file.getSignedUrl({ action: 'read', expires: Date.now() + 1000 * 60 * 60 * 24 * 7 });

    await ref.update({ status: 'completed', downloadUrl, completedAt: FieldValue.serverTimestamp() });
    return { done: true, url: downloadUrl };
  } catch (err: any) {
    await ref.update({ status: 'failed', error: err?.message || 'Failed to store generated video.' });
    return { done: true, error: err?.message || 'Failed to store generated video.' };
  }
});

// ---------------------------------------------------------------------------
// Shared fal.ai result handling: download the finished clip and re-host it in
// Firebase Storage (same reasoning as the Veo path -- signed URL out, no raw
// video bytes round-tripped through the callable response).
// ---------------------------------------------------------------------------

const storeFalVideo = async (uid: string, remoteUrl: string, providerLabel: string) => {
  const videoRes = await fetch(remoteUrl);
  if (!videoRes.ok) throw new HttpsError('internal', `Failed to download ${providerLabel} video: ${videoRes.statusText}`);
  const buffer = Buffer.from(await videoRes.arrayBuffer());

  const opId = db.collection('video_operations').doc().id;
  const filePath = `generated-videos/${uid}/${opId}.mp4`;
  const file = bucket().file(filePath);
  await file.save(buffer, { contentType: 'video/mp4' });
  const [downloadUrl] = await file.getSignedUrl({ action: 'read', expires: Date.now() + 1000 * 60 * 60 * 24 * 7 });
  return downloadUrl;
};

// ---------------------------------------------------------------------------
// Seedance (fal.ai) proxy
// ---------------------------------------------------------------------------

export const generateSeedanceSegment = onCall({ secrets: [FAL_API_KEY, SENTRY_DSN], timeoutSeconds: 540 }, async (request) => {
  const uid = requireAuth(request);
  await checkAndIncrementRateLimit(uid, 'video');

  fal.config({ credentials: FAL_API_KEY.value() });

  const { prompt, imageDataUrls, resolution, aspectRatio, durationSeconds, generateAudio, seed } = request.data as {
    prompt: string;
    imageDataUrls: string[]; // data: URLs only -- the client never has a fal.ai storage URL to hand us
    resolution?: '480p' | '720p' | '1080p';
    aspectRatio?: string;
    durationSeconds?: number;
    generateAudio?: boolean;
    seed?: number;
  };

  const uploadedUrls = await Promise.all(
    (imageDataUrls || []).slice(0, 9).map(async (dataUrl) => {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      return fal.storage.upload(blob);
    })
  );

  let durationParam = 'auto';
  if (durationSeconds) durationParam = String(Math.min(15, Math.max(4, Math.round(durationSeconds))));

  let result: any;
  try {
    result = await fal.subscribe('bytedance/seedance-2.0/reference-to-video', {
      input: {
        prompt,
        image_urls: uploadedUrls,
        resolution: resolution || '1080p',
        duration: durationParam,
        aspect_ratio: aspectRatio || '16:9',
        generate_audio: generateAudio ?? true,
        ...(seed !== undefined ? { seed } : {}),
      },
      logs: false,
    });
  } catch (error) {
    return rethrowAiError(error);
  }

  const data = result?.data ?? result;
  const remoteUrl = data?.video?.url;
  if (!remoteUrl) throw new HttpsError('internal', 'Seedance did not return a video for this segment.');

  const downloadUrl = await storeFalVideo(uid, remoteUrl, 'Seedance');
  return { url: downloadUrl, durationSeconds: durationSeconds || 8, seed: data?.seed };
});

// ---------------------------------------------------------------------------
// Kling (fal.ai) proxy -- same FAL_API_KEY as Seedance, different model.
// Kling's image-to-video endpoints take a single start image (not a
// reference set like Seedance), so this only ever uploads one image.
// Model path/version names on fal.ai occasionally change; if generation
// starts failing with a "not found" style error, check
// https://fal.ai/models?keywords=kling for the current path and update
// KLING_VARIANTS below -- nothing else needs to change.
// ---------------------------------------------------------------------------

const KLING_VARIANTS = {
  'v2.1-standard': 'fal-ai/kling-video/v2.1/standard/image-to-video',
  'v2.1-pro': 'fal-ai/kling-video/v2.1/pro/image-to-video',
  'v1.6-pro': 'fal-ai/kling-video/v1.6/pro/image-to-video',
} as const;
export type KlingVariant = keyof typeof KLING_VARIANTS;

export const generateKlingVideo = onCall({ secrets: [FAL_API_KEY, SENTRY_DSN], timeoutSeconds: 540 }, async (request) => {
  const uid = requireAuth(request);
  await checkAndIncrementRateLimit(uid, 'video');

  fal.config({ credentials: FAL_API_KEY.value() });

  const { prompt, imageDataUrl, negativePrompt, duration, aspectRatio, variant } = request.data as {
    prompt: string;
    imageDataUrl: string; // single start image, data: URL
    negativePrompt?: string;
    duration?: '5' | '10';
    aspectRatio?: '16:9' | '9:16' | '1:1';
    variant?: KlingVariant;
  };

  const modelPath = KLING_VARIANTS[variant || 'v2.1-standard'];
  if (!modelPath) throw new HttpsError('invalid-argument', `Unknown Kling variant: ${variant}`);

  const res = await fetch(imageDataUrl);
  const blob = await res.blob();
  const imageUrl = await fal.storage.upload(blob);

  let result: any;
  try {
    result = await fal.subscribe(modelPath, {
      input: {
        prompt,
        image_url: imageUrl,
        duration: duration || '5',
        aspect_ratio: aspectRatio || '16:9',
        ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
      },
      logs: false,
    });
  } catch (error) {
    return rethrowAiError(error);
  }

  const data = result?.data ?? result;
  const remoteUrl = data?.video?.url;
  if (!remoteUrl) throw new HttpsError('internal', 'Kling did not return a video.');

  const downloadUrl = await storeFalVideo(uid, remoteUrl, 'Kling');
  return { url: downloadUrl, durationSeconds: Number(duration || '5') };
});

// ---------------------------------------------------------------------------
// Magnific (magnific.com) proxy -- AI upscaling/enhancement, same async
// start/poll shape as the Veo video pipeline above. Precision mode is used
// (not Creative) because it stays faithful to the source product photo
// instead of reinterpreting it.
// ---------------------------------------------------------------------------

const MAGNIFIC_API_KEY = defineSecret('MAGNIFIC_API_KEY');
const MAGNIFIC_BASE_URL = 'https://api.magnific.com/v1/ai/image-upscaler-precision-v2';

export const startImageUpscale = onCall({ secrets: [MAGNIFIC_API_KEY, SENTRY_DSN], timeoutSeconds: 60 }, async (request) => {
  const uid = requireAuth(request);
  await checkAndIncrementRateLimit(uid, 'image');

  const { imageDataUrl, scaleFactor, flavor } = request.data as {
    imageDataUrl: string; // data: URL -- Magnific also accepts base64 directly
    scaleFactor?: number;
    flavor?: 'sublime' | 'photo' | 'photo_denoiser';
  };
  if (!imageDataUrl) throw new HttpsError('invalid-argument', 'imageDataUrl is required.');

  const base64 = imageDataUrl.includes(',') ? imageDataUrl.split(',')[1] : imageDataUrl;

  let res: Response;
  try {
    res = await fetch(MAGNIFIC_BASE_URL, {
      method: 'POST',
      headers: {
        'x-magnific-api-key': MAGNIFIC_API_KEY.value(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image: base64,
        scale_factor: Math.min(16, Math.max(2, scaleFactor || 4)),
        flavor: flavor || 'photo',
      }),
    });
  } catch (error: any) {
    throw new HttpsError('internal', `Failed to reach Magnific: ${error?.message || error}`);
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.task_id) {
    throw new HttpsError('internal', body?.message || `Magnific rejected the upscale request (${res.status}).`);
  }

  const operationId = db.collection('upscale_operations').doc().id;
  await db.collection('upscale_operations').doc(operationId).set({
    uid,
    status: 'pending',
    taskId: body.task_id,
    createdAt: FieldValue.serverTimestamp(),
  });

  return { operationId };
});

export const checkImageUpscale = onCall({ secrets: [MAGNIFIC_API_KEY, SENTRY_DSN], timeoutSeconds: 300 }, async (request) => {
  const uid = requireAuth(request);
  const { operationId } = request.data as { operationId: string };

  const ref = db.collection('upscale_operations').doc(operationId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Unknown upscale operation.');
  const doc = snap.data()!;
  if (doc.uid !== uid) throw new HttpsError('permission-denied', 'This operation belongs to another account.');

  if (doc.status === 'completed') return { done: true, url: doc.downloadUrl };
  if (doc.status === 'failed') return { done: true, error: doc.error || 'Upscale failed.' };

  let res: Response;
  try {
    res = await fetch(`${MAGNIFIC_BASE_URL}/${doc.taskId}`, {
      headers: { 'x-magnific-api-key': MAGNIFIC_API_KEY.value() },
    });
  } catch (error: any) {
    const message = `Failed to reach Magnific: ${error?.message || error}`;
    await ref.update({ status: 'failed', error: message });
    return { done: true, error: message };
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = body?.message || `Magnific status check failed (${res.status}).`;
    await ref.update({ status: 'failed', error: message });
    return { done: true, error: message };
  }

  if (body.status === 'FAILED') {
    const message = body?.error || 'Magnific upscale failed.';
    await ref.update({ status: 'failed', error: message });
    return { done: true, error: message };
  }

  if (body.status !== 'COMPLETED') {
    return { done: false };
  }

  const remoteUrl = body?.generated?.[0];
  if (!remoteUrl) {
    await ref.update({ status: 'failed', error: 'Magnific finished but returned no image.' });
    return { done: true, error: 'Magnific finished but returned no image.' };
  }

  try {
    const imgRes = await fetch(remoteUrl);
    if (!imgRes.ok) throw new Error(`Failed to download upscaled image: ${imgRes.statusText}`);
    const buffer = Buffer.from(await imgRes.arrayBuffer());

    const filePath = `upscaled-images/${uid}/${operationId}.png`;
    const file = bucket().file(filePath);
    await file.save(buffer, { contentType: 'image/png' });
    const [downloadUrl] = await file.getSignedUrl({ action: 'read', expires: Date.now() + 1000 * 60 * 60 * 24 * 7 });

    await ref.update({ status: 'completed', downloadUrl, completedAt: FieldValue.serverTimestamp() });
    return { done: true, url: downloadUrl };
  } catch (err: any) {
    const message = err?.message || 'Failed to store upscaled image.';
    await ref.update({ status: 'failed', error: message });
    return { done: true, error: message };
  }
});

// ---------------------------------------------------------------------------
// Billing (Stripe): one-time credit packs, spent by checkAndIncrementRateLimit
// above once the free daily allowance runs out. No subscriptions in this v1
// -- simpler to reason about and enough to let people pay to keep going.
//
// Setup required before this works (none of it can be done from code):
//   1. Create a Stripe account, then a Product with one or more one-time
//      Prices -- the price IDs go in CREDIT_PACKS below.
//   2. firebase functions:secrets:set STRIPE_SECRET_KEY   (from the Stripe
//      Dashboard's API keys page)
//   3. Deploy, then in the Stripe Dashboard add a webhook endpoint pointing
//      at this function's URL (printed by `firebase deploy`) subscribed to
//      the "checkout.session.completed" event, and
//      firebase functions:secrets:set STRIPE_WEBHOOK_SECRET with the signing
//      secret Stripe shows you for that endpoint.
// ---------------------------------------------------------------------------

interface CreditPack {
  credits: number;
  priceUsd: number;
  // Replace with a real Stripe Price ID (starts with "price_") once you've
  // created the corresponding Price in the Stripe Dashboard. Checkout will
  // fail with a clear error until then.
  stripePriceId: string;
}

const CREDIT_PACKS: Record<string, CreditPack> = {
  small: { credits: 100, priceUsd: 5, stripePriceId: 'price_REPLACE_ME_SMALL' },
  medium: { credits: 500, priceUsd: 20, stripePriceId: 'price_REPLACE_ME_MEDIUM' },
  large: { credits: 1500, priceUsd: 50, stripePriceId: 'price_REPLACE_ME_LARGE' },
};

export const getCreditBalance = onCall({ timeoutSeconds: 30 }, async (request) => {
  const uid = requireAuth(request);
  const snap = await db.collection('billing').doc(uid).get();
  return { credits: snap.exists ? (snap.data()?.credits ?? 0) : 0 };
});

export const createCheckoutSession = onCall({ secrets: [STRIPE_SECRET_KEY], timeoutSeconds: 30 }, async (request) => {
  const uid = requireAuth(request);
  const { packId, successUrl, cancelUrl } = request.data as { packId: string; successUrl: string; cancelUrl: string };

  const pack = CREDIT_PACKS[packId];
  if (!pack) throw new HttpsError('invalid-argument', `Unknown credit pack: ${packId}`);
  if (pack.stripePriceId.startsWith('price_REPLACE_ME')) {
    throw new HttpsError(
      'failed-precondition',
      `The "${packId}" credit pack isn't configured yet -- create a real Price in your Stripe Dashboard and update CREDIT_PACKS in functions/src/index.ts.`
    );
  }

  const stripe = new Stripe(STRIPE_SECRET_KEY.value());
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{ price: pack.stripePriceId, quantity: 1 }],
    client_reference_id: uid,
    metadata: { uid, packId, credits: String(pack.credits) },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });

  if (!session.url) throw new HttpsError('internal', 'Stripe did not return a checkout URL.');
  return { url: session.url };
});

// Plain onRequest (not onCall): Stripe posts directly to this URL and needs
// the raw request body to verify the webhook signature, which onCall's
// wrapper wouldn't give us. This endpoint is unauthenticated by design --
// authenticity comes from the Stripe-Signature header check below, not from
// a Firebase Auth token.
export const stripeWebhook = onRequest({ secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET] }, async (req, res) => {
  const stripe = new Stripe(STRIPE_SECRET_KEY.value());
  const signature = req.headers['stripe-signature'];

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, signature as string, STRIPE_WEBHOOK_SECRET.value());
  } catch (err: any) {
    console.error('Stripe webhook signature verification failed', err?.message);
    res.status(400).send(`Webhook signature verification failed: ${err?.message}`);
    return;
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const uid = session.metadata?.uid;
    const credits = Number(session.metadata?.credits || 0);
    if (uid && credits > 0) {
      await db.collection('billing').doc(uid).set(
        {
          credits: FieldValue.increment(credits),
          lastPurchaseAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    } else {
      console.error('checkout.session.completed missing uid/credits metadata', session.id);
    }
  }

  res.status(200).send('ok');
});
