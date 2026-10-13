// Cryptographic utilities using Web Crypto API

/**
 * Generate a friendly alphanumeric Room ID (e.g. "QK7M-89P2" or "qk7m89p2")
 * 8 characters, URL safe, readable.
 */
export function generateRoomId(): string {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // exclude confusing chars like 0, O, 1, I
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return `${result.slice(0, 4)}-${result.slice(4)}`;
}

/**
 * Generate a 6-digit numeric or alphanumeric passcode
 */
export function generatePasscode(): string {
  const chars = '0123456789';
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

/**
 * Generate random salt
 */
export function generateSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Hash passcode with salt using SHA-256
 */
export async function hashPasscode(passcode: string, salt: string): Promise<string> {
  const enc = new TextEncoder();
  const data = enc.encode(`${salt}:${passcode.trim()}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Verify passcode with constant time check
 */
export async function verifyPasscode(passcode: string, salt: string, storedHash: string): Promise<boolean> {
  const computedHash = await hashPasscode(passcode, salt);
  if (computedHash.length !== storedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < computedHash.length; i++) {
    diff |= computedHash.charCodeAt(i) ^ storedHash.charCodeAt(i);
  }
  return diff === 0;
}
