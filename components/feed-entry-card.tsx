import { useState, useEffect } from 'react';
import { View, Text, Image, StyleSheet, Dimensions } from 'react-native';
import { PaperCard } from './ui/paper-card';
import { Colors, Fonts } from '@/constants/theme';
import { DailyEntry } from '@/lib/db';
import {
  LayoutType,
  ImageDimension,
  determineLayout,
} from '@/lib/layout-algorithm';

interface FeedEntryCardProps {
  entry: DailyEntry;
}

export function FeedEntryCard({ entry }: FeedEntryCardProps) {
  const [imageDimensions, setImageDimensions] = useState<ImageDimension[]>([]);
  const [layoutDecision, setLayoutDecision] = useState<{
    layoutType: LayoutType;
    imageDimensions: ImageDimension[];
    imageCount: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadImageDimensions();
  }, [entry.mediaUrls]);

  const loadImageDimensions = async () => {
    if (!entry.mediaUrls || entry.mediaUrls.length === 0) {
      setImageDimensions([]);
      const decision = determineLayout(entry, []);
      setLayoutDecision(decision);
      setLoading(false);
      return;
    }

    try {
      const dimensions: ImageDimension[] = [];
      for (const url of entry.mediaUrls) {
        await new Promise<ImageDimension>((resolve, reject) => {
          Image.getSize(
            url,
            (width, height) => {
              resolve({ width, height });
            },
            (error) => {
              // Fallback to default dimensions if image fails to load
              resolve({ width: 400, height: 300 });
            }
          );
        }).then((dim) => dimensions.push(dim));
      }

      setImageDimensions(dimensions);
      const decision = determineLayout(entry, dimensions);
      setLayoutDecision(decision);
    } catch (error) {
      // Fallback to default dimensions
      const defaultDims = entry.mediaUrls.map(() => ({ width: 400, height: 300 }));
      setImageDimensions(defaultDims);
      const decision = determineLayout(entry, defaultDims);
      setLayoutDecision(decision);
    } finally {
      setLoading(false);
    }
  };

  if (loading || !layoutDecision) {
    return (
      <PaperCard style={styles.card}>
        <Text style={styles.loadingText}>Loading...</Text>
      </PaperCard>
    );
  }

  const { layoutType, imageCount } = layoutDecision;

  return (
    <PaperCard style={styles.card}>
      {layoutType === 'TEXT_ONLY' && <TextOnlyLayout entry={entry} />}
      {layoutType === 'TEXT_WITH_IMAGES' && (
        <TextWithImagesLayout entry={entry} imageDimensions={imageDimensions} imageCount={imageCount} />
      )}
    </PaperCard>
  );
}

// Layout Components

function TextOnlyLayout({ entry }: { entry: DailyEntry }) {
  return (
    <>
      {entry.text ? <Text style={styles.text}>{entry.text}</Text> : null}
    </>
  );
}

function TextWithImagesLayout({
  entry,
  imageDimensions,
  imageCount,
}: {
  entry: DailyEntry;
  imageDimensions: ImageDimension[];
  imageCount: number;
}) {
  const screenWidth = Dimensions.get('window').width;
  const contentWidth = screenWidth - 64; // Card padding + margins
  const gap = 4;

  return (
    <>
      {entry.text ? <Text style={styles.text}>{entry.text}</Text> : null}
      <View style={[styles.imagesContainer, { width: contentWidth }]}>
        {entry.mediaUrls!.map((url, index) => {
          const image = imageDimensions[index];
          const aspectRatio = image.width / image.height;
          
          let imageWidth: number;
          let imageHeight: number;

          if (imageCount === 1) {
            // 1 image: full width
            imageWidth = contentWidth;
            imageHeight = Math.min(imageWidth / aspectRatio, 400);
          } else if (imageCount === 2) {
            // 2 images: side by side (1:1 squares)
            imageWidth = (contentWidth - gap) / 2;
            imageHeight = imageWidth;
          } else if (imageCount === 3) {
            // 3 images: first two side by side (1:1), then third full width
            if (index < 2) {
              // First two: side by side, square
              imageWidth = (contentWidth - gap) / 2;
              imageHeight = imageWidth;
            } else {
              // Third: full width
              imageWidth = contentWidth;
              imageHeight = Math.min(imageWidth / aspectRatio, 300);
            }
          } else {
            // 4+ images: 2x2 grid (2 images per row, 1:1 squares)
            imageWidth = (contentWidth - gap) / 2;
            imageHeight = imageWidth;
          }

          // Calculate margins
          const marginRight = 
            imageCount === 2 
              ? (index === 0 ? gap : 0)
              : imageCount === 3 
              ? (index < 2 && index === 0 ? gap : 0)
              : imageCount >= 4
              ? (index % 2 === 0 ? gap : 0)
              : 0;

          const marginBottom = 
            imageCount === 2 
              ? 0
              : imageCount === 3
              ? (index < 2 ? gap : 0)
              : imageCount >= 4
              ? (index < imageCount - 2 ? gap : 0)
              : 0;

          return (
            <Image
              key={index}
              source={{ uri: url }}
              style={[
                styles.image,
                {
                  width: imageWidth,
                  height: imageHeight,
                  marginRight: marginRight,
                  marginBottom: marginBottom,
                },
              ]}
              resizeMode="cover"
            />
          );
        })}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 0,
    marginBottom: 0,
  },
  loadingText: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
  },
  text: {
    fontSize: 16,
    color: Colors.ink,
    lineHeight: 26,
    fontFamily: Fonts.handwriting,
    marginBottom: 12,
  },
  imagesContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 0,
    alignSelf: 'flex-start',
  },
  image: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.shadow,
  },
});
