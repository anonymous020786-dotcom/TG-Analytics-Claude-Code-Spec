import { Controller, Delete, Get, Header, HttpCode, HttpException, Inject, Param, Put, Req, UseGuards } from '@nestjs/common';
import type { AuditLogRepository, RoleRepository, SessionRepository, UserRepository } from '@tga/database';
import type { Request } from 'express';
import { Authenticated, PermissionGuard, principalOf, RequirePermission } from './permission.guard';
import { PERMISSIONS } from './permissions';

export const AUTHZ_DEPS = Symbol('AUTHZ_DEPS');

export interface AuthzDeps {
  users: UserRepository;
  sessions: SessionRepository;
  roles: RoleRepository;
  audit: AuditLogRepository;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLE_KEY = /^[a-z][a-z0-9_]{1,31}$/;

function fail(status: number, code: string, message: string, req: Request): never {
  throw new HttpException({ error: { code, message, requestId: String(req.headers['x-request-id'] ?? '') } }, status);
}
const requestIdOf = (req: Request) => String(req.headers['x-request-id'] ?? '');

/**
 * The caller's own sessions (object-level authorization, T06): a session id that is not the
 * caller's is indistinguishable from one that does not exist (404).
 */
@Controller('api/v1/auth/sessions')
@UseGuards(PermissionGuard)
export class SessionsController {
  constructor(@Inject(AUTHZ_DEPS) private readonly deps: AuthzDeps) {}

  @Get()
  @Authenticated()
  @Header('Cache-Control', 'no-store')
  async list(@Req() req: Request) {
    const p = principalOf(req);
    const rows = await this.deps.sessions.listActive(p.user.id);
    return {
      data: rows.map((s) => ({ id: s.id, current: s.id === p.session.id, createdAt: s.createdAt.toISOString(), lastSeenAt: s.lastSeenAt.toISOString(), userAgent: s.userAgent })),
    };
  }

  @Delete(':id')
  @Authenticated()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async revoke(@Param('id') id: string, @Req() req: Request) {
    const p = principalOf(req);
    if (!UUID.test(id) || !(await this.deps.sessions.revokeOwned(p.user.id, id))) fail(404, 'not_found', 'Session not found', req);
    await this.deps.audit.append({ actorType: 'user', actorId: p.user.id, action: 'auth.session_revoked', targetType: 'user_session', targetId: id, requestId: requestIdOf(req) });
    return { data: { revoked: true, current: id === p.session.id } };
  }
}

/**
 * Role management (privileged, audited; FR-AUTH-03, T07). Admin screens come with PHASE-26;
 * this API and the operator CLI are the only ways to change roles.
 */
@Controller('api/v1/admin/users/:userId/roles')
@UseGuards(PermissionGuard)
export class AdminRolesController {
  constructor(@Inject(AUTHZ_DEPS) private readonly deps: AuthzDeps) {}

  private async target(userId: string, req: Request) {
    if (!UUID.test(userId)) fail(404, 'not_found', 'User not found', req);
    const user = await this.deps.users.findById(userId);
    if (!user) fail(404, 'not_found', 'User not found', req);
    return user;
  }

  private async role(key: string, req: Request) {
    if (!ROLE_KEY.test(key) || !(await this.deps.roles.roleExists(key))) fail(404, 'unknown_role', 'Unknown role', req);
    return key;
  }

  @Get()
  @RequirePermission(PERMISSIONS.ROLES_MANAGE)
  @Header('Cache-Control', 'no-store')
  async list(@Param('userId') userId: string, @Req() req: Request) {
    const user = await this.target(userId, req);
    return { data: { userId: user.id, roles: await this.deps.roles.rolesOf(user.id) } };
  }

  @Put(':role')
  @RequirePermission(PERMISSIONS.ROLES_MANAGE)
  @Header('Cache-Control', 'no-store')
  async grant(@Param('userId') userId: string, @Param('role') roleKey: string, @Req() req: Request) {
    const actor = principalOf(req).user;
    const user = await this.target(userId, req);
    const role = await this.role(roleKey, req);
    const granted = await this.deps.roles.grant(user.id, role, actor.id);
    if (granted) await this.deps.audit.append({ actorType: 'user', actorId: actor.id, action: 'role.granted', targetType: 'user', targetId: user.id, metadata: { role }, requestId: requestIdOf(req) });
    return { data: { userId: user.id, role, granted } };
  }

  @Delete(':role')
  @RequirePermission(PERMISSIONS.ROLES_MANAGE)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async revoke(@Param('userId') userId: string, @Param('role') roleKey: string, @Req() req: Request) {
    const actor = principalOf(req).user;
    const user = await this.target(userId, req);
    const role = await this.role(roleKey, req);
    const outcome = await this.deps.roles.revoke(user.id, role);
    if (outcome === 'last_holder') fail(409, 'last_role_holder', `The last ${role} cannot be removed`, req);
    if (outcome === 'revoked') await this.deps.audit.append({ actorType: 'user', actorId: actor.id, action: 'role.revoked', targetType: 'user', targetId: user.id, metadata: { role }, requestId: requestIdOf(req) });
    return { data: { userId: user.id, role, revoked: outcome === 'revoked' } };
  }
}
