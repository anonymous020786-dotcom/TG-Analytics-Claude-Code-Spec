import { Controller, Get, Header } from '@nestjs/common';

export interface LivenessResponse {
  status: 'ok';
}

/**
 * Liveness only: the process is up and serving HTTP. Readiness (dependency
 * checks) is added with the dependencies themselves (PHASE-04+, PHASE-27).
 */
@Controller('health')
export class HealthController {
  @Get('live')
  @Header('Cache-Control', 'no-store')
  live(): LivenessResponse {
    return { status: 'ok' };
  }
}
