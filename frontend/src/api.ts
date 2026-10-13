import type { RoomInfo, RoomFile } from './types';

// Configurable API URL via VITE_API_BASE_URL (defaults to empty string if not provided in production)
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');

export function isApiConfigured(): boolean {
  return API_BASE_URL.length > 0;
}

/**
 * Format user-friendly error messages that diagnose the exact root cause
 * instead of a raw "Failed to fetch" browser exception.
 */
export function formatApiError(err: any): string {
  if (!isApiConfigured()) {
    return 'Backend API URL is not configured. Please set the VITE_API_BASE_URL repository variable in GitHub Settings → Secrets and variables → Actions → Variables.';
  }

  const message = err?.message || String(err);
  if (message.includes('Failed to fetch') || message.includes('NetworkError') || message.includes('Load failed')) {
    return `Unable to reach the backend at "${API_BASE_URL}". This usually means the Cloudflare Worker is not deployed yet, is offline, or cross-origin requests (CORS) from GitHub Pages are blocked.`;
  }

  return message;
}

export async function createRoom(): Promise<{
  roomId: string;
  passcode: string;
  createdAt: number;
  expiresAt: number;
  maxFileSizeBytes: number;
  maxRoomSizeBytes: number;
  maxFilesPerRoom: number;
  maxConcurrentUploads: number;
}> {
  if (!isApiConfigured()) {
    throw new Error('Backend API URL is not configured. Please deploy the Cloudflare Worker and configure VITE_API_BASE_URL in your GitHub repository.');
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (netErr) {
    throw new Error(formatApiError(netErr));
  }

  let json: any;
  try {
    json = await res.json();
  } catch {
    throw new Error(`Server returned status ${res.status} with invalid response`);
  }

  if (!res.ok || !json.success) {
    throw new Error(json.error || `Failed to create room (${res.status})`);
  }
  return json.data;
}

export async function getRoom(roomId: string, passcode: string): Promise<RoomInfo> {
  if (!isApiConfigured()) {
    throw new Error('Backend API URL is not configured. Please deploy the Cloudflare Worker and configure VITE_API_BASE_URL in your GitHub repository.');
  }

  const cleanId = roomId.trim().toUpperCase();
  const cleanPasscode = passcode.trim();

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/rooms/${encodeURIComponent(cleanId)}`, {
      method: 'GET',
      headers: {
        'X-Room-Passcode': cleanPasscode
      }
    });
  } catch (netErr) {
    throw new Error(formatApiError(netErr));
  }

  let json: any;
  try {
    json = await res.json();
  } catch {
    throw new Error(`Server returned status ${res.status} with invalid response`);
  }

  if (!res.ok || !json.success) {
    throw new Error(json.error || `Failed to access room (${res.status})`);
  }
  return json.data;
}

export interface UploadProgressCallback {
  (loadedBytes: number, totalBytes: number, percent: number): void;
}

/**
 * Upload a file to the room.
 * For files <= 50MB: Single direct PUT with progress tracking via XMLHttpRequest.
 * For files > 50MB up to 100MB: Multipart chunked upload (chunks of 10MB) with resume and progress.
 */
export async function uploadFileToRoom(
  roomId: string,
  passcode: string,
  file: File,
  onProgress?: UploadProgressCallback
): Promise<void> {
  if (!isApiConfigured()) {
    throw new Error('Backend API URL is not configured.');
  }

  const cleanId = roomId.trim().toUpperCase();
  const cleanPasscode = passcode.trim();

  // 1. Initiate upload
  let initRes: Response;
  try {
    initRes = await fetch(`${API_BASE_URL}/api/rooms/${encodeURIComponent(cleanId)}/files`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Room-Passcode': cleanPasscode
      },
      body: JSON.stringify({
        filename: file.name,
        sizeBytes: file.size,
        contentType: file.type || 'application/octet-stream'
      })
    });
  } catch (netErr) {
    throw new Error(formatApiError(netErr));
  }

  let initJson: any;
  try {
    initJson = await initRes.json();
  } catch {
    throw new Error(`Upload initialization returned HTTP ${initRes.status}`);
  }

  if (!initRes.ok || !initJson.success) {
    if (initRes.status === 503) {
      throw new Error(initJson.error || 'Cloud storage bucket is not configured on the backend.');
    }
    throw new Error(initJson.error || `Failed to initiate upload (${initRes.status})`);
  }

  const { fileId, isMultipart, uploadId } = initJson.data;

  // Case A: Small/medium file (Single streaming PUT)
  if (!isMultipart || !uploadId) {
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', `${API_BASE_URL}/api/rooms/${encodeURIComponent(cleanId)}/files/${encodeURIComponent(fileId)}`);
      xhr.setRequestHeader('X-Room-Passcode', cleanPasscode);
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');

      if (xhr.upload && onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const percent = Math.min(100, Math.round((e.loaded / e.total) * 100));
            onProgress(e.loaded, e.total, percent);
          }
        };
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          if (onProgress) onProgress(file.size, file.size, 100);
          resolve();
        } else {
          try {
            const errJson = JSON.parse(xhr.responseText);
            reject(new Error(errJson.error || `Upload failed with status ${xhr.status}`));
          } catch {
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        }
      };

      xhr.onerror = () => reject(new Error('Network or CORS error while uploading file data to the server.'));
      xhr.ontimeout = () => reject(new Error('File upload timed out.'));

      xhr.send(file);
    });
    return;
  }

  // Case B: Large file (Multipart upload in 10MB chunks without reading entire file into RAM)
  const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB
  const totalParts = Math.ceil(file.size / CHUNK_SIZE);
  const parts: { partNumber: number; etag: string }[] = [];
  let uploadedBytes = 0;

  try {
    for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
      const start = (partNumber - 1) * CHUNK_SIZE;
      const end = Math.min(file.size, start + CHUNK_SIZE);
      const chunk = file.slice(start, end);

      const partUrl = `${API_BASE_URL}/api/rooms/${encodeURIComponent(cleanId)}/files/${encodeURIComponent(fileId)}/part?partNumber=${partNumber}`;
      
      const partRes = await fetch(partUrl, {
        method: 'PUT',
        headers: {
          'X-Room-Passcode': cleanPasscode,
          'Content-Type': 'application/octet-stream'
        },
        body: chunk
      });

      const partJson = await partRes.json();
      if (!partRes.ok || !partJson.success) {
        throw new Error(partJson.error || `Chunk ${partNumber} failed to upload`);
      }

      parts.push({
        partNumber,
        etag: partJson.etag
      });

      uploadedBytes += (end - start);
      if (onProgress) {
        const percent = Math.min(100, Math.round((uploadedBytes / file.size) * 100));
        onProgress(uploadedBytes, file.size, percent);
      }
    }

    // Complete multipart upload
    const completeRes = await fetch(`${API_BASE_URL}/api/rooms/${encodeURIComponent(cleanId)}/files/${encodeURIComponent(fileId)}/complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Room-Passcode': cleanPasscode
      },
      body: JSON.stringify({ parts })
    });

    const completeJson = await completeRes.json();
    if (!completeRes.ok || !completeJson.success) {
      throw new Error(completeJson.error || 'Failed to complete multipart upload');
    }

    if (onProgress) onProgress(file.size, file.size, 100);

  } catch (err) {
    try {
      await fetch(`${API_BASE_URL}/api/rooms/${encodeURIComponent(cleanId)}/files/${encodeURIComponent(fileId)}/abort`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Room-Passcode': cleanPasscode
        }
      });
    } catch {}
    throw err;
  }
}

