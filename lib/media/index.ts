export type {
  MediaCleanupResult,
  MediaCleanupStatus,
  MediaDeleteResult,
  UploadAvatarResult,
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
  uploadAvatar,
  uploadEntryImages,
  uploadImage,
} from "./storage";
