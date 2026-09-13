// Product category / location / model-gender taxonomy, plus the pure
// category -> generation-task-list mapping. Zero imports, same convention as
// movieFlowMath.ts / usageMath.ts, so it can be unit tested without ever
// touching services/firebase.ts.

export type ProductCategoryGroup = 'wearable' | 'vehicle' | 'property' | 'other';

export interface ProductCategoryDef {
  group: ProductCategoryGroup;
  label: string;
  subcategories: string[];
}

export const PRODUCT_CATEGORIES: ProductCategoryDef[] = [
  { group: 'wearable', label: 'Fashion & Apparel', subcategories: ['Clothing', 'Shoes', 'Hats', 'Bags'] },
  { group: 'wearable', label: 'Jewelry & Accessories', subcategories: ['Jewelry', 'Watches', 'Sunglasses', 'Other Accessories'] },
  { group: 'vehicle', label: 'Vehicles', subcategories: ['Cars', 'Motorcycles'] },
  { group: 'property', label: 'Real Estate', subcategories: ['Houses', 'Buildings & Commercial', 'Interiors'] },
  { group: 'other', label: 'Everything Else', subcategories: ['Other'] },
];

export interface LocationCategoryDef {
  label: string;
  options: string[];
}

// 'Custom' is a sentinel the UI uses to fall back to the existing freeform
// "Background / Location" textarea instead of one of these fixed options.
export const CUSTOM_LOCATION = 'Custom';

export const LOCATION_CATEGORIES: LocationCategoryDef[] = [
  { label: 'Studio', options: ['White Studio', 'Colored Backdrop', 'Cyclorama'] },
  { label: 'Outdoor', options: ['Beach', 'Park / Nature', 'Urban Street', 'Rooftop'] },
  { label: 'Indoor', options: ['Home Interior', 'Office', 'Retail Store'] },
  { label: 'Industrial', options: ['Warehouse', 'Factory', 'Garage'] },
  { label: 'Abandoned', options: ['Ruins', 'Urban Decay', 'Abandoned Building'] },
  { label: 'Custom', options: [CUSTOM_LOCATION] },
];

export const MODEL_GENDERS = ['Unspecified', 'Male', 'Female'] as const;
export type ModelGender = (typeof MODEL_GENDERS)[number];

export interface GenerationTask {
  key: string;
  style: string;
  label: string;
  // True for tasks that show a model interacting with/wearing the product --
  // used by the UI to decide whether the Models/Interactive tabs make sense
  // for a given product category (they don't for vehicles/property).
  isModelShot?: boolean;
}

const WEARABLE_TASKS: GenerationTask[] = [
  { key: 'studio_front', style: 'studio_front', label: 'Front View' },
  { key: 'studio_right', style: 'studio_right', label: 'Right View' },
  { key: 'studio_back', style: 'studio_back', label: 'Back View' },
  { key: 'studio_left', style: 'studio_left', label: 'Left View' },
  { key: 'model_pose_classic', style: 'model_pose_classic', label: 'Classic Editorial', isModelShot: true },
  { key: 'model_pose_premium', style: 'model_pose_premium', label: 'Futuristic Editorial', isModelShot: true },
  { key: 'model_interact_classic', style: 'model_interact_classic', label: 'Classic Interaction', isModelShot: true },
  { key: 'model_interact_futuristic', style: 'model_interact_futuristic', label: 'Futuristic Interaction', isModelShot: true },
];

const VEHICLE_TASKS: GenerationTask[] = [
  { key: 'vehicle_exterior_front', style: 'vehicle_exterior_front', label: 'Front Exterior' },
  { key: 'vehicle_exterior_side', style: 'vehicle_exterior_side', label: 'Side Exterior' },
  { key: 'vehicle_exterior_rear', style: 'vehicle_exterior_rear', label: 'Rear Exterior' },
  { key: 'vehicle_interior', style: 'vehicle_interior', label: 'Interior' },
  { key: 'vehicle_detail', style: 'vehicle_detail', label: 'Detail Shot' },
];

const PROPERTY_TASKS: GenerationTask[] = [
  { key: 'property_exterior', style: 'property_exterior', label: 'Exterior' },
  { key: 'property_interior', style: 'property_interior', label: 'Interior' },
  { key: 'property_detail', style: 'property_detail', label: 'Detail Shot' },
];

// Pure so it can be unit tested directly (see taxonomy.test.ts) without
// pulling in the Gemini/Firebase call chain.
export const getGenerationTasksForGroup = (group?: ProductCategoryGroup): GenerationTask[] => {
  switch (group) {
    case 'vehicle':
      return VEHICLE_TASKS;
    case 'property':
      return PROPERTY_TASKS;
    case 'wearable':
    case 'other':
    default:
      return WEARABLE_TASKS;
  }
};