/**
 * Download a single file by triggering browser download stream.
 */
export async function downloadFile(
  roomId: string,
  passcode: string,
  file: RoomFile,
  onProgress?: (receivedBytes: number, totalBytes: number, percent: number) => void
): Promise<void> {
  if (!isApiConfigured()) {
    throw new Error('Backend API URL is not configured.');
  }

  const cleanId = roomId.trim().toUpperCase();
  const cleanPasscode = passcode.trim();

  const url = `${API_BASE_URL}/api/rooms/${encodeURIComponent(cleanId)}/files/${encodeURIComponent(file.id)}/download`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Room-Passcode': cleanPasscode
      }
    });
  } catch (netErr) {
    throw new Error(formatApiError(netErr));
  }

  if (!response.ok) {
    let err = `Download failed with HTTP ${response.status}`;
    try {
      const j = await response.json();
      if (j.error) err = j.error;
    } catch {}
    throw new Error(err);
  }

  const contentLength = response.headers.get('Content-Length');
  const total = contentLength ? parseInt(contentLength, 10) : file.size_bytes;

  if (!response.body) {
    throw new Error('Response body stream is not available');
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.length;
      if (onProgress && total > 0) {
        onProgress(received, total, Math.min(100, Math.round((received / total) * 100)));
      }
    }
  }

  const blob = new Blob(chunks as BlobPart[], { credentials: undefined } as any);
  const downloadUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = file.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
}
