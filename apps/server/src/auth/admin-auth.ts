import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { RunRepository } from '@jilibdt/db';
import { verifyPassword } from './password.js';

export const ADMIN_COOKIE = 'jilibdt_admin_session';

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export class AdminAuthService {
  public constructor(
    private readonly repository: RunRepository,
    private readonly config: {
      username: string;
      passwordHash?: string;
      legacyToken?: string;
      sessionSecret: string;
      sessionHours: number;
    },
  ) {}

  private digest(value: string): string {
    return createHmac('sha256', this.config.sessionSecret).update(value).digest('hex');
  }

  async login(
    username: string,
    password: string,
  ): Promise<{ token: string; expiresAt: Date } | null> {
    if (!safeEqual(username, this.config.username)) return null;
    const valid = this.config.passwordHash
      ? await verifyPassword(password, this.config.passwordHash)
      : Boolean(this.config.legacyToken && safeEqual(password, this.config.legacyToken));
    if (!valid) return null;
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.config.sessionHours * 60 * 60 * 1000);
    this.repository.saveAdminSession(this.digest(token), expiresAt);
    return { token, expiresAt };
  }

  logout(): void {
    this.repository.saveAdminSession(null, null);
  }

  isAuthenticated(request: FastifyRequest): boolean {
    const token = (request as FastifyRequest & { cookies: Record<string, string | undefined> })
      .cookies[ADMIN_COOKIE];
    const settings = this.repository.getSettings();
    if (!token || !settings?.adminSessionHash || !settings.adminSessionExpiresAt) return false;
    if (settings.adminSessionExpiresAt.getTime() <= Date.now()) return false;
    return safeEqual(this.digest(token), settings.adminSessionHash);
  }
}

export function isSafeMutationOrigin(request: FastifyRequest, expectedOrigin: string): boolean {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return true;
  return request.headers.origin === expectedOrigin;
}
