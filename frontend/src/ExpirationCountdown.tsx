import React, { useEffect, useState } from 'react';
import { formatDuration } from './utils';

interface ExpirationCountdownProps {
  expiresAt: number; // Unix timestamp in seconds
  onExpire?: () => void;
}

export const ExpirationCountdown: React.FC<ExpirationCountdownProps> = ({ expiresAt, onExpire }) => {
  const [secondsRemaining, setSecondsRemaining] = useState<number>(() => {
    return Math.max(0, expiresAt - Math.floor(Date.now() / 1000));
  });

  useEffect(() => {
    const check = () => {
      const remaining = Math.max(0, expiresAt - Math.floor(Date.now() / 1000));
      setSecondsRemaining(remaining);
      if (remaining <= 0 && onExpire) {
        onExpire();
      }
    };

    check();
    const interval = setInterval(check, 1000);
    return () => clearInterval(interval);
  }, [expiresAt, onExpire]);

  const isLow = secondsRemaining < 300; // < 5 minutes
  const isExpired = secondsRemaining <= 0;

  return (
    <div className={`countdown-badge ${isExpired ? 'expired' : isLow ? 'warning' : ''}`}>
      <span className="countdown-label">
        {isExpired ? 'Room Expired' : 'Room expires in:'}
      </span>
      <span className="countdown-timer">
        {isExpired ? '00:00' : formatDuration(secondsRemaining)}
      </span>
    </div>
  );
};
