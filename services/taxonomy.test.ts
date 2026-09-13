import { describe, it, expect } from 'vitest';
import { getGenerationTasksForGroup } from './taxonomy';

describe('getGenerationTasksForGroup', () => {
  it('returns the wearable task list for wearable products', () => {
    const tasks = getGenerationTasksForGroup('wearable');
    expect(tasks.map((t) => t.key)).toEqual([
      'studio_front', 'studio_right', 'studio_back', 'studio_left',
      'model_pose_classic', 'model_pose_premium', 'model_interact_classic', 'model_interact_futuristic',
    ]);
  });

  it('returns a model-free task list for vehicles', () => {
    const tasks = getGenerationTasksForGroup('vehicle');
    expect(tasks.map((t) => t.key)).toEqual([
      'vehicle_exterior_front', 'vehicle_exterior_side', 'vehicle_exterior_rear', 'vehicle_interior', 'vehicle_detail',
    ]);
    expect(tasks.some((t) => t.key.startsWith('model_'))).toBe(false);
  });

  it('returns a model-free task list for property', () => {
    const tasks = getGenerationTasksForGroup('property');
    expect(tasks.map((t) => t.key)).toEqual(['property_exterior', 'property_interior', 'property_detail']);
    expect(tasks.some((t) => t.key.startsWith('model_'))).toBe(false);
  });

  it('falls back to the wearable/default task list for "other" and undefined', () => {
    expect(getGenerationTasksForGroup('other')).toEqual(getGenerationTasksForGroup('wearable'));
    expect(getGenerationTasksForGroup(undefined)).toEqual(getGenerationTasksForGroup('wearable'));
  });
});
