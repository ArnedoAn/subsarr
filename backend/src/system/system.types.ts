export interface PermissionCheck {
  path: string;
  available: boolean;
  readable: boolean;
  writable: boolean;
  error?: string;
}

export interface RootCheck extends PermissionCheck {
  allowed: boolean;
  selected: boolean;
}

export interface PreflightReport {
  status: 'ok' | 'warning' | 'error';
  app: { status: 'ok'; version: string };
  data: PermissionCheck;
  database: {
    status: 'ok' | 'error';
    accessible: boolean;
    migrationsPending: boolean | null;
    error?: string;
  };
  secretKey: {
    status: 'ok' | 'warning' | 'error';
    available: boolean;
    source: 'environment' | 'file';
    error?: string;
  };
  redis: { status: 'ok' | 'error'; ready: boolean; error?: string };
  providers: {
    status: 'ok' | 'warning' | 'error';
    defaultProvider: string | null;
    defaultModel: string | null;
    keys: { openrouter: boolean; deepseek: boolean; 'opencode-go': boolean };
    error?: string;
  };
  roots: RootCheck[];
  warnings: string[];
}
