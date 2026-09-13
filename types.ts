export interface TokenUsage {
  promptTokens: number;
  candidatesTokens: number;
  totalTokens: number;
  cost: number;
}

export interface ProductImage {
  id: string;
  file?: File;
  modelFile?: File;
  referenceModelFile?: File; // For user uploaded model reference when input is product
  productBase64?: string;
  referenceImageBase64?: string;
  modelBase64s?: string[];
  inputType: 'product' | 'model' | 'text' | 'mixed';
  previewUrl?: string;
  status: 'idle' | 'pending' | 'processing' | 'completed' | 'failed';

  // Usage tracking
  usage?: TokenUsage;

  // Separate video statuses
  videoProductStatus: 'idle' | 'generating' | 'completed' | 'failed';
  videoModelStatus: 'idle' | 'generating' | 'completed' | 'failed';
  videoError?: string; // Specific error message for video generation failures

  // User customization
  productPrompt?: string;
  modelPrompt?: string;
  backgroundPrompt?: string;
  videoPrompt?: string; // User defined video prompt
  virtue?: string;
  productAngle?: string;
  modelPosture?: string;

  // Product category, location/setting, and model taxonomy (services/taxonomy.ts)
  productCategoryGroup?: 'wearable' | 'vehicle' | 'property' | 'other';
  productCategory?: string; // top-level category label, e.g. "Vehicles"
  productSubcategory?: string; // e.g. "Cars"
  locationCategory?: string; // e.g. "Outdoor"
  locationOption?: string; // e.g. "Beach", or the 'Custom' sentinel
  modelGender?: string;
  customModelId?: string; // selected saved CustomModel, if any
  customModelImageUrl?: string; // its reference portrait, resolved at selection time

  // Whether to automatically kick off video generation once photos finish,
  // instead of requiring a manual per-result click (see App.tsx's processQueue).
  wantsAutoVideo?: boolean;

  // Video Customization
  videoAspectRatio?: '16:9' | '9:16' | '1:1';
  videoResolution?: '720p' | '1080p';
  videoDuration?: '5s' | '10s'; // Although Veo is usually fixed, good to have structure

  results: {
    // Studio Tab (3D Views) -- wearable/other categories
    studio_front?: string;
    studio_right?: string;
    studio_back?: string;
    studio_left?: string;
    // Models Tab -- wearable/other categories
    model_pose_classic?: string;
    model_pose_premium?: string;
    // Interactive Tab -- wearable/other categories
    model_interact_classic?: string;
    model_interact_futuristic?: string;

    // Vehicle category
    vehicle_exterior_front?: string;
    vehicle_exterior_side?: string;
    vehicle_exterior_rear?: string;
    vehicle_interior?: string;
    vehicle_detail?: string;

    // Property category
    property_exterior?: string;
    property_interior?: string;
    property_detail?: string;

    // Video Tab - Separate Results
    video_product?: string;
    video_model?: string;
  };
  error?: string;
}

// A user-created, saved AI model character (a reference portrait) that can be
// reused across future products so the same "face" appears consistently.
export interface CustomModel {
  id: string;
  uid: string;
  name: string;
  gender: string;
  prompt: string;
  imageUrl: string;
  createdAt: number;
}

export interface ProcessingStats {
  total: number;
  completed: number;
  failed: number;
}

// Movie Flow: prompt + up to 5 reference images, chained into a long-form video.
export interface MovieProject {
  id: string;
  prompt: string;
  referenceImagePreviews: string[]; // data URLs, for display only
  engine: 'veo' | 'seedance' | 'kling';
  aspectRatio: '16:9' | '9:16' | '1:1';
  resolution: '720p' | '1080p';
  targetDurationSeconds: number;
  status: 'pending' | 'generating' | 'stitching' | 'completed' | 'failed';
  progressLabel?: string;
  finalUrl?: string;
  segments?: { url: string; durationSeconds: number }[];
  error?: string;
  createdAt: number;
}
