-- Attacca Relay Server Schema

-- License verification cache (1-hour TTL)
CREATE TABLE IF NOT EXISTS license_cache (
  license_key_hash TEXT PRIMARY KEY,
  plan TEXT NOT NULL,
  email TEXT,
  valid BOOLEAN NOT NULL DEFAULT true,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '1 hour')
);

CREATE INDEX IF NOT EXISTS idx_license_cache_expires ON license_cache (expires_at);

-- Usage tracking per license per month
CREATE TABLE IF NOT EXISTS usage_tracking (
  id SERIAL PRIMARY KEY,
  license_key_hash TEXT NOT NULL,
  month_year TEXT NOT NULL, -- e.g. '2026-02'
  total_cost_usd NUMERIC(10, 6) NOT NULL DEFAULT 0,
  request_count INTEGER NOT NULL DEFAULT 0,
  last_request_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (license_key_hash, month_year)
);

CREATE INDEX IF NOT EXISTS idx_usage_tracking_lookup ON usage_tracking (license_key_hash, month_year);

-- Telemetry events (Phase 2)
CREATE TABLE IF NOT EXISTS telemetry_events (
  id BIGSERIAL PRIMARY KEY,
  anonymous_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  client_timestamp TIMESTAMPTZ NOT NULL,
  server_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_telemetry_anonymous ON telemetry_events (anonymous_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_type ON telemetry_events (event_type);
CREATE INDEX IF NOT EXISTS idx_telemetry_time ON telemetry_events (server_timestamp);
