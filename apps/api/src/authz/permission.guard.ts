import { type CanActivate, type ExecutionContext, HttpException, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ActiveSession, RoleRepository } from '@tga/database';
import type { Request } from 'express';
import type { AuthService } from '../auth/auth-service';
import type { Permission } from './permissions';

/** DI token for the guard's dependencies (Nest builds guards itself for @UseGuards). */
export const PERMISSION_GUARD_DEPS = Symbol('PERMISSION_GUARD_DEPS');

export interface PermissionGuardDeps {
  auth: AuthService;
  roles: RoleRepository;
  log?: (event: string, fields: Record<string, unknown>) => void;
}

type Requirement = { kind: 'authenticated' } | { kind: 'permission'; permission: Permission };

const REQUIREMENT = 'tga:authz-requirement';

/** Any signed-in user (object-level checks then happen in the service). */
export const Authenticated = () => SetMetadata(REQUIREMENT, { kind: 'authenticated' } satisfies Requirement);

/** A signed-in user holding `permission` through one of their roles. */
export const RequirePermission = (permission: Permission) => SetMetadata(REQUIREMENT, { kind: 'permission', permission } satisfies Requirement);

export interface Principal {
  user: ActiveSession['user'];
  session: ActiveSession['session'];
  permissions: ReadonlySet<string>;
}

/** The principal the guard attached to this request (only on guarded routes). */
export function principalOf(req: Request): Principal {
  const p = (req as Request & { principal?: Principal }).principal;
  if (!p) throw new Error('principalOf() used on a route without PermissionGuard');
  return p;
}

function fail(status: number, code: string, message: string, req: Request): never {
  throw new HttpException({ error: { code, message, requestId: String(req.headers['x-request-id'] ?? '') } }, status);
}

/**
 * Server-side authorization for every guarded route (FR-AUTH-03, T07). Deny by default: a route
 * without @Authenticated() or @RequirePermission() is refused. Permissions are read from the
 * database on each request, so role changes apply immediately. Denials are logged.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  private readonly reflector = new Reflector();

  constructor(@Inject(PERMISSION_GUARD_DEPS) private readonly deps: PermissionGuardDeps) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const requirement = this.reflector.getAllAndOverride<Requirement | undefined>(REQUIREMENT, [ctx.getHandler(), ctx.getClass()]);
    const requestId = String(req.headers['x-request-id'] ?? '');
    if (!requirement) {
      this.deps.log?.('authz.denied', { requestId, reason: 'no_requirement_declared', route: req.path });
      fail(403, 'forbidden', 'Not allowed', req);
    }

    const result = await this.deps.auth.authenticate(
      { cookie: req.headers.cookie, origin: req.headers.origin, contentType: req.headers['content-type'], csrf: req.headers['x-csrf-token'], userAgent: req.headers['user-agent'], requestId },
      req.method,
    );
    if (result.kind === 'error') fail(result.status, result.code, result.message, req);

    const { user, session } = result.active;
    const permissions = await this.deps.roles.permissionsOf(user.id);
    if (requirement.kind === 'permission' && !permissions.has(requirement.permission)) {
      this.deps.log?.('authz.denied', { requestId, userId: user.id, permission: requirement.permission, route: req.path });
      fail(403, 'forbidden', 'Not allowed', req);
    }
    (req as Request & { principal?: Principal }).principal = { user, session, permissions };
    return true;
  }
}
