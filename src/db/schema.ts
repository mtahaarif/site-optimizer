/**
 * Database schema.
 *
 * One SQLite file holds everything: crawl history, uptime monitoring, rank
 * tracking and backlinks. `node:sqlite` is built into Node 22+, so there is no
 * native module to compile, no service to install and nothing to configure —
 * which is what makes the whole tool runnable with zero infrastructure.
 *
 * Migrations are forward-only and idempotent. Each entry runs once, tracked by
 * user_version, so an existing database upgrades in place on next open.
 */

export const MIGRATIONS: string[] = [
  // ---- 1: sites, monitoring, alerts ---------------------------------------
  `
  CREATE TABLE sites (
    id          INTEGER PRIMARY KEY,
    origin      TEXT    NOT NULL UNIQUE,
    label       TEXT,
    created_at  INTEGER NOT NULL
  );

  -- Every monitoring poll, kept forever. This is the uptime history.
  CREATE TABLE monitor_checks (
    id                 INTEGER PRIMARY KEY,
    site_id            INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    checked_at         INTEGER NOT NULL,
    url                TEXT    NOT NULL,
    status             INTEGER NOT NULL,   -- 0 means the request never completed
    ok                 INTEGER NOT NULL,   -- 1 when status is exactly 200
    response_ms        INTEGER NOT NULL,
    error              TEXT,
    redirect_to        TEXT,
    body_hash          TEXT,               -- detects silent content changes
    ssl_days_remaining INTEGER
  );
  CREATE INDEX idx_monitor_site_time ON monitor_checks(site_id, checked_at DESC);

  -- Derived state transitions. Alerts fire per incident, never per poll, so a
  -- three-hour outage sends one email rather than one every five minutes.
  CREATE TABLE incidents (
    id            INTEGER PRIMARY KEY,
    site_id       INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    started_at    INTEGER NOT NULL,
    resolved_at   INTEGER,
    first_status  INTEGER,
    last_status   INTEGER,
    failure_count INTEGER NOT NULL DEFAULT 1,
    error         TEXT
  );
  CREATE INDEX idx_incident_site ON incidents(site_id, started_at DESC);
  CREATE INDEX idx_incident_open ON incidents(site_id) WHERE resolved_at IS NULL;

  CREATE TABLE alerts (
    id          INTEGER PRIMARY KEY,
    site_id     INTEGER REFERENCES sites(id) ON DELETE CASCADE,
    incident_id INTEGER REFERENCES incidents(id) ON DELETE CASCADE,
    kind        TEXT    NOT NULL,   -- down | recovered | ssl_expiring | rank_drop | backlink_lost
    channel     TEXT    NOT NULL,   -- sendgrid | resend | webhook | console
    sent_at     INTEGER NOT NULL,
    ok          INTEGER NOT NULL,
    subject     TEXT,
    detail      TEXT
  );
  CREATE INDEX idx_alert_time ON alerts(sent_at DESC);
  `,

  // ---- 2: rank tracking ---------------------------------------------------
  `
  -- One row per tracked combination. The UNIQUE constraint is what makes
  -- device and geo segmentation first-class rather than a filter applied later:
  -- "seo tool" on google/mobile/Austin is a different keyword row from
  -- "seo tool" on google/desktop/Austin, with its own independent history.
  CREATE TABLE keywords (
    id         INTEGER PRIMARY KEY,
    site_id    INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    phrase     TEXT    NOT NULL,
    engine     TEXT    NOT NULL,          -- google | bing | yahoo | yandex
    device     TEXT    NOT NULL,          -- desktop | mobile
    country    TEXT,                      -- ISO-3166 alpha-2, e.g. US
    city       TEXT,                      -- city-level geo targeting
    language   TEXT,                      -- ISO-639-1, e.g. en
    active     INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    UNIQUE(site_id, phrase, engine, device, country, city)
  );
  CREATE INDEX idx_keyword_site ON keywords(site_id, active);

  CREATE TABLE rank_snapshots (
    id              INTEGER PRIMARY KEY,
    keyword_id      INTEGER NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
    checked_at      INTEGER NOT NULL,
    position        INTEGER,              -- NULL means not found in the results scanned
    url             TEXT,
    title           TEXT,
    serp_features   TEXT,                 -- JSON array
    results_checked INTEGER,
    provider        TEXT    NOT NULL,
    error           TEXT
  );
  CREATE INDEX idx_rank_kw_time ON rank_snapshots(keyword_id, checked_at DESC);

  -- Free SERP tiers are 50-100 searches per month. Spending them by accident is
  -- the single most likely way to break this module, so every call is metered
  -- against a ledger before it is made.
  CREATE TABLE api_usage (
    id         INTEGER PRIMARY KEY,
    provider   TEXT    NOT NULL,
    period     TEXT    NOT NULL,          -- YYYY-MM
    used       INTEGER NOT NULL DEFAULT 0,
    limit_hint INTEGER,
    UNIQUE(provider, period)
  );
  `,

  // ---- 3: backlinks -------------------------------------------------------
  `
  CREATE TABLE backlinks (
    id              INTEGER PRIMARY KEY,
    site_id         INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    source_url      TEXT    NOT NULL,     -- the referring page
    target_url      TEXT,                 -- the page on our site it points at
    first_seen      INTEGER NOT NULL,
    last_checked    INTEGER,
    last_seen_alive INTEGER,
    status          TEXT    NOT NULL,     -- active | lost | broken | unverified
    rel             TEXT,                 -- dofollow | nofollow | ugc | sponsored
    anchor          TEXT,
    discovered_via  TEXT,                 -- gsc | manual | import
    UNIQUE(site_id, source_url, target_url)
  );
  CREATE INDEX idx_backlink_site ON backlinks(site_id, status);

  CREATE TABLE backlink_checks (
    id          INTEGER PRIMARY KEY,
    backlink_id INTEGER NOT NULL REFERENCES backlinks(id) ON DELETE CASCADE,
    checked_at  INTEGER NOT NULL,
    http_status INTEGER,
    found       INTEGER NOT NULL,         -- 1 when our domain appears in the parsed HTML
    rel         TEXT,
    anchor      TEXT,
    error       TEXT
  );
  CREATE INDEX idx_blcheck_time ON backlink_checks(backlink_id, checked_at DESC);
  `,

  // ---- 4: crawl history ---------------------------------------------------
  `
  -- Crawl reports move into SQLite so score history is queryable alongside
  -- uptime and rankings. The full AuditReport stays as a JSON blob because it
  -- is read whole and never queried field-by-field.
  CREATE TABLE crawls (
    id             TEXT    PRIMARY KEY,
    site_id        INTEGER REFERENCES sites(id) ON DELETE CASCADE,
    created_at     INTEGER NOT NULL,
    duration_ms    INTEGER,
    score          REAL    NOT NULL,
    rubric_version TEXT,
    pages          INTEGER,
    checks_failed  INTEGER,
    checks_passed  INTEGER,
    blockers       INTEGER,
    criticals      INTEGER,
    warnings       INTEGER,
    is_next        INTEGER,
    report_json    TEXT    NOT NULL
  );
  CREATE INDEX idx_crawl_site_time ON crawls(site_id, created_at DESC);
  `,

  // ---- 5: HTML snapshots for "view issue in code" -------------------------
  `
  -- Raw server HTML per crawled page, gzipped.
  --
  -- Stored separately from crawls.report_json on purpose: the report is read
  -- whole on every dashboard view, and attaching megabytes of markup to it
  -- would make the page payload unusable. Snapshots are fetched one URL at a
  -- time, only when the user actually opens a code view.
  CREATE TABLE page_snapshots (
    id         INTEGER PRIMARY KEY,
    crawl_id   TEXT    NOT NULL REFERENCES crawls(id) ON DELETE CASCADE,
    url        TEXT    NOT NULL,
    -- normalized URL, so a lookup does not depend on trailing-slash form
    url_key    TEXT    NOT NULL,
    gzipped    BLOB    NOT NULL,
    raw_bytes  INTEGER NOT NULL,
    gzip_bytes INTEGER NOT NULL,
    rendered   INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    UNIQUE(crawl_id, url_key)
  );
  CREATE INDEX idx_snapshot_lookup ON page_snapshots(crawl_id, url_key);
  `,

  // ---- 6: Google Search Console cache -------------------------------------
  `
  -- One row per (property, date range) fetch. Search Console data is finalised
  -- with a ~2-3 day lag and then never changes, so a completed range can be
  -- cached indefinitely; only ranges touching the last few days go stale.
  CREATE TABLE gsc_fetches (
    id         INTEGER PRIMARY KEY,
    property   TEXT    NOT NULL,
    start_date TEXT    NOT NULL,   -- YYYY-MM-DD
    end_date   TEXT    NOT NULL,
    fetched_at INTEGER NOT NULL,
    row_count  INTEGER NOT NULL,
    clicks     INTEGER NOT NULL DEFAULT 0,
    impressions INTEGER NOT NULL DEFAULT 0,
    UNIQUE(property, start_date, end_date)
  );

  -- Per-URL metrics from the Search Analytics API.
  CREATE TABLE gsc_page_metrics (
    id          INTEGER PRIMARY KEY,
    fetch_id    INTEGER NOT NULL REFERENCES gsc_fetches(id) ON DELETE CASCADE,
    url         TEXT    NOT NULL,
    -- normalized, so a lookup does not depend on trailing-slash form
    url_key     TEXT    NOT NULL,
    clicks      INTEGER NOT NULL DEFAULT 0,
    impressions INTEGER NOT NULL DEFAULT 0,
    ctr         REAL    NOT NULL DEFAULT 0,
    position    REAL    NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_gsc_lookup ON gsc_page_metrics(fetch_id, url_key);
  `,
  // ---- 7: Google Analytics 4 cache ----------------------------------------
  `
  -- Per-path engagement metrics from the GA4 Data API.
  --
  -- Keyed by (property, path, date range) rather than the spec's
  -- (site_id, url_path): without the range in the key, changing the reporting
  -- window would collide with the previous window's rows and silently mix two
  -- periods together.
  CREATE TABLE ga4_metrics (
    site_id          TEXT    NOT NULL,   -- GA4 property id
    url_path         TEXT    NOT NULL,
    start_date       TEXT    NOT NULL,
    end_date         TEXT    NOT NULL,
    pageviews        INTEGER NOT NULL DEFAULT 0,
    sessions         INTEGER NOT NULL DEFAULT 0,
    users            INTEGER NOT NULL DEFAULT 0,
    conversions      INTEGER NOT NULL DEFAULT 0,
    bounce_rate      REAL    NOT NULL DEFAULT 0.0,
    avg_duration_sec REAL    NOT NULL DEFAULT 0.0,
    fetched_at       INTEGER NOT NULL,
    PRIMARY KEY (site_id, url_path, start_date, end_date)
  );
  CREATE INDEX idx_ga4_range ON ga4_metrics(site_id, start_date, end_date);
  `,

  // ---- 8: content quality grades ------------------------------------------
  `
  -- One row per (crawl, page) graded by the content judge.
  --
  -- Grading costs a model call, so results are stored rather than recomputed:
  -- a page's grade is a property of the content at that crawl, and re-reading
  -- it must never re-spend. IF NOT EXISTS because the table may already have
  -- been created on demand by a running process before this migration ran.
  CREATE TABLE IF NOT EXISTS content_grades (
    id           INTEGER PRIMARY KEY,
    crawl_id     TEXT    NOT NULL,
    url          TEXT    NOT NULL,
    url_key      TEXT    NOT NULL,   -- normalized, so lookups ignore trailing-slash form
    graded_at    INTEGER NOT NULL,
    model        TEXT    NOT NULL,
    overall      INTEGER NOT NULL,
    depth        INTEGER NOT NULL,
    relevance    INTEGER NOT NULL,
    readability  INTEGER NOT NULL,
    originality  INTEGER NOT NULL,
    trust        INTEGER NOT NULL,
    structure    INTEGER NOT NULL,
    verdict      TEXT    NOT NULL,   -- one-line plain-English summary
    strengths    TEXT    NOT NULL,   -- JSON array of strings
    fixes        TEXT    NOT NULL,   -- JSON array of {fix, why}
    intent       TEXT,               -- what the judge thinks the page is trying to answer
    words        INTEGER NOT NULL DEFAULT 0,
    UNIQUE(crawl_id, url_key)
  );
  CREATE INDEX IF NOT EXISTS idx_grade_crawl ON content_grades(crawl_id);
  `,
];
