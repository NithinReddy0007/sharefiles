export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  ALLOWED_ORIGIN?: string;
  MAX_FILE_SIZE_BYTES?: string | number;
  MAX_ROOM_SIZE_BYTES?: string | number;
  ROOM_TTL_SECONDS?: string | number;
  MAX_FILES_PER_ROOM?: string | number;
  MAX_CONCURRENT_UPLOADS?: string | number;
}

export interface RoomRecord {
  id: string;
  passcode_hash: string;
  passcode_salt: string;
  created_at: number;
  expires_at: number;
  total_size_bytes: number;
  status: string;
}

export interface FileRecord {
  id: string;
  room_id: string;
  filename: string;
  size_bytes: number;
  content_type: string;
  storage_key: string;
  status: 'pending' | 'uploaded' | 'deleted';
  upload_id?: string | null;
  uploaded_at?: number | null;
  created_at: number;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}
