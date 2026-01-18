import { DailyEntry } from './storage';

/**
 * Generate test entries with various scenarios to test the layout algorithm
 */
export function generateTestEntries(): DailyEntry[] {
  const today = new Date();
  const entries: DailyEntry[] = [];

  // Helper to create date string
  const getDateString = (daysAgo: number) => {
    const date = new Date(today);
    date.setDate(date.getDate() - daysAgo);
    return date.toISOString().split('T')[0];
  };

  // Test scenarios:

  // 1. Text only entries (various lengths)
  entries.push({
    id: 'test-1',
    date: getDateString(0),
    text: 'Today was amazing!',
    mediaUrls: [],
    createdAt: new Date().toISOString(),
  });

  entries.push({
    id: 'test-2',
    date: getDateString(1),
    text: 'This is a longer entry with more text to see how it looks when there is substantial content but no images. The layout should handle this gracefully and make it look natural.',
    mediaUrls: [],
    createdAt: new Date().toISOString(),
  });

  // 2. Very short text with image (should be IMAGE_FULL_ABOVE)
  entries.push({
    id: 'test-3',
    date: getDateString(2),
    text: 'Beautiful sunset!',
    mediaUrls: ['https://picsum.photos/800/600?random=1'], // Landscape
    createdAt: new Date().toISOString(),
  });

  // 3. Short text with portrait image (should alternate left/right)
  entries.push({
    id: 'test-4',
    date: getDateString(3),
    text: 'Had a great day at the park. The weather was perfect and I spent hours just relaxing.',
    mediaUrls: ['https://picsum.photos/400/800?random=2'], // Portrait
    createdAt: new Date().toISOString(),
  });

  // 4. Medium text with square image (should be IMAGE_FULL_BELOW)
  entries.push({
    id: 'test-5',
    date: getDateString(4),
    text: 'Today I learned something new. It was challenging but rewarding. I spent the morning reading and the afternoon practicing. By evening, I felt like I had made real progress. The key is consistency and patience.',
    mediaUrls: ['https://picsum.photos/600/600?random=3'], // Square
    createdAt: new Date().toISOString(),
  });

  // 5. Long text with portrait image (should be side-by-side)
  entries.push({
    id: 'test-6',
    date: getDateString(5),
    text: 'This is a much longer journal entry to test how the layout handles substantial amounts of text. When you have a lot to say, the layout should adapt accordingly. The image should be positioned in a way that complements the text rather than dominating it. This creates a more natural, handwritten journal feel where photos are integrated into the narrative rather than just placed at the top or bottom.',
    mediaUrls: ['https://picsum.photos/500/900?random=4'], // Portrait
    createdAt: new Date().toISOString(),
  });

  // 6. Very long text with small inline image
  entries.push({
    id: 'test-7',
    date: getDateString(6),
    text: 'This is an extremely long entry to test the inline small image layout. When you have pages and pages of text, a small floating image can add visual interest without disrupting the flow. The text should wrap naturally around the image, creating that organic journal feel. I want to make sure this works well on different screen sizes and that the algorithm correctly identifies when to use this layout type. The key is balancing readability with visual appeal.',
    mediaUrls: ['https://picsum.photos/400/500?random=5'], // Portrait
    createdAt: new Date().toISOString(),
  });

  // 7. Multiple images (2 images - grid)
  entries.push({
    id: 'test-8',
    date: getDateString(7),
    text: 'Two photos from today.',
    mediaUrls: [
      'https://picsum.photos/600/400?random=6',
      'https://picsum.photos/500/500?random=7',
    ],
    createdAt: new Date().toISOString(),
  });

  // 8. Multiple images (3 images - special layout)
  entries.push({
    id: 'test-9',
    date: getDateString(8),
    text: 'Three photos from the weekend trip.',
    mediaUrls: [
      'https://picsum.photos/600/400?random=8',
      'https://picsum.photos/500/500?random=9',
      'https://picsum.photos/800/600?random=10',
    ],
    createdAt: new Date().toISOString(),
  });

  // 9. Multiple images (4+ images - grid)
  entries.push({
    id: 'test-10',
    date: getDateString(9),
    text: 'A collection of memories from this week.',
    mediaUrls: [
      'https://picsum.photos/600/400?random=11',
      'https://picsum.photos/500/500?random=12',
      'https://picsum.photos/700/500?random=13',
      'https://picsum.photos/600/600?random=14',
    ],
    createdAt: new Date().toISOString(),
  });

  // 10. Wide landscape image with short text
  entries.push({
    id: 'test-11',
    date: getDateString(10),
    text: 'Amazing view!',
    mediaUrls: ['https://picsum.photos/1200/600?random=15'], // Very wide
    createdAt: new Date().toISOString(),
  });

  // 11. Very tall portrait with medium text
  entries.push({
    id: 'test-12',
    date: getDateString(11),
    text: 'This entry has medium length text to test how portrait images work with moderate amounts of content. The layout should position the image nicely alongside the text.',
    mediaUrls: ['https://picsum.photos/400/1000?random=16'], // Very tall
    createdAt: new Date().toISOString(),
  });

  // 12. No text, just image
  entries.push({
    id: 'test-13',
    date: getDateString(12),
    text: '',
    mediaUrls: ['https://picsum.photos/600/600?random=17'],
    createdAt: new Date().toISOString(),
  });

  return entries;
}
