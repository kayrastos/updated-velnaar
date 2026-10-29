/**
 * @file stateHash.ts
 * @description RFC 8785 (JCS) Deterministic Canonical JSON Serialization and SHA-256 State Hash (`sha256:<hex>`)
 */
import type {
  EnvironmentConfig,
  EnvironmentTier,
  TenantSecurityContext,
} from '../types/security';
import type {
  ActionResultRow,
  BusinessRow,
  MarketType,
} from '../types/database';

export const STATE_HASH_SCHEMA_VERSION = 'VELNAR_STATE_HASH_JCS_V1' as const;

export const TRANSIENT_STATE_KEYS: ReadonlySet<string> = new Set([
  'scan_timestamp',
  'timestamp',
  'exportedAt',
  'exported_at',
  'generatedAt',
  'generated_at',
  'run_id',
  'runId',
  'sessionId',
  'session_id',
  'verified_at',
  'verifiedAt',
  'created_at',
  'createdAt',
  'updated_at',
  'updatedAt',
  'executed_at',
  'executedAt',
  'observedAtMs',
  'completedAtMs',
]);

export interface DeterministicStateInput {
  readonly schemaVersion?: string;
  readonly isolation: {
    readonly organizationId: string;
    readonly businessId?: string | null;
    readonly market?: MarketType | string;
    readonly role?: TenantSecurityContext['role'] | string;
  };
  readonly ruleTemplateVersion: string;
  readonly configuration?: Partial<EnvironmentConfig> & {
    readonly environmentTier?: EnvironmentTier;
    readonly [key: string]: unknown;
  };
  readonly verifiedActions?: ReadonlyArray<{
    readonly id: string;
    readonly growthActionId: string;
    readonly status: string;
    readonly revenueRecoveredMinor: number;
    readonly metricDelta: unknown;
  }>;
  readonly [key: string]: unknown;
}

export interface VelnarProofCertificatePayload {
  readonly schemaVersion: typeof STATE_HASH_SCHEMA_VERSION;
  readonly state_hash: string;
  readonly canonicalState: DeterministicStateInput;
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/**
 * Pure synchronous FIPS 180-4 SHA-256 implementation over UTF-8 bytes.
 */
export function sha256HexSync(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLen = bytes.length * 8;
  const totalWords = (((bytes.length + 9 + 63) >> 6) << 4);
  const words = new Uint32Array(totalWords);

  for (let i = 0; i < bytes.length; i++) {
    words[i >> 2] |= bytes[i] << (24 - (i & 3) * 8);
  }
  words[bytes.length >> 2] |= 0x80 << (24 - (bytes.length & 3) * 8);
  words[totalWords - 2] = Math.floor(bitLen / 0x100000000);
  words[totalWords - 1] = bitLen >>> 0;

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);

  for (let offset = 0; offset < totalWords; offset += 16) {
    for (let i = 0; i < 16; i++) {
      w[i] = words[offset + i];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((v) => v.toString(16).padStart(8, '0'))
    .join('');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Recursively strips transient keys (`scan_timestamp`, `timestamp`, `run_id`, etc.)
 * and normalizes object keys in lexicographical UTF-16 code unit order.
 */
export function stripTransientStateFields(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('JCS_NON_FINITE_NUMBER');
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => stripTransientStateFields(item));
  }
  if (isPlainObject(value)) {
    const sortedKeys = Object.keys(value).sort();
    const out: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      if (TRANSIENT_STATE_KEYS.has(key)) {
        continue;
      }
      const child = value[key];
      if (child === undefined) {
        continue;
      }
      out[key] = stripTransientStateFields(child);
    }
    return out;
  }
  throw new Error('JCS_UNSUPPORTED_TYPE');
}

/**
 * RFC 8785 (JCS) deterministic canonical JSON serializer (excluding transient state fields).
 */
export function serializeCanonicalJcs(value: unknown): string {
  const sanitized = stripTransientStateFields(value);
  return JSON.stringify(sanitized);
}

/**
 * Computes the deterministic `state_hash` (`sha256:<64-hex>`) over RFC 8785 canonical JSON.
 */
export function computeStateHash(stateInput: unknown): string {
  const canonicalJson = serializeCanonicalJcs(stateInput);
  return `sha256:${sha256HexSync(canonicalJson)}`;
}

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * Builds the canonical deterministic proof state for `VelnarProofView` and its exported certificate.
 */
export function buildVelnarProofCanonicalState(params: {
  readonly currentMarket: MarketType | string;
  readonly currentBusiness?: Pick<BusinessRow, 'id' | 'organization_id' | 'name' | 'industry' | 'currency'> | null;
  readonly actionResults: ReadonlyArray<ActionResultRow>;
  readonly ruleTemplateVersion?: string;
  readonly environmentTier?: EnvironmentTier;
}): DeterministicStateInput {
  const sortedActions = [...params.actionResults]
    .map((row) => ({
      id: row.id,
      growthActionId: row.growth_action_id,
      status: row.status,
      revenueRecoveredMinor: row.revenue_recovered_amount_minor || 0,
      metricDelta: safeParseJson(row.metric_delta_json),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  return {
    schemaVersion: STATE_HASH_SCHEMA_VERSION,
    isolation: {
      organizationId: params.currentBusiness?.organization_id ?? 'unscoped_org',
      businessId: params.currentBusiness?.id ?? null,
      market: params.currentMarket,
    },
    ruleTemplateVersion: params.ruleTemplateVersion ?? 'VELNAR_V1_CORE_ATTRIBUTION_RULESET',
    configuration: {
      environmentTier: params.environmentTier ?? 'production',
      currency: params.currentBusiness?.currency ?? 'USD',
      industry: params.currentBusiness?.industry ?? 'general',
    },
    verifiedActions: sortedActions,
  };
}

export function createVelnarProofCertificate(params: {
  readonly currentMarket: MarketType | string;
  readonly currentBusiness?: Pick<BusinessRow, 'id' | 'organization_id' | 'name' | 'industry' | 'currency'> | null;
  readonly actionResults: ReadonlyArray<ActionResultRow>;
  readonly ruleTemplateVersion?: string;
  readonly environmentTier?: EnvironmentTier;
}): VelnarProofCertificatePayload {
  const canonicalState = buildVelnarProofCanonicalState(params);
  return {
    schemaVersion: STATE_HASH_SCHEMA_VERSION,
    state_hash: computeStateHash(canonicalState),
    canonicalState,
  };
}
