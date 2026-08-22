export type {
  MediaCleanupResult,
  MediaCleanupStatus,
  MediaDeleteResult,
  UploadAvatarResult,
  UploadedImage,
  UploadEntryImagesResult,
} from "./storage";

export {
  clearMediaCache,
  clearUserMedia,
  deleteImage,
  deleteImages,
  discardAvatar,
  discardEntryImages,
  getImageUrl,
  getImageUrls,
  objectPathsFor,
  thumbPathFor,
  uploadAvatar,
  uploadEntryImages,
  uploadImage,
} from "./storage";
