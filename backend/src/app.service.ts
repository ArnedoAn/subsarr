import { Injectable } from '@nestjs/common';

export interface HealthResponse {
  status: 'ok';
  service: 'subsync-api';
  timestamp: string;
}

@Injectable()
export class AppService {
  getHealth(): HealthResponse {
    return {
      status: 'ok',
      service: 'subsync-api',
      timestamp: new Date().toISOString(),
    };
  }
}
