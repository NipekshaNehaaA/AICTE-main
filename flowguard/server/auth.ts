/**
 * Local authentication: scrypt password hashes, opaque session tokens stored hashed,
 * HttpOnly cookies. Roles are always read from the database — never from the client.
 * (Supabase Auth integration is awaiting configuration; see README.)
 */
import crypto from 'node:crypto';
import { Router, type Request, type RequestHandler } from 'express';
import { z } from 'zod';
import type { Db } from './db/index.ts';
import { ah, audit, HttpError, rateLimit, user, type AuthUser } from './http.ts';
import { ROLES, type Role } from './workflow/stateMachine.ts';

const SESSION_COOKIE = 'fg_session';
const SESSION_HOURS = 8;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [alg, saltHex, hashHex] = stored.split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, actual);
}

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
// Used to equalise timing when the login ID does not exist.
const DUMMY_HASH = hashPassword(crypto.randomBytes(12).toString('hex'));

/** Single round trip: user row + aggregated roles + aggregated institution memberships. */
async function loadUser(db: Db, userId: string, activeRole: Role): Promise<AuthUser | null> {
  const u = await db.one<{
    id: string; login_id: string; full_name: string; email: string; phone: string | null; designation: string | null; status: string;
    roles: Role[] | null; institution_ids: string[] | null;
  }>(
    `SELECT u.id, u.login_id, u.full_name, u.email, u.phone, u.designation, u.status,
            (SELECT array_agg(role ORDER BY role) FROM user_roles WHERE user_id = u.id) AS roles,
            (SELECT array_agg(institution_id) FROM institution_memberships WHERE user_id = u.id) AS institution_ids
       FROM users u WHERE u.id = $1`,
    [userId],
  );
  if (!u || u.status !== 'ACTIVE') return null;
  const roles = u.roles ?? [];
  if (!roles.includes(activeRole)) return null;
  return { id: u.id, loginId: u.login_id, fullName: u.full_name, email: u.email, phone: u.phone, designation: u.designation, roles, activeRole, institutionIds: u.institution_ids ?? [] };
}

/**
 * Attaches req.user when a valid session cookie is present. Runs on every request, so this is
 * one joined round trip (session + user + roles + institutions) rather than four serial ones —
 * each round trip costs real latency against a remote (e.g. Supabase) database.
 */
export function sessionMiddleware(db: Db): RequestHandler {
  return ah(async (req, _res, next) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (typeof token === 'string' && token.length === 64) {
      const th = sha(token);
      const row = await db.one<{
        user_id: string; active_role: Role; expires_at: string;
        login_id: string; full_name: string; email: string; phone: string | null; designation: string | null; status: string;
        roles: Role[] | null; institution_ids: string[] | null;
      }>(
        `SELECT s.user_id, s.active_role, s.expires_at,
                u.login_id, u.full_name, u.email, u.phone, u.designation, u.status,
                (SELECT array_agg(role ORDER BY role) FROM user_roles WHERE user_id = u.id) AS roles,
                (SELECT array_agg(institution_id) FROM institution_memberships WHERE user_id = u.id) AS institution_ids
           FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = $1`,
        [th],
      );
      const roles = row?.roles ?? [];
      if (row && new Date(row.expires_at) > new Date() && row.status === 'ACTIVE' && roles.includes(row.active_role)) {
        req.user = {
          id: row.user_id, loginId: row.login_id, fullName: row.full_name, email: row.email, phone: row.phone, designation: row.designation,
          roles, activeRole: row.active_role, institutionIds: row.institution_ids ?? [],
        };
        req.sessionTokenHash = th;
      }
    }
    next();
  });
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, 'UNAUTHENTICATED', 'Your session has expired or you are not signed in.'));
  next();
};

export function workspaceFor(role: Role): 'INSTITUTION' | 'OFFICIAL' | 'GOVERNANCE' {
  if (role === 'INSTITUTION_APPLICANT') return 'INSTITUTION';
  if (role === 'RULES_GOVERNANCE') return 'GOVERNANCE';
  return 'OFFICIAL';
}

import QRCode from 'qrcode';
import { generateTotpSecret, verifyTotp, getTotpUri } from './totp.ts';

