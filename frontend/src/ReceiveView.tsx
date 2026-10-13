import React, { useState } from 'react';
import type { RoomInfo, RoomFile } from './types';
import { getRoom, downloadFile } from './api';
import { formatBytes, downloadAllAsZip } from './utils';
import { ExpirationCountdown } from './ExpirationCountdown';
import { Download, ArrowLeft, AlertCircle, Archive } from 'lucide-react';

interface ReceiveViewProps {
  onBack: () => void;
}

export const ReceiveView: React.FC<ReceiveViewProps> = ({ onBack }) => {
  const [roomIdInput, setRoomIdInput] = useState<string>('');
  const [passcodeInput, setPasscodeInput] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [currentPasscode, setCurrentPasscode] = useState<string>('');
  const [isExpired, setIsExpired] = useState<boolean>(false);

  // Download state trackers
  const [downloadingFileId, setDownloadingFileId] = useState<string | null>(null);
  const [fileProgress, setFileProgress] = useState<number>(0);
  const [isDownloadingAll, setIsDownloadingAll] = useState<boolean>(false);
  const [zipStatus, setZipStatus] = useState<string>('');

  const handleAccessRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomIdInput.trim() || !passcodeInput.trim()) {
      setError('Please enter both Room ID and Passcode');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await getRoom(roomIdInput, passcodeInput);
      setRoom(data);
      setCurrentPasscode(passcodeInput.trim());
      setIsExpired(false);
    } catch (err: any) {
      setError(err.message || 'Failed to access room');
      setRoom(null);
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadSingle = async (file: RoomFile) => {
    if (!room || !currentPasscode || isExpired) return;

    setError(null);
    setDownloadingFileId(file.id);
    setFileProgress(0);

    try {
      await downloadFile(room.roomId, currentPasscode, file, (_, __, percent) => {
        setFileProgress(percent);
      });
    } catch (err: any) {
      setError(`Failed to download ${file.filename}: ${err.message}`);
    } finally {
      setDownloadingFileId(null);
      setFileProgress(0);
    }
  };

  const handleDownloadAll = async () => {
    if (!room || !currentPasscode || !room.files || room.files.length === 0 || isExpired) return;

    setError(null);
    setIsDownloadingAll(true);
    setZipStatus('Preparing archive...');

    try {
      await downloadAllAsZip(
        room.roomId,
        currentPasscode,
        room.files,
        (currentFile, index, total) => {
          setZipStatus(`Archiving ${index} of ${total}: ${currentFile}`);
        }
      );
      setZipStatus('Archive downloaded!');
      setTimeout(() => setZipStatus(''), 3000);
    } catch (err: any) {
      setError(`Download all failed: ${err.message}`);
    } finally {
      setIsDownloadingAll(false);
    }
  };

  return (
    <div className="card">
      <button className="back-link" onClick={onBack}>
        <ArrowLeft size={16} /> Back to Home
      </button>

      <div className="card-header">
        <h2 className="card-title">Receive Files</h2>
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

      {/* Access Room Form (When not accessed yet) */}
      {!room && (
        <form onSubmit={handleAccessRoom}>
          <div className="form-group">
            <label className="form-label" htmlFor="room-id">Room ID</label>
            <input
              id="room-id"
              className="form-input"
              type="text"
              placeholder="e.g. 7X8K-9LP2"
              value={roomIdInput}
              onChange={(e) => setRoomIdInput(e.target.value.toUpperCase())}
              autoComplete="off"
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="passcode">Passcode</label>
            <input
              id="passcode"
              className="form-input"
              type="password"
              placeholder="6-digit passcode"
              value={passcodeInput}
              onChange={(e) => setPasscodeInput(e.target.value)}
              autoComplete="off"
              required
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', marginTop: '8px' }}
            disabled={loading}
          >
            {loading ? 'Validating...' : 'Access Room'}
          </button>
        </form>
      )}

      {/* Room Content */}
      {room && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Room: </span>
              <strong>{room.roomId}</strong>
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              {room.files.length} file{room.files.length === 1 ? '' : 's'} • Total: {formatBytes(room.totalSizeBytes)}
            </div>
          </div>

          {room.files.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)' }}>
              No files have been uploaded to this room yet.
            </div>
          ) : (
            <>
              {room.files.length > 1 && (
                <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <button
                    className="btn btn-secondary"
                    onClick={handleDownloadAll}
                    disabled={isDownloadingAll || isExpired}
                  >
                    <Archive size={16} />
                    {isDownloadingAll ? 'Creating ZIP...' : 'Download All (.zip)'}
                  </button>
                  {zipStatus && (
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {zipStatus}
                    </span>
                  )}
                </div>
              )}

              <ul className="file-list">
                {room.files.map((file: RoomFile) => {
                  const isCurrent = downloadingFileId === file.id;
                  return (
                    <li key={file.id} className="file-item">
                      <div className="file-info">
                        <span className="file-name" title={file.filename}>{file.filename}</span>
                        <span className="file-size">{formatBytes(file.size_bytes)}</span>
                      </div>

                      <div className="file-status-group">
                        {isCurrent && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div className="file-progress-bar">
                              <div
                                className="file-progress-fill"
                                style={{ width: `${fileProgress}%` }}
                              />
                            </div>
                            <span style={{ fontSize: '0.75rem' }}>{fileProgress}%</span>
                          </div>
                        )}

                        <button
                          className="btn btn-secondary"
                          style={{ padding: '6px 14px', fontSize: '0.85rem' }}
                          onClick={() => handleDownloadSingle(file)}
                          disabled={isCurrent || isDownloadingAll || isExpired}
                        >
                          <Download size={14} /> Download
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {isExpired && (
            <div className="alert alert-danger" style={{ marginTop: '20px' }}>
              This room has expired. Files can no longer be downloaded.
            </div>
          )}
        </div>
      )}
    </div>
  );
};
