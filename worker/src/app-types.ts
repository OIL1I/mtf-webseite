import type { Hono } from 'hono';
import type { Env, Vars } from './types';

export type MtfApp = Hono<{ Bindings: Env; Variables: Vars }>;
