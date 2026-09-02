import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { Role } from "@loom/shared";
import { env } from "../config/env";
import { forbidden, HttpError } from "../lib/errors";

export const AUTH_COOKIE = "crm_token";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(user: AuthUser): string {
  return jwt.sign({ sub: user.id, name: user.name, email: user.email, role: user.role }, env.JWT_SECRET, {
    expiresIn: `${env.JWT_EXPIRES_DAYS}d`,
  });
}

export function setAuthCookie(res: Response, token: string) {
  res.cookie(AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.COOKIE_SECURE,
    maxAge: env.JWT_EXPIRES_DAYS * 86_400_000,
    path: "/",
  });
}

export function clearAuthCookie(res: Response) {
  res.clearCookie(AUTH_COOKIE, { path: "/" });
}

/** Parses the auth cookie (or a Bearer token) if present. Never rejects on its own. */
export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const bearer = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : null;
  const token = (req.cookies?.[AUTH_COOKIE] as string | undefined) ?? bearer;
  if (token) {
    try {
      const payload = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload;
      if (payload.sub && payload.role) {
        req.user = { id: String(payload.sub), name: String(payload.name ?? ""), email: String(payload.email ?? ""), role: payload.role as Role };
      }
    } catch {
      // invalid/expired token: treat as anonymous
    }
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, "Authentication required"));
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new HttpError(401, "Authentication required"));
    if (!roles.includes(req.user.role)) return next(forbidden("Insufficient role"));
    next();
  };
}

/** Mongo filter fragment restricting members to their own records. Admins see everything. */
export function ownerScope(req: Request): Record<string, unknown> {
  if (!req.user) throw new HttpError(401, "Authentication required");
  return req.user.role === "admin" ? {} : { owner: req.user.id };
}

export function isAdmin(req: Request): boolean {
  return req.user?.role === "admin";
}

export function assertCanAccess(req: Request, ownerId: unknown) {
  if (!req.user) throw new HttpError(401, "Authentication required");
  if (req.user.role === "admin") return;
  if (String(ownerId) !== req.user.id) throw forbidden("You can only access your own records");
}
