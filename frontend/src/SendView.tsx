import React, { useState, useRef, useEffect } from 'react';
import type { UploadItem, RoomInfo } from './types';
import { createRoom, uploadFileToRoom } from './api';
import { formatBytes } from './utils';
import { ExpirationCountdown } from './ExpirationCountdown';
import { Copy, Check, Upload, Trash2, ArrowLeft, AlertCircle } from 'lucide-react';

interface SendViewProps {
  onBack: () => void;
}

export const SendView: React.FC<SendViewProps> = ({ onBack }) => {
  const [loading, setLoading] = useState<boolean>(false);
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<boolean>(false);
  const [copiedPasscode, setCopiedPasscode] = useState<boolean>(false);
  const [copiedAll, setCopiedAll] = useState<boolean>(false);
  const [queue, setQueue] = useState<UploadItem[]>([]);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isExpired, setIsExpired] = useState<boolean>(false);
  const [isUploading, setIsUploading] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize room when mounting SendView
  useEffect(() => {
    let mounted = true;
    async function initRoom() {
      setLoading(true);
      setError(null);
      try {
        const data = await createRoom();
        if (mounted) {
          setRoom({
            roomId: data.roomId,
            passcode: data.passcode,
            createdAt: data.createdAt,
            expiresAt: data.expiresAt,
            totalSizeBytes: 0,
            maxFileSizeBytes: data.maxFileSizeBytes,
            maxRoomSizeBytes: data.maxRoomSizeBytes,
            maxFilesPerRoom: data.maxFilesPerRoom,
            maxConcurrentUploads: data.maxConcurrentUploads,
            files: []
          });
        }
      } catch (err: any) {
        if (mounted) setError(err.message || 'Failed to create room');
      } finally {
        if (mounted) setLoading(false);
      }
    }
    initRoom();
    return () => {
      mounted = false;
    };
  }, []);

  const copyToClipboard = async (text: string, type: 'id' | 'passcode' | 'all') => {
    try {
      await navigator.clipboard.writeText(text);
      if (type === 'id') {
        setCopiedId(true);
        setTimeout(() => setCopiedId(false), 2000);
      } else if (type === 'passcode') {
        setCopiedPasscode(true);
        setTimeout(() => setCopiedPasscode(false), 2000);
      } else {
        setCopiedAll(true);
        setTimeout(() => setCopiedAll(false), 2000);
      }
    } catch {
      setError('Unable to copy to clipboard');
    }
  };

  const handleFilesAdded = (files: FileList | null) => {
    if (!files || files.length === 0 || !room || isExpired) return;

    setError(null);
    const newItems: UploadItem[] = [];
    const maxFileSize = room.maxFileSizeBytes || 104857600; // 100 MiB
    const maxRoomSize = room.maxRoomSizeBytes || 524288000; // 500 MiB
    const maxFiles = room.maxFilesPerRoom || 20;

    const existingFileCount = room.files.length + queue.filter((q) => q.status !== 'error').length;
    let currentTotalSize = room.totalSizeBytes + queue.filter((q) => q.status !== 'error').reduce((acc, q) => acc + q.file.size, 0);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      if (existingFileCount + newItems.length >= maxFiles) {
        setError(`Cannot add "${file.name}". Room has reached the maximum limit of ${maxFiles} files.`);
        break;
      }

      if (file.size > maxFileSize) {
        setError(`File "${file.name}" exceeds maximum allowed individual size of ${formatBytes(maxFileSize)}.`);
        continue;
      }

      if (currentTotalSize + file.size > maxRoomSize) {
        setError(`Adding "${file.name}" would exceed the 500 MiB room capacity.`);
        continue;
      }

      currentTotalSize += file.size;
      newItems.push({
        id: crypto.randomUUID(),
        file,
        progress: 0,
        status: 'pending'
      });
    }

    if (newItems.length > 0) {
      setQueue((prev) => [...prev, ...newItems]);
    }
  };

  const removeQueueItem = (id: string) => {
    setQueue((prev) => prev.filter((item) => item.id !== id));
  };

  /**
   * Upload worker that enforces MAX_CONCURRENT_UPLOADS = 3
   */
  const startUpload = async () => {
    if (!room || !room.passcode || isExpired || isUploading) return;

    setIsUploading(true);
    const maxConcurrent = room.maxConcurrentUploads || 3;

    // Concurrency pool runner
    await new Promise<void>((resolveAll) => {
      let isDone = false;

      const processNext = () => {
        if (isDone) return;

        setQueue((currentQueue) => {
          const pendingItems = currentQueue.filter((item) => item.status === 'pending');
          const uploadingItems = currentQueue.filter((item) => item.status === 'uploading');

          if (pendingItems.length === 0 && uploadingItems.length === 0) {
            isDone = true;
            resolveAll();
            return currentQueue;
          }

          const availableSlots = maxConcurrent - uploadingItems.length;
          if (availableSlots <= 0 || pendingItems.length === 0) {
            return currentQueue;
          }

          const toStart = pendingItems.slice(0, availableSlots);

          // Mark toStart as uploading
          const nextQueue = currentQueue.map((item) => {
            if (toStart.some((s) => s.id === item.id)) {
              return { ...item, status: 'uploading' as const, progress: 0 };
            }
            return item;
          });

          // Kick off the uploads asynchronously
          for (const item of toStart) {
            uploadSingleItem(item).finally(() => {
              processNext();
            });
          }

          return nextQueue;
        });
      };

      const uploadSingleItem = async (item: UploadItem) => {
        try {
          await uploadFileToRoom(room.roomId, room.passcode!, item.file, (_, __, percent) => {
            setQueue((prev) =>
              prev.map((i) => (i.id === item.id ? { ...i, progress: percent } : i))
            );
          });

          // Mark as completed
          setQueue((prev) =>
            prev.map((i) => (i.id === item.id ? { ...i, status: 'completed', progress: 100 } : i))
          );

          // Update room's local files and total size
          setRoom((prev) => {
            if (!prev) return null;
            return {
              ...prev,
              totalSizeBytes: prev.totalSizeBytes + item.file.size,
              files: [
                ...prev.files,
                {
                  id: item.id,
                  filename: item.file.name,
                  size_bytes: item.file.size,
                  content_type: item.file.type,
                  status: 'uploaded',
                  uploaded_at: Math.floor(Date.now() / 1000),
                  created_at: Math.floor(Date.now() / 1000)
                }
              ]
            };
          });
        } catch (err: any) {
          setQueue((prev) =>
            prev.map((i) =>
              i.id === item.id
                ? { ...i, status: 'error', errorMessage: err.message || 'Upload failed' }
                : i
            )
          );
        }
      };

      processNext();
    });

    setIsUploading(false);
  };

  const totalCapacity = room?.maxRoomSizeBytes || 524288000;
  const maxPerFile = room?.maxFileSizeBytes || 104857600;
  const maxFiles = room?.maxFilesPerRoom || 20;

  const uploadedSize = room?.totalSizeBytes || 0;
  const queuedSize = queue.filter((q) => q.status === 'pending' || q.status === 'uploading').reduce((acc, q) => acc + q.file.size, 0);
  const usedSize = uploadedSize + queuedSize;
  const remainingSize = Math.max(0, totalCapacity - usedSize);
  const capacityPercent = Math.min(100, Math.round((usedSize / totalCapacity) * 100));

  const totalFilesCount = (room?.files.length || 0) + queue.filter((q) => q.status !== 'error').length;

  return (
    <div className="card">
      <button className="back-link" onClick={onBack}>
        <ArrowLeft size={16} /> Back to Home
      </button>

      <div className="card-header">
        <h2 className="card-title">Send Files</h2>
        {room && (
          <ExpirationCountdown
            expiresAt={room.expiresAt}
            onExpire={() => setIsExpired(true)}
          />
        )}
      </div>

      {error && (
        <div className="alert alert-danger">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
          <button className="btn-icon" onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {loading && !room && (
        <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px 0' }}>
          Creating temporary room...
        </p>
      )}

      {room && (
        <>
          {/* Credentials Box */}
          <div className="credentials-box">
            <div className="credential-item">
              <span className="credential-label">Room ID</span>
              <div className="credential-value-wrapper">
                <span className="credential-value">{room.roomId}</span>
                <button
                  className="btn-icon"
                  title="Copy Room ID"
                  onClick={() => copyToClipboard(room.roomId, 'id')}
                >
                  {copiedId ? <Check size={16} color="var(--success-color)" /> : <Copy size={16} />}
                </button>
              </div>
            </div>

            <div className="credential-item">
              <span className="credential-label">Passcode</span>
              <div className="credential-value-wrapper">
                <span className="credential-value">{room.passcode}</span>
                <button
                  className="btn-icon"
                  title="Copy Passcode"
                  onClick={() => copyToClipboard(room.passcode || '', 'passcode')}
                >
                  {copiedPasscode ? <Check size={16} color="var(--success-color)" /> : <Copy size={16} />}
                </button>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '20px' }}>
            <button
              className="btn btn-subtle"
              onClick={() =>
                copyToClipboard(
                  `Room ID: ${room.roomId}\nPasscode: ${room.passcode}\nAccess files at: ${window.location.origin}${window.location.pathname}`,
                  'all'
                )
              }
            >
              {copiedAll ? <Check size={14} /> : <Copy size={14} />} Copy All Credentials
            </button>
          </div>

          {/* Capacity Bar */}
          <div className="capacity-container">
            <div className="capacity-header">
              <span>Allocated: {formatBytes(usedSize)} ({totalFilesCount}/{maxFiles} files)</span>
              <span>Remaining: {formatBytes(remainingSize)} / {formatBytes(totalCapacity)}</span>
            </div>
            <div className="capacity-bar-track">
              <div className="capacity-bar-fill" style={{ width: `${capacityPercent}%` }} />
            </div>
          </div>

          {/* Drag & Drop Area */}
          <div
            className={`dropzone ${isDragging ? 'active' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              handleFilesAdded(e.dataTransfer.files);
            }}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              type="file"
              ref={fileInputRef}
              multiple
              style={{ display: 'none' }}
              onChange={(e) => handleFilesAdded(e.target.files)}
              disabled={isExpired || totalFilesCount >= maxFiles}
            />
            <Upload className="dropzone-icon" />
            <div className="dropzone-title">Drag & drop files here, or click to browse</div>
            <div className="dropzone-subtitle">
              Max {formatBytes(maxPerFile)} per file • Max {formatBytes(totalCapacity)} per room • Up to {maxFiles} files
            </div>
          </div>

          {/* Queue List */}
          {queue.length > 0 && (
            <div>
              <ul className="file-list">
                {queue.map((item) => (
                  <li key={item.id} className="file-item">
                    <div className="file-info">
                      <span className="file-name" title={item.file.name}>{item.file.name}</span>
                      <span className="file-size">{formatBytes(item.file.size)}</span>
                      {item.status === 'error' && (
                        <span style={{ color: 'var(--danger-color)', fontSize: '0.75rem' }}>
                          {item.errorMessage || 'Failed'}
                        </span>
                      )}
                    </div>

                    <div className="file-status-group">
                      {item.status === 'uploading' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div className="file-progress-bar">
                            <div
                              className="file-progress-fill"
                              style={{ width: `${item.progress}%` }}
                            />
                          </div>
                          <span style={{ fontSize: '0.75rem', minWidth: '35px' }}>{item.progress}%</span>
                        </div>
                      )}

                      {item.status === 'completed' && (
                        <span style={{ color: 'var(--success-color)', fontSize: '0.85rem' }}>
                          Uploaded
                        </span>
                      )}

                      {item.status === 'pending' && (
                        <button
                          className="btn-icon btn-danger"
                          title="Remove from queue"
                          onClick={() => removeQueueItem(item.id)}
                          disabled={isUploading}
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>

              {queue.some((i) => i.status === 'pending') && (
                <button
                  className="btn btn-primary"
                  style={{ width: '100%' }}
                  onClick={startUpload}
                  disabled={isExpired || isUploading}
                >
                  {isUploading ? 'Uploading (up to 3 simultaneous)...' : 'Upload Queued Files'}
                </button>
              )}
            </div>
          )}

          {isExpired && (
            <div className="alert alert-danger" style={{ marginTop: '20px' }}>
              This room has expired. New uploads and downloads are blocked.
            </div>
          )}
        </>
      )}
    </div>
  );
};
