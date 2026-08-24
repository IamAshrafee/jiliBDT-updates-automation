import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

interface EncryptedSessionEnvelope {
  version: 1;
  algorithm: 'aes-256-gcm';
  iv: string;
  tag: string;
  ciphertext: string;
}

function keyBytes(secret: string): Buffer {
  const trimmed = secret.trim();
  const decoded = /^[a-f\d]{64}$/i.test(trimmed)
    ? Buffer.from(trimmed, 'hex')
    : Buffer.from(trimmed, 'base64');
  if (decoded.length === 32) return decoded;
  if (trimmed.length >= 32) return createHash('sha256').update(trimmed).digest();
  throw new Error('Telegram session encryption key must contain at least 32 characters.');
}

export function encryptSession(session: string, secret: string): EncryptedSessionEnvelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBytes(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(session, 'utf8'), cipher.final()]);
  return {
    version: 1,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

export function decryptSession(envelope: EncryptedSessionEnvelope, secret: string): string {
  if (envelope.version !== 1 || envelope.algorithm !== 'aes-256-gcm') {
    throw new Error('Unsupported encrypted Telegram session format.');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    keyBytes(secret),
    Buffer.from(envelope.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

export async function writeEncryptedSession(
  path: string,
  session: string,
  secret: string,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(encryptSession(session, secret))}\n`, { mode: 0o600 });
}

export async function readEncryptedSession(path: string, secret: string): Promise<string> {
  const raw = JSON.parse(await readFile(path, 'utf8')) as EncryptedSessionEnvelope;
  return decryptSession(raw, secret);
}
