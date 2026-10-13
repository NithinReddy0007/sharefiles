export interface RoomInfo {
  roomId: string;
  passcode?: string;
  createdAt: number;
  expiresAt: number;
  totalSizeBytes: number;
  maxFileSizeBytes: number;
  maxRoomSizeBytes: number;
  maxFilesPerRoom: number;
  maxConcurrentUploads: number;
  files: RoomFile[];
}

export interface RoomFile {
  id: string;
  filename: string;
  size_bytes: number;
  content_type: string;
  status: 'pending' | 'uploaded' | 'deleted';
  uploaded_at: number | null;
  created_at: number;
}

export interface UploadItem {
  id: string;
  file: File;
  progress: number;
  status: 'pending' | 'uploading' | 'completed' | 'error';
  errorMessage?: string;
}
