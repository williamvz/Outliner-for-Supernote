import type {TanaSession} from './session';

export interface Env {
  SESSION: DurableObjectNamespace<TanaSession>;
  DEVICE_TOKEN_HASH: string;
  TANA_MCP_URL: string;
  TANA_ISSUER: string;
  TIMEZONE: string;
  TASK_TAG: string;
  RECURRING_TAG: string;
  TANA_WORKSPACE_ID?: string;
  /** Local testing against a mock MCP server only; never set in production. */
  DEV_TANA_ACCESS_TOKEN?: string;
}
