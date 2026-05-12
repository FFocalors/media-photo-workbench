export type WorkbenchMode = "host" | "client";

export type EventStatus = "draft" | "active" | "reviewing" | "archived" | "deleted";

export type ImageStatus =
  | "unselected"
  | "rejected"
  | "archive"
  | "edit"
  | "edited"
  | "publish"
  | "published";

export type TaskStatus = "pending" | "running" | "success" | "failed" | "cancelled";

export interface MediaEvent {
  id: string;
  name: string;
  slug: string;
  date: string;
  location: string;
  status: EventStatus;
  totalImages: number;
  selectedImages: number;
}

export interface MediaImage {
  id: string;
  eventId: string;
  originalFilename: string;
  storedFilename: string;
  thumbUrl: string;
  previewUrl: string;
  photographer: string;
  cameraModel: string;
  shotAt: string;
  rating: number;
  status: ImageStatus;
  category: string;
  tags: string[];
}

export interface TaskProgress {
  id: string;
  name: string;
  status: TaskStatus;
  total: number;
  finished: number;
  success: number;
  failed: number;
  skipped: number;
}
