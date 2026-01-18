import { Dimensions } from 'react-native';
import { DailyEntry } from './storage';

export type LayoutType = 'TEXT_ONLY' | 'TEXT_WITH_IMAGES';

export interface ImageDimension {
  width: number;
  height: number;
}

export interface LayoutDecision {
  layoutType: LayoutType;
  imageDimensions: ImageDimension[];
  imageCount: number;
}

/**
 * Determine the optimal layout for an entry - always text first, then images
 */
export function determineLayout(
  entry: DailyEntry,
  imageDimensions: ImageDimension[]
): LayoutDecision {
  const imageCount = imageDimensions.length;

  if (imageCount === 0) {
    return {
      layoutType: 'TEXT_ONLY',
      imageDimensions: [],
      imageCount: 0,
    };
  }

  return {
    layoutType: 'TEXT_WITH_IMAGES',
    imageDimensions,
    imageCount,
  };
}