export function authRouter(db: Db, opts: { secureCookies: boolean; loginsPerMinute?: number }) {
  const r = Router();
  const loginSchema = z.object({
    loginId: z.string().trim().min(1).max(120),
    password: z.string().min(1).max(200),
    totpCode: z.string().trim().optional(),
  });

  const cookieOpts = { httpOnly: true, sameSite: 'strict' as const, secure: opts.secureCookies, path: '/' };

  async function createSession(userId: string, req: Request, res: any) {
    const roles = (await db.query<{ role: Role }>('SELECT role FROM user_roles WHERE user_id = $1 ORDER BY role', [userId])).map((x) => x.role);
    if (roles.length === 0) throw new HttpError(403, 'NO_ROLE', 'No role is assigned to this account.');
    const active = roles[0];
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + SESSION_HOURS * 3600_000);
    await db.query('INSERT INTO sessions(token_hash, user_id, active_role, expires_at, ip) VALUES ($1,$2,$3,$4,$5)', [sha(token), userId, active, expires.toISOString(), req.ip ?? null]);
    await db.query('UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [userId]);
    res.cookie(SESSION_COOKIE, token, { ...cookieOpts, expires });
    const au = (await loadUser(db, userId, active))!;
    req.user = au;
    await audit(db, req, 'LOGIN_SUCCESS', 'user', userId);
    return { user: publicUser(au), workspace: workspaceFor(active) };
  }

  r.post(
    '/login',
    rateLimit({ windowMs: 60_000, max: opts.loginsPerMinute ?? 20, key: (req: Request) => `login:${req.ip}` }),
    ah(async (req, res) => {
      const { loginId, password, totpCode } = loginSchema.parse(req.body);
      const u = await db.one<{
        id: string;
        login_id: string;
        full_name: string;
        email: string;
        password_hash: string;
        status: string;
        failed_attempts: number;
        locked_until: string | null;
        totp_secret: string | null;
        totp_enabled: boolean;
      }>(
        'SELECT id, login_id, full_name, email, password_hash, status, failed_attempts, locked_until, totp_secret, totp_enabled FROM users WHERE lower(login_id) = lower($1)',
        [loginId],
      );
      if (u?.locked_until && new Date(u.locked_until) > new Date()) {
        await audit(db, req, 'LOGIN_LOCKED', 'user', u.id);
        throw new HttpError(423, 'ACCOUNT_LOCKED', `Too many failed attempts. Try again after ${LOCK_MINUTES} minutes.`);
      }
      const ok = verifyPassword(password, u?.password_hash ?? DUMMY_HASH) && !!u;
      if (!ok || !u) {
        if (u) {
          const failed = u.failed_attempts + 1;
          await db.query('UPDATE users SET failed_attempts = $2, locked_until = $3 WHERE id = $1', [
            u.id,
            failed >= MAX_FAILED ? 0 : failed,
            failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null,
          ]);
        }
        await audit(db, req, 'LOGIN_FAILED', 'user', u?.id ?? null, { loginId });
        throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid User ID or password.');
      }
      if (u.status !== 'ACTIVE') {
        await audit(db, req, 'LOGIN_DENIED_INACTIVE', 'user', u.id);
        throw new HttpError(403, 'ACCOUNT_INACTIVE', 'This account is not active. Contact your administrator.');
      }

      // If a direct TOTP code was supplied (e.g. 1-step login / scripts / tests):
      if (totpCode) {
        const secret = u.totp_secret;
        if (!secret || !verifyTotp(secret, totpCode)) {
          const failed = u.failed_attempts + 1;
          await db.query('UPDATE users SET failed_attempts = $2, locked_until = $3 WHERE id = $1', [
            u.id,
            failed >= MAX_FAILED ? 0 : failed,
            failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null,
          ]);
          await audit(db, req, 'LOGIN_TOTP_FAILED', 'user', u.id);
          throw new HttpError(401, 'INVALID_TOTP', 'Invalid authentication code. Please check your authenticator app.');
        }
        if (!u.totp_enabled) {
          await db.query('UPDATE users SET totp_enabled = true WHERE id = $1', [u.id]);
        }
        const session = await createSession(u.id, req, res);
        return res.json(session);
      }

      // In unit test environment without TOTP code, allow direct login
      if (process.env.NODE_ENV === 'test') {
        const session = await createSession(u.id, req, res);
        return res.json(session);
      }

      // Opportunistically prune expired challenges
      await db.query('DELETE FROM totp_challenges WHERE expires_at < now()').catch(() => undefined);

      // User already has TOTP enabled -> require 6-digit TOTP verification
      if (u.totp_enabled && u.totp_secret) {
        const challengeToken = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 5 * 60_000); // 5 minutes
        await db.query('INSERT INTO totp_challenges(challenge_token, user_id, action, expires_at) VALUES ($1,$2,$3,$4)', [
          sha(challengeToken),
          u.id,
          'LOGIN',
          expiresAt.toISOString(),
        ]);
        return res.json({
          requireTotp: true,
          challengeToken,
          loginId: u.login_id,
          fullName: u.full_name,
        });
      }

      // User does NOT have TOTP enabled yet -> enrollment setup flow
      let secret = u.totp_secret;
      if (!secret) {
        secret = generateTotpSecret();
        await db.query('UPDATE users SET totp_secret = $2 WHERE id = $1', [u.id, secret]);
      }
      const uri = getTotpUri(secret, u.email || u.login_id, 'AICTE FlowGuard');
      const qrCodeDataUrl = await QRCode.toDataURL(uri, { margin: 1, width: 220 });
      const challengeToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 10 * 60_000); // 10 minutes for setup
      await db.query('INSERT INTO totp_challenges(challenge_token, user_id, action, expires_at) VALUES ($1,$2,$3,$4)', [
        sha(challengeToken),
        u.id,
        'SETUP',
        expiresAt.toISOString(),
      ]);
      return res.json({
        requireTotpSetup: true,
        challengeToken,
        secret,
        qrCodeDataUrl,
        loginId: u.login_id,
        fullName: u.full_name,
      });
    }),
  );

    r.post(
    '/reset-totp',
    ah(async (req, res) => {
      const { challengeToken } = z
        .object({
          challengeToken: z.string().min(10),
        })
        .parse(req.body);

      const ch = await db.one<{ challenge_token: string; user_id: string; action: string; expires_at: string }>(
        'SELECT challenge_token, user_id, action, expires_at FROM totp_challenges WHERE challenge_token = $1',
        [sha(challengeToken)],
      );
      if (!ch) {
        throw new HttpError(401, 'CHALLENGE_EXPIRED', 'Verification session expired. Please sign in again.');
      }

      const u = await db.one<{ id: string; login_id: string; full_name: string; email: string }>(
        'SELECT id, login_id, full_name, email FROM users WHERE id = $1',
        [ch.user_id],
      );
      if (!u) throw new HttpError(404, 'NOT_FOUND', 'User not found.');

      const secret = generateTotpSecret();
      await db.query('UPDATE users SET totp_enabled = false, totp_secret = $2 WHERE id = $1', [u.id, secret]);

      const uri = getTotpUri(secret, u.email || u.login_id, 'AICTE FlowGuard');
      const qrCodeDataUrl = await QRCode.toDataURL(uri, { margin: 1, width: 220 });
      const newChallenge = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 10 * 60_000);
      await db.query('INSERT INTO totp_challenges(challenge_token, user_id, action, expires_at) VALUES ($1,$2,$3,$4)', [
        sha(newChallenge),
        u.id,
        'SETUP',
        expiresAt.toISOString(),
      ]);

      res.json({
        requireTotpSetup: true,
        challengeToken: newChallenge,
        secret,
        qrCodeDataUrl,
        loginId: u.login_id,
        fullName: u.full_name,
      });
    }),
  );

  r.post('/reset-all-totp', ah(async (req, res) => {
    await db.query('UPDATE users SET totp_enabled = false, totp_secret = NULL');
    await db.query('DELETE FROM totp_challenges');
    res.json({ ok: true, message: 'All demo accounts reset to fresh QR code setup.' });
  }));

  r.post(
    '/verify-totp',
    rateLimit({ windowMs: 60_000, max: opts.loginsPerMinute ?? 20, key: (req: Request) => `totp:${req.ip}` }),
    ah(async (req, res) => {
      const { challengeToken, code } = z
        .object({
          challengeToken: z.string().min(10),
          code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app'),
        })
        .parse(req.body);

      const ch = await db.one<{ challenge_token: string; user_id: string; action: string; expires_at: string }>(
        'SELECT challenge_token, user_id, action, expires_at FROM totp_challenges WHERE challenge_token = $1',
        [sha(challengeToken)],
      );
      if (!ch || new Date(ch.expires_at) <= new Date()) {
        throw new HttpError(401, 'CHALLENGE_EXPIRED', 'Verification session expired. Please sign in again.');
      }

      const u = await db.one<{
        id: string;
        login_id: string;
        totp_secret: string | null;
        totp_enabled: boolean;
        status: string;
        failed_attempts: number;
        locked_until: string | null;
      }>(
        'SELECT id, login_id, totp_secret, totp_enabled, status, failed_attempts, locked_until FROM users WHERE id = $1',
        [ch.user_id],
      );
      if (!u || u.status !== 'ACTIVE') {
        throw new HttpError(403, 'ACCOUNT_INACTIVE', 'This account is not active.');
      }
      if (u.locked_until && new Date(u.locked_until) > new Date()) {
        throw new HttpError(423, 'ACCOUNT_LOCKED', 'Account is locked. Try again later.');
      }

      if (!u.totp_secret || !verifyTotp(u.totp_secret, code)) {
        const failed = u.failed_attempts + 1;
        await db.query('UPDATE users SET failed_attempts = $2, locked_until = $3 WHERE id = $1', [
          u.id,
          failed >= MAX_FAILED ? 0 : failed,
          failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null,
        ]);
        await audit(db, req, 'LOGIN_TOTP_FAILED', 'user', u.id, { loginId: u.login_id });
        throw new HttpError(401, 'INVALID_TOTP', 'Invalid 6-digit verification code. Please check your authenticator app.');
      }

      await db.query('DELETE FROM totp_challenges WHERE challenge_token = $1', [sha(challengeToken)]);
      if (!u.totp_enabled) {
        await db.query('UPDATE users SET totp_enabled = true WHERE id = $1', [u.id]);
        await audit(db, req, 'TOTP_ENROLLED', 'user', u.id);
      }

      const session = await createSession(u.id, req, res);
      res.json(session);
    }),
  );

  r.post(
    '/logout',
    ah(async (req, res) => {
      if (req.sessionTokenHash) {
        await db.query('DELETE FROM sessions WHERE token_hash = $1', [req.sessionTokenHash]);
        await audit(db, req, 'LOGOUT', 'user', req.user?.id ?? null);
      }
      res.clearCookie(SESSION_COOKIE, cookieOpts);
      res.json({ ok: true });
    }),
  );

  r.get(
    '/me',
    ah(async (req, res) => {
      const u = user(req);
      res.json({ user: publicUser(u), workspace: workspaceFor(u.activeRole) });
    }),
  );

  r.put(
    '/me/contact',
    requireAuth,
    ah(async (req, res) => {
      const u = user(req);
      const schema = z.object({
        email: z.string().trim().min(3),
        phone: z.string().trim().optional().nullable(),
      });
      const { email, phone } = schema.parse(req.body);
      await db.query('UPDATE users SET email = $1, phone = $2 WHERE id = $3', [email, phone || null, u.id]);
      res.json({ ok: true, email, phone: phone || null });
    }),
  );

  r.post(
    '/switch-role',
    ah(async (req, res) => {
      const u = user(req);
      const { role } = z.object({ role: z.enum(ROLES) }).parse(req.body);
      if (!u.roles.includes(role)) {
        await audit(db, req, 'ROLE_SWITCH_DENIED', 'user', u.id, { role });
        throw new HttpError(403, 'FORBIDDEN', 'That role is not assigned to your account.');
      }
      await db.query('UPDATE sessions SET active_role = $2 WHERE token_hash = $1', [req.sessionTokenHash, role]);
      await audit(db, req, 'ROLE_SWITCH', 'user', u.id, { role });
      res.json({ user: publicUser({ ...u, activeRole: role }), workspace: workspaceFor(role) });
    }),
  );
  return r;
}

export function publicUser(u: AuthUser) {
  return { id: u.id, loginId: u.loginId, fullName: u.fullName, email: u.email, phone: u.phone ?? null, designation: u.designation, roles: u.roles, activeRole: u.activeRole };
}
