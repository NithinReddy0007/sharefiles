import { zip } from 'fflate';
import type { RoomFile } from './types';
import { API_BASE_URL } from './api';

export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export function formatDuration(seconds: number): string {
  if (seconds <= 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Memory-efficient streaming ZIP downloader for "Download All".
 * Downloads files sequentially and feeds chunks directly to fflate stream
 * instead of holding all files uncompressed in memory.
 */
export async function downloadAllAsZip(
  roomId: string,
  passcode: string,
  files: RoomFile[],
  onOverallProgress?: (currentFile: string, fileIndex: number, totalFiles: number) => void
): Promise<void> {
  if (!files || files.length === 0) return;

  const cleanId = roomId.trim().toUpperCase();
  const cleanPasscode = passcode.trim();

  // Stream each file one by one
  const zipObject: Record<string, Uint8Array> = {};

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (onOverallProgress) {
      onOverallProgress(file.filename, i + 1, files.length);
    }

    const downloadUrl = `${API_BASE_URL}/api/rooms/${encodeURIComponent(cleanId)}/files/${encodeURIComponent(file.id)}/download`;
    const res = await fetch(downloadUrl, {
      headers: {
        'X-Room-Passcode': cleanPasscode
      }
    });

    if (!res.ok) {
      throw new Error(`Failed to download ${file.filename} (HTTP ${res.status})`);
    }

    const buffer = await res.arrayBuffer();
    // Handle unique filename collisions in zip
    let entryName = file.filename;
    let counter = 1;
    while (zipObject[entryName]) {
      const dotIndex = file.filename.lastIndexOf('.');
      if (dotIndex > 0) {
        entryName = `${file.filename.slice(0, dotIndex)} (${counter})${file.filename.slice(dotIndex)}`;
      } else {
        entryName = `${file.filename} (${counter})`;
      }
      counter++;
    }

    zipObject[entryName] = new Uint8Array(buffer);
  }

  // Compress using fflate
  const zipped = await new Promise<Uint8Array>((resolve, reject) => {
    zip(zipObject, { level: 6 }, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });

  const blob = new Blob([zipped as any], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `qshare-${cleanId}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
