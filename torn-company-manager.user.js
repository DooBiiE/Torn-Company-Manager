// ==UserScript==
// @name         Torn Company Management Suite
// @namespace    torn-company-management-suite
// @version      1.5.1
// @description  Local-only company management dashboard for Torn directors, embedded in the Jobs page. No company data ever leaves your browser; only your Torn User ID is checked against a public license list.
// @author       DooBiiE
// @homepageURL  https://github.com/DooBiiE/Torn-Company-Manager
// @source       https://github.com/DooBiiE/Torn-Company-Manager
// @supportURL   https://github.com/DooBiiE/Torn-Company-Manager/issues
// @match        https://www.torn.com/companies.php*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @connect      api.torn.com
// @connect      raw.githubusercontent.com
// @run-at       document-idle
// ==/UserScript==

/**
 * ============================================================================
 * TORN COMPANY MANAGEMENT SUITE
 * ============================================================================
 *
 * WHAT THIS DOES:
 *   1. Stores your API key ONLY in this browser (Tampermonkey local storage,
 *      via GM_setValue). It is never sent anywhere except https://api.torn.com.
 *   2. Runs a live "capability diagnostic" against every selection this system
 *      uses, and records -- with the REAL error code/message Torn returns --
 *      exactly what your current key can and can't access. The Diagnostics
 *      tab always shows this; nothing about it gates whether the tab exists.
 *   3. Checks your own Torn User ID (read from user/basic, EXACT) against a
 *      public license list hosted on GitHub -- see LICENSE_JSON_URL below.
 *      Only the numeric User ID is sent in that request; no API key, no
 *      company data. Everything else in the suite stays fully local.
 *   4. For whatever the API key can access, renders a read-only dashboard and
 *      takes a local snapshot (IndexedDB) so history builds up from today.
 *   5. Everything is tagged with its accuracy classification:
 *        EXACT = straight from a Torn API field this session
 *        DERIVED = computed purely from EXACT values
 *        HISTORICAL = from a locally stored earlier snapshot
 *        BLOCKED = this key/role cannot access this data (shown, not hidden)
 *
 * OPTIMIZE / STOCK MANAGEMENT:
 *   Optimize uses the working stats now returned by company/employees plus
 *   position requirements from torn/companies. It reports requirement-fit
 *   coverage; it does not pretend that this is Torn's hidden EE formula.
 *   Stock Management combines company/stock with company/news when available
 *   to show recent unit sales and a clearly-labelled derived restock target.
 *
 * REQUIRED API KEY LEVEL:
 *   Full Access (or a Custom key covering company: profile/employees/
 *   detailed/stock/news/applications and user: basic/workstats/log) is needed for
 *   full functionality. A Public/Minimal key will show BLOCKED on most tabs
 *   -- the Diagnostics tab always shows exactly which selections work.
 *
 * INSTALL: Tampermonkey/Violentmonkey -> Create new script -> paste this file.
 * ============================================================================
 */

(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // 0. CONSTANTS
  // ---------------------------------------------------------------------
  const API_BASE = 'https://api.torn.com';
  // Read the UI version from userscript metadata when available. TornPDA may
  // not expose that metadata API, so a release fallback is provided below.
  // TornPDA does not always expose the legacy GM_info object that desktop
  // userscript managers provide. Try both common metadata APIs, then use the
  // release version as a PDA-safe fallback so the UI never shows vunknown.
  const TDS_VERSION_FALLBACK = '1.5.1';
  const TDS_VERSION =
    (typeof GM_info !== 'undefined' && GM_info?.script?.version) ||
    (typeof GM !== 'undefined' && GM?.info?.script?.version) ||
    TDS_VERSION_FALLBACK;
  const STORAGE_KEY_APIKEY = 'tds_api_key';
  const STORAGE_KEY_LAST_RUN_AT = 'tds_last_run_at';
  const STORAGE_KEY_THEME = 'tds_theme';
  const STORAGE_KEY_LICENSE_CACHE = 'tds_license_cache';
  const STORAGE_KEY_HISTORY_BACKFILL_DAY = 'tds_history_backfill_day';
  const STORAGE_KEY_HISTORY_BACKFILL_RESULT = 'tds_history_backfill_result';
  const STORAGE_KEY_STAFFING_BENCHMARK_CACHE = 'tds_staffing_benchmark_cache_v1';
  const STORAGE_KEY_DIRECTOR_NAME_CACHE = 'tds_director_name_cache_v1';
  const STORAGE_KEY_LAST_RESULTS = 'tds_last_results_cache';
  const STORAGE_KEY_LAST_VERDICT = 'tds_last_verdict_cache';
  const MIN_CALL_INTERVAL_MS = 800; // ~75 req/min ceiling, well under Torn's 100/min cap
  const DB_NAME = 'torn_director_system';
  const DB_VERSION = 2;

  // Public list of licensed Torn User IDs. Only the numeric User ID (read
  // from user/basic, EXACT) is compared against this -- no API key or
  // company data is ever sent here.
  //
  // Preferred licence formats:
  //   { "userId": 4237873, "licenseType": "term", "startsAt": "2026-08-19", "durationDays": 180 }
  //   { "userId": 1234567, "licenseType": "perpetual" }
  //
  // durationDays is literal calendar days. For administration, 30 days may
  // be treated as "1 month"; the script never performs calendar-month arithmetic.
  //
  // Backward-compatible legacy entries are still accepted:
  //   { "userId": 4237873, "status": "active" }
  //   { "userId": 1234567, "status": "expired" }
  const LICENSE_JSON_URL = 'https://raw.githubusercontent.com/DooBiiE/Torn-Company-Manager/refs/heads/main/licensed-users.json';
  const LICENSE_CACHE_TTL_MS = 60 * 60 * 1000; // 1h -- avoids hitting GitHub raw on every page load/navigation

  // CUSTOM API KEY
  // Torn supports an official custom-key creation URL. The fragment below
  // pre-selects exactly the permissions this suite uses, then Torn handles
  // the actual key creation on its own Settings page.
  //
  // Required selections for this suite:
  //   company: profile, employees, detailed, stock, news, applications, companies
  //   user:    basic, workstats, log
  //   torn:    companies
  //
  // IMPORTANT: this does not create or expose the secret key itself. It only
  // opens Torn's own key-generation flow with the required selections and
  // application name pre-filled. The user remains on Torn's site throughout
  // key creation and must then paste the generated key into this script.
  const CUSTOM_KEY_TITLE = 'Torn Company Management Suite';
  const CUSTOM_KEY_SELECTIONS = {
    company: ['profile', 'employees', 'detailed', 'stock', 'news', 'applications', 'companies', 'search', 'snapshot'],
    user: ['basic', 'workstats', 'log'],
    torn: ['companies'],
  };

  function buildCustomKeyUrl() {
    const parts = [
      'https://www.torn.com/preferences.php#tab=api?step=addNewKey',
      `company=${CUSTOM_KEY_SELECTIONS.company.join(',')}`,
      `user=${CUSTOM_KEY_SELECTIONS.user.join(',')}`,
      `torn=${CUSTOM_KEY_SELECTIONS.torn.join(',')}`,
      `title=${encodeURIComponent(CUSTOM_KEY_TITLE)}`,
    ];
    return parts.join('&');
  }

  const PROBE_PLAN = [
    { section: 'company', selections: 'profile', label: 'Company profile' },
    { section: 'company', selections: 'employees', label: 'Employee roster' },
    { section: 'company', selections: 'detailed', label: 'Company financials' },
    { section: 'company', selections: 'stock', label: 'Company stock' },
    { section: 'company', selections: 'news', label: 'Company news / sales history' },
    { section: 'company', selections: 'applications', label: 'Pending applications' },
    { section: 'user', selections: 'basic', label: 'Your own basic profile' },
    { section: 'user', selections: 'workstats', label: 'Your own working stats' },
    { section: 'user', selections: 'log', label: 'Your own personal event log' },
    { section: 'torn', selections: 'companies', label: 'Reference: company types & positions' },
  ];

  // Theme presets — ONLY the accent (brand/interactive) color changes here.
  // Semantic colors (green=good, red=bad, amber=warning) stay fixed on
  // purpose so the UI doesn't lose its meaning when you switch themes.
  const THEME_PRESETS = {
    green:  { accent: '#3ddc84', accentDim: 'rgba(61, 220, 132, 0.14)' },
    blue:   { accent: '#4da3ff', accentDim: 'rgba(77, 163, 255, 0.14)' },
    purple: { accent: '#b18cff', accentDim: 'rgba(177, 140, 255, 0.14)' },
    amber:  { accent: '#f5a623', accentDim: 'rgba(245, 166, 35, 0.14)' },
    cyan:   { accent: '#39d0d8', accentDim: 'rgba(57, 208, 216, 0.14)' },
    pink:   { accent: '#ff6bb5', accentDim: 'rgba(255, 107, 181, 0.14)' },
  };

  // ---------------------------------------------------------------------
  // 1. API CLIENT — queued, rate-limited, validated, never fabricates
  // ---------------------------------------------------------------------
  const ApiClient = (() => {
    let queue = Promise.resolve();
    let lastCallAt = 0;

    function rawCall(section, selections, id = '', extraParams = {}) {
      const key = GM_getValue(STORAGE_KEY_APIKEY, '');
      if (!key) return Promise.reject({ blocked: true, reason: 'No API key configured yet.' });

      const path = id ? `${section}/${id}` : section;
      const params = new URLSearchParams({ selections, key, ...extraParams });
      const url = `${API_BASE}/${path}?${params.toString()}`;

      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: 'GET',
          url,
          timeout: 15000,
          onload: (res) => {
            let json;
            try {
              json = JSON.parse(res.responseText);
            } catch (e) {
              reject({ blocked: true, reason: 'Response was not valid JSON — Torn API may be down.' });
              return;
            }
            if (json.error) {
              reject({ blocked: true, code: json.error.code, reason: json.error.error });
              return;
            }
            resolve(json);
          },
          onerror: () => reject({ blocked: true, reason: 'Network error contacting api.torn.com' }),
          ontimeout: () => reject({ blocked: true, reason: 'Request to api.torn.com timed out' }),
        });
      });
    }

    function call(section, selections, id = '', extraParams = {}) {
      const run = () => {
        const wait = Math.max(0, MIN_CALL_INTERVAL_MS - (Date.now() - lastCallAt));
        return new Promise((resolve) => setTimeout(resolve, wait)).then(() => {
          lastCallAt = Date.now();
          return rawCall(section, selections, id, extraParams);
        });
      };
      const result = queue.then(run, run);
      queue = result.then(() => {}, () => {});
      return result;
    }

    function rawCallV2(path, extraParams = {}) {
      const key = GM_getValue(STORAGE_KEY_APIKEY, '');
      if (!key) return Promise.reject({ blocked: true, reason: 'No API key configured yet.' });

      const params = new URLSearchParams({ ...extraParams });
      const cleanPath = String(path || '').replace(/^\/+/, '');
      const query = params.toString();
      const url = `${API_BASE}/v2/${cleanPath}${query ? `?${query}` : ''}`;
      const headers = {
        Authorization: `ApiKey ${key}`,
      };

      function handleResponse(res, resolve, reject) {
        let json;
        try {
          json = JSON.parse(String(res?.responseText || ''));
        } catch (e) {
          reject({
            blocked: true,
            reason: `Response was not valid JSON (HTTP ${res?.status ?? 'unknown'}).`
          });
          return;
        }

        if (json.error) {
          reject({
            blocked: true,
            code: json.error.code,
            reason: json.error.error || json.error.message
          });
          return;
        }

        resolve(json);
      }

      return new Promise((resolve, reject) => {
        // TornPDA exposes a native HTTP bridge which explicitly supports
        // custom request headers. Use it for API v2 so Authorization survives
        // the WebView/native boundary. Desktop userscript managers keep using
        // GM_xmlhttpRequest below.
        if (typeof PDA_httpGet === 'function') {
          PDA_httpGet(url, headers)
            .then((res) => handleResponse(res, resolve, reject))
            .catch((err) => reject({
              blocked: true,
              reason: `TornPDA HTTP error: ${err?.message || String(err)}`
            }));
          return;
        }

        GM_xmlhttpRequest({
          method: 'GET',
          url,
          headers,
          timeout: 15000,
          onload: (res) => handleResponse(res, resolve, reject),
          onerror: () => reject({ blocked: true, reason: 'Network error contacting api.torn.com' }),
          ontimeout: () => reject({ blocked: true, reason: 'Request to api.torn.com timed out' }),
        });
      });
    }

    function callV2(path, extraParams = {}) {
      const run = () => {
        const wait = Math.max(0, MIN_CALL_INTERVAL_MS - (Date.now() - lastCallAt));
        return new Promise((resolve) => setTimeout(resolve, wait)).then(() => {
          lastCallAt = Date.now();
          return rawCallV2(path, extraParams);
        });
      };
      const result = queue.then(run, run);
      queue = result.then(() => {}, () => {});
      return result;
    }

    function rawCallV2Text(path, extraParams = {}) {
      const key = GM_getValue(STORAGE_KEY_APIKEY, '');
      if (!key) return Promise.reject({ blocked: true, reason: 'No API key configured yet.' });

      const params = new URLSearchParams({ ...extraParams });
      const cleanPath = String(path || '').replace(/^\/+/, '');
      const query = params.toString();
      const url = `${API_BASE}/v2/${cleanPath}${query ? `?${query}` : ''}`;
      const headers = {
        Authorization: `ApiKey ${key}`,
        Accept: 'text/csv, text/plain, */*',
      };

      function handleTextResponse(res, resolve, reject) {
        const body = String(res?.responseText || '');
        const trimmed = body.trim();

        if (trimmed.startsWith('{')) {
          try {
            const json = JSON.parse(trimmed);
            if (json.error) {
              reject({
                blocked: true,
                code: json.error.code,
                reason: json.error.error || json.error.message || 'Torn API error',
              });
              return;
            }
          } catch (_) {}
        }

        resolve(body);
      }

      return new Promise((resolve, reject) => {
        if (typeof PDA_httpGet === 'function') {
          PDA_httpGet(url, headers)
            .then((res) => handleTextResponse(res, resolve, reject))
            .catch((err) => reject({
              blocked: true,
              reason: `TornPDA HTTP error: ${err?.message || String(err)}`
            }));
          return;
        }

        GM_xmlhttpRequest({
          method: 'GET',
          url,
          headers,
          timeout: 20000,
          onload: (res) => handleTextResponse(res, resolve, reject),
          onerror: () => reject({ blocked: true, reason: 'Network error contacting api.torn.com' }),
          ontimeout: () => reject({ blocked: true, reason: 'Request to api.torn.com timed out' }),
        });
      });
    }

    function callV2Text(path, extraParams = {}) {
      const run = () => {
        const wait = Math.max(0, MIN_CALL_INTERVAL_MS - (Date.now() - lastCallAt));
        return new Promise((resolve) => setTimeout(resolve, wait)).then(() => {
          lastCallAt = Date.now();
          return rawCallV2Text(path, extraParams);
        });
      };
      const result = queue.then(run, run);
      queue = result.then(() => {}, () => {});
      return result;
    }

    return { call, callV2, callV2Text };
  })();

  // ---------------------------------------------------------------------
  // 2. LOCAL STORAGE (IndexedDB) — snapshots only, nothing leaves the browser
  // ---------------------------------------------------------------------
  const LocalDB = (() => {
    let dbPromise = null;

    function open() {
      if (dbPromise) return dbPromise;
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('snapshots')) {
            const store = db.createObjectStore('snapshots', { keyPath: 'id', autoIncrement: true });
            store.createIndex('timestamp', 'timestamp');
          }
          if (!db.objectStoreNames.contains('diagnostics')) {
            db.createObjectStore('diagnostics', { keyPath: 'timestamp' });
          }
          if (!db.objectStoreNames.contains('performance')) {
            const store = db.createObjectStore('performance', { keyPath: 'day' });
            store.createIndex('timestamp', 'timestamp');
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      return dbPromise;
    }

    async function put(storeName, value) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(value);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }

    async function getAll(storeName) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    }

    async function deleteKey(storeName, key) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }

    async function getLatest(storeName, sortField = 'timestamp') {
      const all = await getAll(storeName);
      if (!all.length) return null;
      return all.reduce((latest, row) =>
        !latest || (Number(row?.[sortField]) || 0) > (Number(latest?.[sortField]) || 0)
          ? row
          : latest, null);
    }

    async function clear(storeName) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }

    return { put, getAll, deleteKey, getLatest, clear };
  })();

  const MAX_SNAPSHOTS = 120; // full/raw snapshots: intentionally limited
  const MAX_PERFORMANCE_DAYS = 730; // compact daily records: rolling 2-year history

  async function pruneSnapshots() {
    const all = await LocalDB.getAll('snapshots');
    if (all.length <= MAX_SNAPSHOTS) return;
    all.sort((a, b) => a.timestamp - b.timestamp);
    const toRemove = all.slice(0, all.length - MAX_SNAPSHOTS);
    for (const row of toRemove) await LocalDB.deleteKey('snapshots', row.id);
  }

  async function prunePerformanceHistory() {
    const all = await LocalDB.getAll('performance');
    if (all.length <= MAX_PERFORMANCE_DAYS) return;

    all.sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
    const toRemove = all.slice(0, all.length - MAX_PERFORMANCE_DAYS);

    for (const row of toRemove) {
      await LocalDB.deleteKey('performance', row.day);
    }
  }

  // ---------------------------------------------------------------------
  // 3. DIAGNOSTIC RUNNER
  // ---------------------------------------------------------------------
  async function runDiagnostic(onEach) {
    const results = [];
    for (const probe of PROBE_PLAN) {
      try {
        const data = await ApiClient.call(probe.section, probe.selections);
        const r = { ...probe, status: 'ok', sampleKeys: extractTopLevelKeys(data), raw: data };
        results.push(r);
        onEach?.(r);
      } catch (err) {
        const r = { ...probe, status: 'blocked', code: err.code, reason: err.reason || 'Unknown error' };
        results.push(r);
        onEach?.(r);
      }
    }
    await LocalDB.put('diagnostics', { timestamp: Date.now(), results });
    return results;
  }

  function extractTopLevelKeys(obj) {
    if (!obj || typeof obj !== 'object') return [];
    return Object.keys(obj);
  }

  async function takeSnapshotFromDiagnostic(results) {
    const timestamp = Date.now();
    const snapshot = { timestamp, source: 'api' };

    for (const r of results) {
      if (r.status === 'ok') snapshot[`${r.section}_${r.selections}`] = r.raw;
    }

    const performance = performanceRecordFromResults(results, timestamp);
    if (performance) {
      snapshot.performance = performance;
      await saveCompactPerformanceRecord(performance);
    }

    if (Object.keys(snapshot).length > 2) {
      await LocalDB.put('snapshots', snapshot);
      await pruneSnapshots();
    }
    return snapshot;
  }

  // ---------------------------------------------------------------------
  // 3b. ACCESS VERDICT — DERIVED purely from the real statuses above
  // ---------------------------------------------------------------------
  function classifyAccess(results) {
    const byKey = (section, selections) =>
      results.find((r) => r.section === section && r.selections === selections);

    const financials = byKey('company', 'detailed');
    const stock = byKey('company', 'stock');
    const applications = byKey('company', 'applications');
    const roster = byKey('company', 'employees');

    const directorSignals = [financials, stock, applications].filter(Boolean);
    const directorOkCount = directorSignals.filter((r) => r.status === 'ok').length;
    const directorBlockedCount = directorSignals.filter((r) => r.status === 'blocked').length;

    if (directorOkCount === directorSignals.length && directorSignals.length > 0) {
      return {
        level: 'director',
        headline: 'Director Access',
        detail: 'Full company management features are available.',
      };
    }
    if (roster?.status === 'ok' && directorOkCount === 0 && directorBlockedCount > 0) {
      return {
        level: 'employee',
        headline: 'Employee Access',
        detail: 'Employee features are available. You need to be the company director to access the full management features.',
      };
    }
    if (directorOkCount > 0 && directorOkCount < directorSignals.length) {
      return {
        level: 'partial',
        headline: 'Partial Access',
        detail: 'Some features are unavailable. Check your API key permissions in Settings.',
      };
    }
    return {
      level: 'unknown',
      headline: 'Access Unknown',
      detail: 'Run Diagnostics to check which features are available.',
    };
  }

  // ---------------------------------------------------------------------
  // 4. STYLES — matches the reference "Company Manager" design language
  // ---------------------------------------------------------------------
  function injectStyles() {
    const css = `
      /* Embedded Management Suite -- lives inside Torn's own Jobs page, not
         an overlay. Structural colours (background/border/text) below are
         CSS variables with these dark-theme values as fallbacks; detectTornColours()
         overwrites them at runtime by sampling Torn's own page chrome, so the
         panel matches whichever skin (light or dark) the player is using.
         --tds-accent / --tds-accent-dim are the user-selectable theme colour
         (Settings tab) and are never touched by colour detection. Semantic
         colours (green/red/amber meaning good/bad/warning) are fixed on
         purpose and are not part of either system. */
      #tds-panel {
        width: 100%; box-sizing: border-box; margin: 14px 0 18px;
        background: var(--tds-bg, #2b2b2b); color: var(--tds-fg, #d8d8d8);
        border: 1px solid var(--tds-border, #1a1a1a);
        border-radius: 10px; overflow: hidden; font: 13px/1.45 -apple-system, 'Segoe UI', sans-serif;
        box-shadow: 0 4px 18px rgba(0,0,0,.22);
        position: relative; z-index: 20;
      }
      #tds-header {
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
        padding: 12px 14px; background: var(--tds-bg-alt, #383838); border-bottom: 1px solid var(--tds-border, #1a1a1a);
      }
      #tds-header .tds-brand { display: flex; align-items: baseline; gap: 7px; min-width: 0; flex-wrap: wrap; }
      #tds-header .tds-brand-dot { color: var(--tds-accent, #3ddc84); font-size: 13px; }
      #tds-header .tds-brand-name {
        color: var(--tds-accent, #3ddc84); font-weight: 800; font-size: 13px; letter-spacing: .04em;
      }
      #tds-header .tds-brand-version { color: var(--tds-text-faintest, #888888); font-size: 10.5px; }
      #tds-header .tds-access-badge { font-size: 9.5px; font-weight: 800; letter-spacing: .04em; padding: 2px 6px; border: 1px solid var(--tds-border-strong, #4a4a4a); border-radius: 10px; color: var(--tds-text-subtle, #969696); white-space: nowrap; }
      #tds-header .tds-access-badge.tds-access-director { color: var(--tds-accent, #3ddc84); }
      #tds-header .tds-access-badge.tds-access-employee, #tds-header .tds-access-badge.tds-access-partial { color: #e6b450; }
      #tds-header .tds-brand-subtitle { color: var(--tds-text-subtle, #969696); font-size: 10.5px; margin-left: 4px; }
      #tds-header-icons { display: flex; gap: 6px; flex-shrink: 0; }
      #tds-header-icons button {
        min-width: 30px; height: 28px; display: flex; align-items: center; justify-content: center;
        background: transparent; color: var(--tds-text-icon, #aaaaaa); border: 1px solid var(--tds-border-strong, #4a4a4a); border-radius: 6px;
        cursor: pointer; font-size: 12px; padding: 0 8px;
      }
      #tds-header-icons button:hover { background: var(--tds-bg-hover, #404040); color: var(--tds-fg, #d8d8d8); }

      #tds-tabs {
        display: flex; flex-wrap: wrap; gap: 2px; padding: 9px 12px 0;
        border-bottom: 1px solid var(--tds-border, #1a1a1a); background: var(--tds-bg, #2b2b2b);
      }
      .tds-tab {
        background: transparent; border: none; color: var(--tds-text-dim, #999999); font: 700 10.5px/1 -apple-system, sans-serif;
        letter-spacing: .05em; padding: 0 5px 10px; margin-right: 12px; cursor: pointer;
        border-bottom: 2px solid transparent;
      }
      .tds-tab:hover { color: var(--tds-text-mid, #b5b5b5); }
      .tds-tab.tds-tab-active { color: var(--tds-accent, #3ddc84); border-bottom-color: var(--tds-accent, #3ddc84); }
      .tds-tab.tds-tab-locked { color: var(--tds-text-disabled, #666666); cursor: default; }
      .tds-tab.tds-tab-locked:hover { color: var(--tds-text-disabled, #666666); }

      #tds-body { padding: 14px; box-sizing: border-box; }
      .tds-tabpanel[hidden] { display: none; }
      .tds-section-label {
        font: 700 10.5px/1 -apple-system, sans-serif; letter-spacing: .08em; color: var(--tds-text-faint, #9a9a9a);
        text-transform: uppercase; margin: 16px 0 8px;
      }
      .tds-section-label:first-child { margin-top: 0; }
      .tds-employee-subheading { font-weight: 800 !important; text-decoration: underline; text-underline-offset: 2px; }
      .tds-card { background: var(--tds-bg-card, #323232); border: 1px solid var(--tds-border, #1a1a1a); border-radius: 8px; padding: 12px 14px; margin-bottom: 10px; }
      .tds-card-title { color: var(--tds-text-icon, #aaaaaa); font-size: 11.5px; margin-bottom: 6px; }
      .tds-row { display: flex; justify-content: space-between; align-items: center; padding: 3px 0; gap: 10px; }
      .tds-row-label { color: var(--tds-text-mid, #b5b5b5); }
      .tds-row-value { font-weight: 700; color: var(--tds-text-strong, #f0f0f0); }
      .tds-v-good { color: #3ddc84 !important; }
      .tds-v-bad { color: #ff5c5c !important; }
      .tds-v-warn { color: #f5a623 !important; }
      .tds-v-dim { color: var(--tds-text-dim, #999999) !important; font-weight: 400 !important; }
      .tds-box { border-radius: 7px; padding: 10px 12px; margin-bottom: 10px; font-size: 12px; line-height: 1.5; }
      .tds-box-info { background: rgba(61,220,132,.07); border: 1px solid rgba(61,220,132,.28); color: #a9e8c1; }
      .tds-box-warn { background: rgba(245,166,35,.09); border: 1px solid rgba(245,166,35,.3); color: #f0c584; }
      .tds-box-danger { background: rgba(255,92,92,.08); border: 1px solid rgba(255,92,92,.3); color: #ffb3b3; }
      .tds-box-neutral { background: var(--tds-bg-card, #323232); border: 1px solid var(--tds-border, #1a1a1a); color: var(--tds-text-mid, #b5b5b5); }
      .tds-box strong { color: inherit; }
      .tds-badge { display: inline-flex; align-items: center; font: 700 10px/1 -apple-system, sans-serif; padding: 3px 7px; border-radius: 5px; white-space: nowrap; letter-spacing: .02em; }
      .tds-badge-ok { background: rgba(61,220,132,.14); color: #3ddc84; border: 1px solid rgba(61,220,132,.3); }
      .tds-badge-warn { background: rgba(245,166,35,.14); color: #f5a623; border: 1px solid rgba(245,166,35,.32); }
      .tds-badge-blocked { background: rgba(255,92,92,.12); color: #ff8b8b; border: 1px solid rgba(255,92,92,.28); }
      .tds-badge-neutral { background: var(--tds-bg-hover, #404040); color: var(--tds-text-icon, #aaaaaa); border: 1px solid var(--tds-border-strong, #4a4a4a); }
      .tds-employee-row { padding: 9px 0; border-bottom: 1px solid var(--tds-border-soft, #242424); }
      .tds-employee-row:last-child { border-bottom: none; }
      .tds-employee-row > summary { cursor: pointer; list-style: none; }
      .tds-employee-row > summary::-webkit-details-marker { display: none; }
      .tds-employee-row > summary::marker { content: ''; }
      .tds-employee-chevron {
        display: inline-block; font-size: 10px; color: var(--tds-text-dim, #999999);
        transition: transform .15s ease; transform: rotate(0deg);
      }
      .tds-employee-row[open] .tds-employee-chevron { transform: rotate(90deg); }
      .tds-employee-row[open] > summary { margin-bottom: 2px; }
      .tds-employee-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
      .tds-employee-name { font-weight: 700; color: var(--tds-text-strong, #f0f0f0); font-size: 13px; }
      .tds-employee-profile-link { cursor:pointer; text-decoration:underline; text-decoration-style:dotted; text-underline-offset:3px; }
      .tds-profile-actions { display:flex; flex-wrap:wrap; gap:6px; margin-top:12px; }
      .tds-employee-deeplink-highlight {
        outline: 2px solid var(--tds-accent, #3ddc84);
        outline-offset: 3px;
        border-radius: 6px;
        background: var(--tds-accent-dim, rgba(61,220,132,.14)) !important;
        transition: background .2s ease, outline-color .2s ease;
      }
      .tds-employee-meta { color: var(--tds-text-dim, #999999); font-size: 11px; margin-top: 1px; }
      .tds-diag-row { display: flex; justify-content: space-between; align-items: flex-start; padding: 8px 0; border-bottom: 1px solid var(--tds-border-soft, #242424); gap: 10px; }
      .tds-diag-row:last-child { border-bottom: none; }
      .tds-diag-label { color: var(--tds-text-mid2, #cfcfcf); font-size: 12px; }
      .tds-diag-reason { color: var(--tds-text-dim, #999999); font-size: 11px; margin-top: 2px; }
      .tds-btn { background: var(--tds-accent, #3ddc84); color: #06110a; border: none; border-radius: 6px; padding: 8px 12px; font: 700 12px/1 -apple-system, sans-serif; cursor: pointer; letter-spacing: .02em; }
      .tds-btn:hover { filter: brightness(1.08); }
      .tds-btn-ghost { background: transparent; color: var(--tds-text-mid, #b5b5b5); border: 1px solid var(--tds-border-strong, #4a4a4a); border-radius: 6px; padding: 8px 12px; font: 600 12px/1 -apple-system, sans-serif; cursor: pointer; }
      .tds-btn-ghost:hover { background: var(--tds-bg-hover, #404040); color: var(--tds-fg, #d8d8d8); }
      .tds-input { width: 100%; background: var(--tds-bg, #2b2b2b); color: var(--tds-text-strong, #f0f0f0); border: 1px solid var(--tds-border-strong, #4a4a4a); border-radius: 6px; padding: 8px 9px; box-sizing: border-box; font: 12.5px monospace; }
      .tds-input:focus { outline: none; border-color: var(--tds-accent, #3ddc84); }
      .tds-swatches { display: flex; gap: 8px; margin-top: 8px; }
      .tds-swatch { width: 26px; height: 26px; border-radius: 50%; cursor: pointer; border: 2px solid transparent; }
      .tds-swatch.tds-swatch-active { border-color: var(--tds-fg, #fff); }
      .tds-segmented { display: flex; gap: 4px; margin-bottom: 10px; flex-wrap: wrap; }
      .tds-segment { flex: 1; min-width: 90px; text-align: center; background: var(--tds-bg-card, #323232); color: var(--tds-text-icon, #aaaaaa); border: 1px solid var(--tds-border-strong, #4a4a4a); border-radius: 6px; padding: 8px 6px; font: 700 10.5px/1 -apple-system, sans-serif; letter-spacing: .03em; cursor: pointer; }
      .tds-segment:hover { background: var(--tds-bg-hover, #404040); }
      .tds-segment.tds-segment-active { background: var(--tds-accent-dim, rgba(61,220,132,.14)); color: var(--tds-accent, #3ddc84); border-color: var(--tds-accent, #3ddc84); }
      .tds-table { width: 100%; border-collapse: collapse; font-size: 12px; }
      .tds-table th { text-align: left; color: var(--tds-text-faint, #9a9a9a); font-size: 10px; letter-spacing: .05em; text-transform: uppercase; padding: 4px 6px; border-bottom: 1px solid var(--tds-border, #1a1a1a); }
      .tds-table td { padding: 5px 6px; border-bottom: 1px solid var(--tds-border-soft, #242424); color: var(--tds-fg, #d8d8d8); }
      .tds-table tr:last-child td { border-bottom: none; }
      .tds-table td.tds-num { text-align: right; font-variant-numeric: tabular-nums; }
      .tds-optimize-table th,
      .tds-optimize-table td { text-align: center !important; vertical-align: middle; }
      .tds-optimize-table td.tds-num { text-align: center !important; }
      .tds-optimize-table tbody tr td {
        border-bottom: 1px solid var(--tds-border-strong, #4a4a4a);
        padding-top: 8px;
        padding-bottom: 8px;
      }
      .tds-optimize-table tbody tr:last-child td { border-bottom: none; }
      .tds-position-matrix th,
      .tds-position-matrix td {
        text-align: center !important;
        vertical-align: middle;
        white-space: nowrap;
      }
      .tds-position-matrix th:first-child,
      .tds-position-matrix td:first-child {
        min-width: 150px;
        width: 150px;
        max-width: 220px;
        text-align: left !important;
        white-space: normal;
        overflow-wrap: anywhere;
      }
      .tds-position-matrix th:nth-child(2),
      .tds-position-matrix td:nth-child(2) {
        min-width: 130px;
        width: 130px;
        white-space: normal;
      }
      .tds-position-matrix th:not(:first-child):not(:nth-child(2)):not(:nth-child(3)),
      .tds-position-matrix td:not(:first-child):not(:nth-child(2)):not(:nth-child(3)) {
        min-width: 92px;
      }
      .tds-position-matrix tbody tr td {
        border-bottom: 1px solid rgba(255,255,255,0.16);
        padding-top: 8px;
        padding-bottom: 8px;
      }
      .tds-position-best {
        font-weight: 700;
        outline: 1px solid rgba(255,255,255,0.16);
      }
      .tds-balance-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
        gap: 10px;
        margin-top: 10px;
      }
      .tds-balance-card {
        border: 1px solid var(--tds-border, #444);
        border-radius: 6px;
        padding: 10px;
        background: rgba(255,255,255,0.025);
      }
      .tds-balance-title {
        font-weight: 700;
        margin-bottom: 6px;
      }
      .tds-balance-row {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        padding: 3px 0;
      }
      .tds-optimizer-summary {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 8px;
        margin: 10px 0;
      }
      .tds-optimizer-card {
        border: 1px solid var(--tds-border, #444);
        border-radius: 6px;
        padding: 10px;
        text-align: center;
        background: rgba(255,255,255,0.025);
      }
      .tds-optimizer-label {
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: .5px;
        opacity: .72;
        margin-bottom: 4px;
      }
      .tds-optimizer-value {
        font-size: 17px;
        font-weight: 700;
      }
      .tds-compare-table th,
      .tds-compare-table td {
        text-align: center !important;
        vertical-align: middle;
      }
      .tds-compare-table thead th {
        border-bottom: none !important;
      }
      .tds-compare-table tbody tr.company-data-row td {
        border-top: none !important;
        border-bottom: 2px solid rgba(255,255,255,0.22) !important;
        padding-top: 10px;
        padding-bottom: 10px;
      }
      .tds-compare-table td.tds-num { text-align: center !important; }
      .tds-training-debt-table th,
      .tds-training-debt-table td {
        text-align: center !important;
        vertical-align: middle;
      }
      .tds-training-debt-table tbody tr td {
        border-bottom: 1px solid var(--tds-border-strong, #4a4a4a);
        padding-top: 8px;
        padding-bottom: 8px;
      }
      .tds-training-debt-table tbody tr:last-child td { border-bottom: none; }
      .tds-training-plan {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
        gap: 8px;
        margin: 10px 0;
      }
      .tds-training-plan-card {
        border: 1px solid var(--tds-border, #444);
        border-radius: 6px;
        padding: 10px;
        background: var(--tds-panel-2, rgba(255,255,255,0.03));
      }
      .tds-training-plan-step {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        padding: 7px 0;
        border-bottom: 1px solid var(--tds-border-soft, rgba(255,255,255,.08));
      }
      .tds-training-plan-step:last-child { border-bottom: none; }
      .tds-training-plan-rank {
        display: inline-block;
        min-width: 28px;
        font-weight: 700;
      }
      .tds-attention-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 8px;
        margin: 8px 0 12px;
      }
      .tds-attention-item {
        border: 1px solid var(--tds-border, #444);
        border-radius: 6px;
        padding: 10px;
        background: rgba(255,255,255,0.025);
      }
      .tds-attention-item strong { display: block; margin-bottom: 3px; }
      .tds-timeline {
        border-left: 2px solid var(--tds-border-strong, #555);
        margin: 8px 0 8px 7px;
        padding-left: 14px;
      }
      .tds-timeline-item {
        position: relative;
        padding: 0 0 12px;
      }
      .tds-timeline-item::before {
        content: '';
        position: absolute;
        left: -20px;
        top: 4px;
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background: currentColor;
      }
      .tds-timeline-date {
        font-size: 10px;
        opacity: .65;
        margin-bottom: 2px;
      }
      .tds-timeline-text { font-size: 12px; }
      .tds-stock-table th,
      .tds-stock-table td {
        text-align: center !important;
        vertical-align: middle;
      }
      .tds-stock-table tbody tr td {
        border-bottom: 1px solid var(--tds-border-strong, #4a4a4a);
        padding-top: 8px;
        padding-bottom: 8px;
      }
      .tds-stock-table tbody tr:last-child td { border-bottom: none; }
      .tds-stock-summary {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 8px;
        margin: 10px 0;
      }
      .tds-stock-summary-card {
        border: 1px solid var(--tds-border, #444);
        border-radius: 6px;
        padding: 10px;
        background: var(--tds-panel-2, rgba(255,255,255,0.03));
        text-align: center;
      }
      .tds-stock-summary-label {
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: .6px;
        opacity: .72;
        margin-bottom: 4px;
      }
      .tds-stock-summary-value {
        font-size: 17px;
        font-weight: 700;
      }
      .tds-performance-history th,
      .tds-performance-history td {
        text-align: center !important;
        vertical-align: middle;
      }
      .tds-performance-history tbody tr td {
        border-bottom: 1px solid rgba(255,255,255,0.14);
        padding-top: 8px;
        padding-bottom: 8px;
      }
      .tds-history-high {
        font-weight: 700;
        box-shadow: inset 0 0 0 1px rgba(80,220,130,0.35);
      }
      .tds-history-low {
        font-weight: 700;
        box-shadow: inset 0 0 0 1px rgba(230,90,90,0.35);
      }
      .tds-income-chart {
        display: flex;
        align-items: flex-end;
        gap: 10px;
        min-height: 190px;
        padding: 16px 12px 10px;
        overflow-x: auto;
        border: 1px solid var(--tds-border, #444);
        border-radius: 6px;
        background: rgba(255,255,255,0.02);
      }
      .tds-income-chart-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: flex-end;
        min-width: 82px;
        height: 160px;
      }
      .tds-income-chart-value {
        font-size: 10px;
        font-weight: 700;
        margin-bottom: 4px;
        text-align: center;
        white-space: nowrap;
      }
      .tds-income-chart-bar-wrap {
        height: 110px;
        width: 34px;
        display: flex;
        align-items: flex-end;
        justify-content: center;
      }
      .tds-income-chart-bar {
        width: 28px;
        min-height: 6px;
        border-radius: 4px 4px 0 0;
        background: currentColor;
        opacity: .8;
      }
      .tds-income-chart-date {
        margin-top: 5px;
        font-size: 10px;
        opacity: .72;
        white-space: nowrap;
      }
      .tds-income-chart-source {
        font-size: 9px;
        opacity: .55;
        white-space: nowrap;
      }
      .tds-history-progress {
        margin-top: 8px;
        height: 8px;
        overflow: hidden;
        border-radius: 999px;
        background: rgba(255,255,255,0.08);
      }
      .tds-history-progress-bar {
        height: 100%;
        width: 0%;
        background: currentColor;
        transition: width .15s linear;
      }
      .tds-spark { display: flex; align-items: flex-end; gap: 4px; height: 46px; margin: 6px 0; }
      .tds-spark-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; }
      .tds-spark-bar { width: 100%; border-radius: 2px 2px 0 0; min-height: 2px; }
      .tds-spark-bar.tds-bar-pos { background: var(--tds-accent, #3ddc84); }
      .tds-spark-bar.tds-bar-neg { background: #ff5c5c; }
      .tds-spark-label { font-size: 9px; color: var(--tds-text-faintest, #888888); }
      #tds-footer { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-top: 1px solid var(--tds-border, #1a1a1a); background: var(--tds-bg-alt, #383838); font-size: 10.5px; color: var(--tds-text-faintest, #888888); }
      #tds-footer .tds-footer-status { color: var(--tds-accent, #3ddc84); }
      #tds-mount-error { margin: 14px 0; }

      @media (max-width: 700px) {
        #tds-header { align-items: flex-start; }
        #tds-header .tds-brand { flex-wrap: wrap; }
        #tds-header .tds-brand-subtitle { display: none; }
        #tds-tabs { overflow-x: auto; flex-wrap: nowrap; scrollbar-width: thin; }
        .tds-tab { flex: 0 0 auto; }
        #tds-body { padding: 10px; }
        .tds-row { align-items: flex-start; }
      }
    `;
    const style = document.createElement('style');
    style.id = 'tds-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }


  // ---------------------------------------------------------------------
  // 4b. TORN COLOUR DETECTION -- match the page's own skin, don't guess it
  // ---------------------------------------------------------------------
  // Torn ships more than one skin (at least a light default and a dark
  // theme) and I don't have a verified, current list of their exact hex
  // values -- guessing would risk a wrong-looking panel on whichever skin
  // I guessed wrong for. Instead this samples REAL computed colours from
  // Torn's own page chrome at runtime and derives a matching palette
  // algorithmically. If detection fails for any reason it silently falls
  // back to the dark palette hardcoded as the var() defaults in the CSS
  // above -- so a failure here never breaks the panel, only its skin-match.
  function parseRgbColor(str) {
    const m = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\)/.exec(str || '');
    if (!m) return null;
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] !== undefined ? +m[4] : 1 };
  }

  function shadeColor(c, amt) {
    const clamp = (v) => Math.max(0, Math.min(255, v));
    return { r: clamp(c.r + amt), g: clamp(c.g + amt), b: clamp(c.b + amt) };
  }

  function rgbToCss(c) {
    return `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`;
  }

  function detectTornColours() {
    try {
      const candidates = ['#skin-container', '.content-wrapper', '#mainContainer', '#top-page-links-wrap', 'body'];
      let probe = null;
      for (const sel of candidates) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const bg = parseRgbColor(getComputedStyle(el).backgroundColor);
        if (bg && bg.a > 0 && !(bg.r === 0 && bg.g === 0 && bg.b === 0 && bg.a < 1)) { probe = el; break; }
      }
      if (!probe) return;

      const cs = getComputedStyle(probe);
      const bg = parseRgbColor(cs.backgroundColor);
      if (!bg) return;

      const luminance = (0.299 * bg.r + 0.587 * bg.g + 0.114 * bg.b) / 255;
      const dark = luminance < 0.5;
      const root = document.documentElement;

      if (dark) {
        // Keep the built-in dark palette (it already reads well on dark
        // skins) but nudge every shade slightly toward Torn's actual
        // background tone instead of leaving it a fixed, possibly
        // mismatched dark navy.
        const nudge = (fallback) => rgbToCss({
          r: fallback.r * 0.6 + bg.r * 0.4,
          g: fallback.g * 0.6 + bg.g * 0.4,
          b: fallback.b * 0.6 + bg.b * 0.4,
        });
        root.style.setProperty('--tds-bg', nudge({ r: 43, g: 43, b: 43 }));
        root.style.setProperty('--tds-bg-alt', nudge({ r: 56, g: 56, b: 56 }));
        root.style.setProperty('--tds-bg-card', nudge({ r: 50, g: 50, b: 50 }));
        root.style.setProperty('--tds-bg-hover', nudge({ r: 64, g: 64, b: 64 }));
      } else {
        // Light Torn skin: derive a full light palette FROM the sampled
        // background rather than forcing the dark defaults onto a light
        // page, where they'd look like a jarring floating dark box.
        root.style.setProperty('--tds-bg', rgbToCss(bg));
        root.style.setProperty('--tds-bg-alt', rgbToCss(shadeColor(bg, -10)));
        root.style.setProperty('--tds-bg-card', rgbToCss(shadeColor(bg, -5)));
        root.style.setProperty('--tds-bg-hover', rgbToCss(shadeColor(bg, -14)));
        root.style.setProperty('--tds-border', rgbToCss(shadeColor(bg, -28)));
        root.style.setProperty('--tds-border-soft', rgbToCss(shadeColor(bg, -16)));
        root.style.setProperty('--tds-border-strong', rgbToCss(shadeColor(bg, -38)));
        root.style.setProperty('--tds-fg', rgbToCss(shadeColor(bg, -110)));
        root.style.setProperty('--tds-text-strong', rgbToCss(shadeColor(bg, -120)));
        root.style.setProperty('--tds-text-mid', rgbToCss(shadeColor(bg, -75)));
        root.style.setProperty('--tds-text-mid2', rgbToCss(shadeColor(bg, -80)));
        root.style.setProperty('--tds-text-dim', rgbToCss(shadeColor(bg, -55)));
        root.style.setProperty('--tds-text-faint', rgbToCss(shadeColor(bg, -60)));
        root.style.setProperty('--tds-text-faintest', rgbToCss(shadeColor(bg, -45)));
        root.style.setProperty('--tds-text-icon', rgbToCss(shadeColor(bg, -65)));
        root.style.setProperty('--tds-text-subtle', rgbToCss(shadeColor(bg, -50)));
        root.style.setProperty('--tds-text-disabled', rgbToCss(shadeColor(bg, -30)));
      }
    } catch (err) {
      console.warn('[TDS] Torn colour detection skipped:', err);
    }
  }

  function applyTheme(panelRoot, name) {
    const theme = THEME_PRESETS[name] || THEME_PRESETS.green;
    panelRoot.style.setProperty('--tds-accent', theme.accent);
    panelRoot.style.setProperty('--tds-accent-dim', theme.accentDim);
  }

  // ---------------------------------------------------------------------
  // 5. UI STATE
  // ---------------------------------------------------------------------
  const state = {
    lastResults: null,
    lastVerdict: null,
    lastRunAt: null,
    diagnosticRunning: false,
    panel: null,
    benchmark: { tier: 'same', cache: {}, snapshot: null, staffingCache: {} }, // compare + on-demand staffing cache
    stock: { loading: false, newsCache: null, newsCacheAt: 0 },
  };

  function isJobsPage() {
    return /(?:^|\/)companies\.php$/i.test(window.location.pathname);
  }

  function findJobsMount() {
    const anchors = [
      '.companies-wrap',
      '#companies-page',
      '.content-wrapper',
      '#main-container',
      '#mainContainer',
      '.cont-gray',
    ];
    for (const selector of anchors) {
      const el = document.querySelector(selector);
      if (el && !el.closest('#tds-panel')) return el;
    }
    return null;
  }

  function removePanel() {
    const panel = document.getElementById('tds-panel');
    if (panel) panel.remove();
    state.panel = null;
  }

  function buildPanel(mount) {
    const panel = document.createElement('section');
    panel.id = 'tds-panel';
    panel.setAttribute('aria-label', 'Torn Company Management Suite');
    panel.innerHTML = `
      <div id="tds-header">
        <div class="tds-brand">
          <span class="tds-brand-dot">\u25cb</span>
          <span class="tds-brand-name">TORN COMPANY MANAGEMENT SUITE</span>
          <span class="tds-brand-version">v${TDS_VERSION}</span>
          <span class="tds-access-badge" id="tds-access-badge">ACCESS: —</span>
          <span class="tds-brand-subtitle">Company Director Dashboard</span>
        </div>
        <div id="tds-header-icons">
          <button data-action="refresh" title="Run Diagnostics Again">\u27f3</button>
          <button data-action="tab-settings" title="Settings">\u2699</button>
        </div>
      </div>
      <div id="tds-tabs">
        <button class="tds-tab tds-tab-active" data-tab="overview">OVERVIEW</button>
        <button class="tds-tab" data-tab="finance">COMPANY FINANCIALS</button>
        <button class="tds-tab" data-tab="stock">STOCK MANAGEMENT</button>
        <button class="tds-tab" data-tab="training">TRAINING</button>
        <button class="tds-tab" data-tab="benchmark">COMPARE</button>
        <button class="tds-tab" data-tab="optimize">EMPLOYEE EFFECTIVENESS</button>
        <button class="tds-tab" data-tab="settings">SETTINGS</button>
        <button class="tds-tab" data-tab="diagnostics">DIAGNOSTICS</button>
      </div>
      <div id="tds-body">
        <div class="tds-tabpanel" data-tabpanel="overview"></div>
        <div class="tds-tabpanel" data-tabpanel="finance" hidden></div>
        <div class="tds-tabpanel" data-tabpanel="stock" hidden></div>
        <div class="tds-tabpanel" data-tabpanel="training" hidden></div>
        <div class="tds-tabpanel" data-tabpanel="benchmark" hidden></div>
        <div class="tds-tabpanel" data-tabpanel="optimize" hidden></div>
        <div class="tds-tabpanel" data-tabpanel="settings" hidden></div>
        <div class="tds-tabpanel" data-tabpanel="diagnostics" hidden></div>
      </div>
      <div id="tds-footer">
        <span>Torn Company Management Suite v${TDS_VERSION}</span>
        <span class="tds-footer-status" id="tds-footer-status">Last run: Never</span>
      </div>
    `;

    // Put the suite into Torn's Jobs content rather than attaching an overlay to body.
    mount.prepend(panel);
    state.panel = panel;
    const cachedAccessLevel = GM_getValue(STORAGE_KEY_LAST_VERDICT, null)?.level || 'unknown';
    updateHeaderAccessBadge(panel, { level: cachedAccessLevel });

    applyTheme(panel, GM_getValue(STORAGE_KEY_THEME, 'green'));

    panel.querySelector('[data-action="tab-settings"]').addEventListener('click', () => switchTab(panel, 'settings'));
    panel.querySelector('[data-action="refresh"]').addEventListener('click', () => runFullDiagnostic(panel, { force: true }));
    panel.querySelectorAll('.tds-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.classList.contains('tds-tab-locked')) return;
        switchTab(panel, btn.dataset.tab);
      });
    });

    renderSettingsTab(panel);
    renderDiagnosticsTab(panel, null);
    renderOverviewTab(panel, null, null);
    renderFinanceTab(panel);
    renderStockTab(panel);
    renderTrainingTab(panel).catch((err) => console.error('[TDS] Training render failed:', err));
    renderBenchmarkTab(panel);
    renderOptimizeTab(panel);
    switchTab(panel, 'overview');

    return panel;
  }

  function switchTab(panel, tabName) {
    panel.querySelectorAll('.tds-tab').forEach((b) => b.classList.toggle('tds-tab-active', b.dataset.tab === tabName));
    panel.querySelectorAll('.tds-tabpanel').forEach((p) => {
      p.hidden = p.dataset.tabpanel !== tabName;
    });
    // Sales history can require an extra company/news API request. Load it only
    // when the Stock tab is actually opened, not on every Torn page refresh.
    if (tabName === 'stock') renderStockTab(panel).catch((err) => console.error('[TDS] Stock tab failed:', err));
    setTimeout(() => bindEmployeeProfileLinks(panel), 0);
  }

  function renderSettingsTab(panel) {
    const el = panel.querySelector('[data-tabpanel="settings"]');
    const currentTheme = GM_getValue(STORAGE_KEY_THEME, 'green');

    el.innerHTML = `
      <div class="tds-section-label">API Key</div>
      <div class="tds-box tds-box-neutral">Stored only in this browser (Tampermonkey local storage). Never sent anywhere except api.torn.com.</div>
      <div class="tds-box tds-box-warn">
        <strong>What the custom API key allows</strong>
        <ul style="margin:6px 0 0 18px; padding:0;">
          <li><strong>Company information:</strong> reads your company profile, employees and company type information.</li>
          <li><strong>Director information:</strong> allows the suite to read financials, stock and applications when the key belongs to the company director.</li>
          <li><strong>Company history:</strong> provides company news and snapshot data used for performance history and backfill.</li>
          <li><strong>Employee & training information:</strong> provides your basic work information and the history used by the Training features.</li>
        </ul>
      </div>
      <div class="tds-box tds-box-neutral">
        The button below creates a <strong>Custom API Key</strong> with only the permissions requested by Torn Company Management Suite.
        Some company management data is only available when the key belongs to the company director.
      </div>
      <div class="tds-box tds-box-neutral">
        <strong>Create the API key for this program.</strong><br>
        This opens Torn's official custom-key generator with the permissions used by
        <strong>Torn Company Management Suite</strong> already selected:
        <strong>Company: Profile, Employees, Detailed, Stock, News, Applications, Companies, Search, Snapshot</strong>;
        <strong>User: Basic, Workstats, Log</strong>;
        <strong>Torn: Companies</strong>.<br><br>
        Torn will handle the actual key creation. Review the selections on Torn's page,
        generate the key, then paste the new key into the box below. Custom keys should be
        treated as sensitive credentials.
      </div>
      <button class="tds-btn" id="tds-create-api-key">Create Custom API Key ↗</button>
      <div style="position:relative; margin-top:8px;">
        <input class="tds-input" id="tds-keyinput" type="password" autocomplete="off" spellcheck="false" placeholder="Paste API key here" style="padding-right:76px; width:100%; box-sizing:border-box;" />
        <button type="button" class="tds-btn-ghost" id="tds-togglekey" style="position:absolute; right:6px; top:50%; transform:translateY(-50%); padding:4px 8px; font-size:11px;">Show</button>
      </div>
      <div style="margin-top:8px; display:flex; gap:8px;">
        <button class="tds-btn" id="tds-savekey">Save key</button>
      </div>
      <div class="tds-box tds-box-neutral" style="margin-top:10px;">
        Once an API key is saved, the system can run automatically on startup. No UI action is required.
      </div>

      <div class="tds-section-label">Diagnostics</div>
      <div class="tds-box tds-box-neutral">
        Diagnostics are automatically run once and remembered across Torn page changes and browser refreshes.
        Run them again manually whenever you want to refresh the capability check. The Diagnostics tab itself
        is always available \u2014 nothing about it is gated.
      </div>
      <button class="tds-btn-ghost" id="tds-rerun-diagnostics">Run Diagnostics Again</button>

      <div class="tds-section-label">License</div>
      <div class="tds-card">
        <div class="tds-row"><span class="tds-row-label">Torn User ID</span><span class="tds-row-value" id="tds-license-userid">\u2014</span></div>
        <div class="tds-row"><span class="tds-row-label">Status</span><span class="tds-row-value" id="tds-license-status-value">\u2014</span></div>
        <div class="tds-row"><span class="tds-row-label">License Type</span><span class="tds-row-value" id="tds-license-type">\u2014</span></div>
        <div class="tds-row"><span class="tds-row-label">Started</span><span class="tds-row-value" id="tds-license-started">\u2014</span></div>
        <div class="tds-row"><span class="tds-row-label">Expires</span><span class="tds-row-value" id="tds-license-expires">\u2014</span></div>
        <div class="tds-row"><span class="tds-row-label">Time Remaining</span><span class="tds-row-value" id="tds-license-remaining">\u2014</span></div>
        <div class="tds-row"><span class="tds-row-label">Last checked</span><span class="tds-row-value" id="tds-license-checked">\u2014</span></div>
        <div class="tds-row" id="tds-license-reason-row" style="display:none;"><span class="tds-row-label">Detail</span><span class="tds-row-value tds-v-dim" id="tds-license-reason" style="font-weight:400;"></span></div>
        <div style="margin-top:8px;">
          <button class="tds-btn-ghost" id="tds-recheck-license">Recheck license</button>
        </div>
      </div>
      <div class="tds-box tds-box-neutral">
        Checked against a public list keyed by your Torn User ID, refreshed at most every
        ${LICENSE_CACHE_TTL_MS / 3600000}h (cached locally in between). Only your numeric User ID is sent for
        this check \u2014 no API key, no company data, nothing else about you.
      </div>

      <div class="tds-section-label">Color Theme</div>
      <div class="tds-card">
        <div class="tds-card-title">Accent color (affects highlights, tabs, buttons \u2014 not the red/green/amber meaning colors)</div>
        <div class="tds-swatches" id="tds-swatches"></div>
      </div>
    `;

    const keyInput = el.querySelector('#tds-keyinput');
    const toggleKey = el.querySelector('#tds-togglekey');
    keyInput.value = GM_getValue(STORAGE_KEY_APIKEY, '');

    // Keep the API key masked by default. It can be temporarily revealed
    // with the Show button when the user needs to verify or edit it.
    toggleKey.addEventListener('click', () => {
      const visible = keyInput.type === 'text';
      keyInput.type = visible ? 'password' : 'text';
      toggleKey.textContent = visible ? 'Show' : 'Hide';
    });

    // Open Torn's official custom-key creation flow with this suite's
    // required selections and title pre-filled. Torn performs the actual
    // key generation; this script never sees the generated key until the
    // user deliberately pastes it into the input below.
    el.querySelector('#tds-create-api-key').addEventListener('click', () => {
      const url = buildCustomKeyUrl();
      window.open(url, '_blank', 'noopener');
    });

    el.querySelector('#tds-savekey').addEventListener('click', async () => {
      const key = keyInput.value.trim();
      GM_setValue(STORAGE_KEY_APIKEY, key);
      keyInput.style.borderColor = 'var(--tds-accent)';
      setTimeout(() => (keyInput.style.borderColor = ''), 600);
      if (key && !state.diagnosticRunning) {
        try {
          await runFullDiagnostic(panel, { force: true });
        } catch (err) {
          console.error('[TDS] Run after API key save failed:', err);
        }
      }
    });

    const rerunButton = el.querySelector('#tds-rerun-diagnostics');
    rerunButton.addEventListener('click', async () => {
      if (state.diagnosticRunning) return;
      try {
        await runFullDiagnostic(panel, { force: true });
      } catch (err) {
        console.error('[TDS] Manual diagnostic run failed:', err);
      }
    });

    el.querySelector('#tds-recheck-license').addEventListener('click', () => {
      checkLicense(panel, { force: true }).catch((err) => console.error('[TDS] License recheck failed:', err));
    });
    renderLicenseStatusInSettings(panel);

    const swatchWrap = el.querySelector('#tds-swatches');
    Object.entries(THEME_PRESETS).forEach(([name, theme]) => {
      const sw = document.createElement('div');
      sw.className = 'tds-swatch' + (name === currentTheme ? ' tds-swatch-active' : '');
      sw.style.background = theme.accent;
      sw.title = name;
      sw.addEventListener('click', () => {
        GM_setValue(STORAGE_KEY_THEME, name);
        applyTheme(panel, name);
        swatchWrap.querySelectorAll('.tds-swatch').forEach((s) => s.classList.remove('tds-swatch-active'));
        sw.classList.add('tds-swatch-active');
      });
      swatchWrap.appendChild(sw);
    });
  }

  function renderDiagnosticsTab(panel, results) {
    const el = panel.querySelector('[data-tabpanel="diagnostics"]');
    if (!results) {
      el.innerHTML = `<div class="tds-box tds-box-neutral">Diagnostics run automatically on first use and can be rerun from Settings or the refresh button in the header. This shows exactly what your current key can access \u2014 every row reflects a real response from api.torn.com.</div>`;
      return;
    }
    let html = '<div class="tds-section-label">Capability check</div>';
    for (const r of results) {
      if (r.status === 'ok') {
        html += `
          <div class="tds-diag-row">
            <div>
              <div class="tds-diag-label">${r.label}</div>
              <div class="tds-diag-reason">Fields: ${r.sampleKeys.join(', ')}</div>
            </div>
            <span class="tds-badge tds-badge-ok">ACCESSIBLE</span>
          </div>`;
      } else {
        html += `
          <div class="tds-diag-row">
            <div>
              <div class="tds-diag-label">${r.label}</div>
              <div class="tds-diag-reason">Torn error ${r.code ?? ''}: ${r.reason}</div>
            </div>
            <span class="tds-badge tds-badge-blocked">BLOCKED</span>
          </div>`;
      }
    }
    el.innerHTML = html;
  }

  function updateHeaderAccessBadge(panel, verdict) {
    const badge = panel?.querySelector('#tds-access-badge');
    if (!badge) return;

    const level = verdict?.level || 'unknown';
    const labels = {
      director: 'DIRECTOR ACCESS',
      employee: 'EMPLOYEE ACCESS',
      partial: 'PARTIAL ACCESS',
      unknown: 'ACCESS UNKNOWN',
    };

    badge.textContent = labels[level] || 'ACCESS UNKNOWN';
    badge.className = `tds-access-badge tds-access-${level}`;
    badge.title = 'Access level determined by Diagnostics';
  }

  function directorFeatureNotice(featureName = 'This feature') {
    const verdict = state.lastVerdict || GM_getValue(STORAGE_KEY_LAST_VERDICT, null) || { level: 'unknown' };
    const level = verdict?.level || 'unknown';

    if (level === 'director') return '';

    if (level === 'employee') {
      return `<div class="tds-box tds-box-warn">
        <strong>Director Feature</strong><br>
        ${escapeHtml(featureName)} requires <strong>Director Access</strong> to display the full company data and calculations.<br>
        You currently have <strong>Employee Access</strong>.
      </div>`;
    }

    if (level === 'partial') {
      return `<div class="tds-box tds-box-warn">
        <strong>Director Feature — access not fully confirmed</strong><br>
        ${escapeHtml(featureName)} needs director-only company data that is not currently available.
        Check <strong>Diagnostics</strong> to see which company selections are accessible.
      </div>`;
    }

    return `<div class="tds-box tds-box-warn">
      <strong>Director Feature — access unknown</strong><br>
      ${escapeHtml(featureName)} needs director-only company data.
      Run <strong>Diagnostics</strong> so the suite can confirm your current access level.
    </div>`;
  }

  function isDirectorAccess() {
    const verdict = state.lastVerdict || GM_getValue(STORAGE_KEY_LAST_VERDICT, null);
    return verdict?.level === 'director';
  }

  function employeeOnlineStatusMeta(status) {
    const normalized = String(status || '').trim().toLowerCase();

    if (normalized === 'online') {
      return {
        badgeClass: 'tds-badge-ok',
        textClass: 'tds-v-good',
      };
    }

    if (normalized === 'idle') {
      return {
        badgeClass: 'tds-badge-warn',
        textClass: 'tds-v-warn',
      };
    }

    if (normalized === 'offline') {
      return {
        badgeClass: 'tds-badge-blocked',
        textClass: 'tds-v-bad',
      };
    }

    return {
      badgeClass: 'tds-badge-neutral',
      textClass: 'tds-v-dim',
    };
  }

  function findEmployeeByIdOrName(id, name) {
    return extractEmployeesEntries(findRaw(state.lastResults, 'company', 'employees'))
      .find((employee) =>
        (id !== null && id !== undefined && String(employee.id) === String(id)) ||
        String(employee.name || '').toLowerCase() === String(name || '').toLowerCase()
      ) || null;
  }

  function employeeDeepLinkSelector(id, name) {
    const safeId = String(id ?? '').replace(/"/g, '\\"');
    const safeName = String(name ?? '').replace(/"/g, '\\"');

    return [
      safeId ? `[data-employee-id="${safeId}"]` : '',
      safeName ? `[data-employee-name="${safeName}"]` : '',
    ].filter(Boolean).join(',');
  }

  function clearEmployeeDeepLinkHighlights(panel) {
    panel.querySelectorAll('.tds-employee-deeplink-highlight').forEach((node) => {
      node.classList.remove('tds-employee-deeplink-highlight');
    });
  }

  function focusEmployeeInTab(panel, tabName, employee) {
    switchTab(panel, tabName);

    const tryFocus = (attempt = 0) => {
      clearEmployeeDeepLinkHighlights(panel);

      const selector = employeeDeepLinkSelector(employee.id, employee.name);
      const candidates = selector
        ? [...panel.querySelectorAll(selector)]
        : [];

      const visible = candidates.find((node) => {
        const tabPanel = node.closest('.tds-tabpanel');
        return tabPanel && tabPanel.dataset.tabpanel === tabName && !tabPanel.hidden;
      });

      const target =
        visible?.closest('.tds-employee-row, tr, .tds-card, details') ||
        visible ||
        null;

      if (target) {
        if (target.tagName === 'DETAILS') {
          target.open = true;
        }

        target.classList.add('tds-employee-deeplink-highlight');
        target.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });

        setTimeout(() => {
          target.classList.remove('tds-employee-deeplink-highlight');
        }, 5000);

        return;
      }

      if (attempt < 12) {
        setTimeout(() => tryFocus(attempt + 1), 150);
      }
    };

    setTimeout(() => tryFocus(), 0);
  }

  function employeeRoleSummary(employee) {
    let roleSummary = 'Open Employee Effectiveness for detailed role analysis.';

    try {
      const profile = findRaw(state.lastResults, 'company', 'profile');
      const reference = findRaw(state.lastResults, 'torn', 'companies');
      const typeId = numericValue(findValueDeep(profile, ['company_type', 'type_id', 'type']));
      const typeName = resolveCompanyTypeName(reference, typeId);
      const positions = extractPositionRequirements(reference, typeId).map((position) => ({
        ...position,
        resolvedSpecial: resolvePositionSpecial(position, typeId, typeName),
      }));

      const row = positions.length
        ? buildEmployeePositionMatrix([employee], positions)[0]
        : null;

      if (row?.best?.position?.name) {
        roleSummary =
          `Best estimated role: ${row.best.position.name}` +
          `${typeof row.best.estimate?.total === 'number'
            ? ` · ${formatNumber(row.best.estimate.total)} EE`
            : ''}`;
      }
    } catch (err) {
      console.warn('[TDS] Employee inline role summary unavailable:', err);
    }

    return roleSummary;
  }

  function openEmployeeDetail(panel, id, name) {
    const employee = findEmployeeByIdOrName(id, name);
    if (!employee) return;

    // Employee details now live in the existing collapsible Overview row.
    // From any tab, jump to Overview and expand/highlight the selected employee.
    switchTab(panel, 'overview');

    const selector = employeeDeepLinkSelector(employee.id, employee.name);

    const tryOpen = (attempt = 0) => {
      const overview = panel.querySelector('[data-tabpanel="overview"]');
      const node = selector ? overview?.querySelector(selector) : null;
      const details = node?.closest('details.tds-employee-row') || node;

      if (details) {
        if (details.tagName === 'DETAILS') details.open = true;
        details.classList.add('tds-employee-deeplink-highlight');
        details.scrollIntoView({ behavior: 'smooth', block: 'center' });

        setTimeout(() => {
          details.classList.remove('tds-employee-deeplink-highlight');
        }, 5000);
        return;
      }

      if (attempt < 12) {
        setTimeout(() => tryOpen(attempt + 1), 150);
      }
    };

    setTimeout(() => tryOpen(), 0);
  }

  function bindEmployeeProfileLinks(panel) {
    panel.querySelectorAll('[data-employee-profile]').forEach((node) => {
      if (node.dataset.profileBound === '1') return;
      node.dataset.profileBound = '1';
      node.addEventListener('click', (event) => {
        event.preventDefault(); event.stopPropagation();
        openEmployeeDetail(panel, node.dataset.employeeId, node.dataset.employeeName);
      });
    });
  }

  function snapshotCompanySummary(snapshot) {
    if (!snapshot) return null;

    const profile = snapshot.company_profile || null;
    const detailed = snapshot.company_detailed || null;
    const employeesRaw = snapshot.company_employees || null;
    const employees = extractEmployeesEntries(employeesRaw);
    const performance = snapshot.performance || performanceRecordFromSnapshot(snapshot);
    const roleSummary = performanceRoleSummary(employeesRaw);

    const sources = [profile, detailed].filter(Boolean);
    const metric = (aliases) => {
      for (const source of sources) {
        const value = numericValue(findValueDeep(source, aliases));
        if (value !== null) return value;
      }
      return null;
    };

    return {
      timestamp: Number(snapshot.timestamp || 0),
      profile,
      employees,
      employeeCount: employees.length || roleSummary.employeeCount || null,
      totalEE: roleSummary.employeesWithEE ? roleSummary.totalEE : null,
      dailyIncome: performance?.observed?.dailyIncome ?? metric(['daily_income', 'income_daily']),
      dailyCustomers: performance?.observed?.dailyCustomers ?? metric(['daily_customers', 'customers_daily']),
      weeklyIncome: performance?.observed?.weeklyIncome ?? metric(['weekly_income', 'income_weekly']),
      weeklyCustomers: performance?.observed?.weeklyCustomers ?? metric(['weekly_customers', 'customers_weekly']),
      rating: metric(['rating', 'star_rating', 'stars', 'company_rating']),
      popularity: metric(['popularity', 'company_popularity']),
      efficiency: metric(['efficiency', 'company_efficiency']),
      environment: metric(['environment', 'company_environment']),
      trains: metric(['trains_available', 'available_trains', 'trains', 'trains_remaining', 'company_trains']),
    };
  }

  function formatSignedChange(value, formatter = formatNumber) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
    return `${value > 0 ? '+' : ''}${formatter(value)}`;
  }

  function snapshotChangeEvents(previousSnapshot, currentSnapshot) {
    const previous = snapshotCompanySummary(previousSnapshot);
    const current = snapshotCompanySummary(currentSnapshot);
    if (!previous || !current) return [];

    const events = [];
    const pushNumeric = (key, label, formatter, meaningful = () => true) => {
      const before = previous[key];
      const after = current[key];
      if (typeof before !== 'number' || typeof after !== 'number' || before === after) return;
      const delta = after - before;
      if (!meaningful(delta, before, after)) return;
      events.push({
        type: key,
        timestamp: current.timestamp,
        label,
        before,
        after,
        delta,
        text: `${label}: ${formatter(before)} → ${formatter(after)} (${formatSignedChange(delta, formatter)})`,
      });
    };

    pushNumeric('dailyIncome', 'Daily Income', formatMoney);
    pushNumeric('dailyCustomers', 'Daily Customers', formatNumber);
    pushNumeric('weeklyIncome', 'Weekly Income', formatMoney);
    pushNumeric('weeklyCustomers', 'Weekly Customers', formatNumber);
    pushNumeric('rating', 'Rating', (value) => `${formatNumber(value)}★`);
    pushNumeric('popularity', 'Popularity', (value) => `${formatNumber(value)}%`);
    pushNumeric('efficiency', 'Efficiency', (value) => `${formatNumber(value)}%`);
    pushNumeric('environment', 'Environment', (value) => `${formatNumber(value)}%`);
    pushNumeric('trains', 'Trains Available', formatNumber);
    pushNumeric('employeeCount', 'Employee Count', formatNumber);
    pushNumeric('totalEE', 'Total Employee EE', formatNumber);

    const previousById = new Map(previous.employees.map((employee) => [String(employee.id), employee]));
    const currentById = new Map(current.employees.map((employee) => [String(employee.id), employee]));

    for (const [id, employee] of currentById) {
      const old = previousById.get(id);
      if (!old) {
        events.push({
          type: 'employee_joined',
          timestamp: current.timestamp,
          employeeId: id,
          text: `${employee.name} joined the company${employee.position ? ` as ${employee.position}` : ''}.`,
        });
        continue;
      }

      if (String(old.position || '') !== String(employee.position || '')) {
        events.push({
          type: 'position_change',
          timestamp: current.timestamp,
          employeeId: id,
          text: `${employee.name}: ${old.position || 'Unassigned'} → ${employee.position || 'Unassigned'}.`,
        });
      }

      const oldEE = getEmployeeEffectiveness(old.raw)?.total;
      const newEE = getEmployeeEffectiveness(employee.raw)?.total;
      if (typeof oldEE === 'number' && typeof newEE === 'number' && oldEE !== newEE) {
        events.push({
          type: 'employee_ee',
          timestamp: current.timestamp,
          employeeId: id,
          delta: newEE - oldEE,
          text: `${employee.name} EE: ${formatNumber(oldEE)} → ${formatNumber(newEE)} (${formatSignedChange(newEE - oldEE)}).`,
        });
      }
    }

    for (const [id, employee] of previousById) {
      if (!currentById.has(id)) {
        events.push({
          type: 'employee_left',
          timestamp: current.timestamp,
          employeeId: id,
          text: `${employee.name} left the company.`,
        });
      }
    }

    return events;
  }

  function overviewChangeClass(event) {
    if (!event) return '';
    if (['employee_left'].includes(event.type)) return 'tds-v-bad';
    if (['employee_joined'].includes(event.type)) return 'tds-v-good';
    if (typeof event.delta !== 'number') return '';
    if (['dailyIncome', 'dailyCustomers', 'weeklyIncome', 'weeklyCustomers', 'rating', 'popularity', 'efficiency', 'environment', 'totalEE'].includes(event.type)) {
      return event.delta > 0 ? 'tds-v-good' : event.delta < 0 ? 'tds-v-bad' : '';
    }
    return '';
  }

  function buildAttentionItems(previousSnapshot, currentSnapshot, results) {
    const previous = snapshotCompanySummary(previousSnapshot);
    const current = snapshotCompanySummary(currentSnapshot);
    const items = [];
    if (!current) return items;

    const add = (severity, title, detail, tab = null) => {
      items.push({ severity, title, detail, tab });
    };

    if (previous) {
      if (typeof previous.dailyIncome === 'number' && previous.dailyIncome > 0 && typeof current.dailyIncome === 'number') {
        const pct = ((current.dailyIncome - previous.dailyIncome) / previous.dailyIncome) * 100;
        if (pct <= -10) add('bad', 'Daily income dropped', `${Math.abs(pct).toFixed(1)}% below the previous comparable snapshot.`, 'finance');
        else if (pct >= 10) add('good', 'Daily income improved', `${pct.toFixed(1)}% above the previous comparable snapshot.`, 'finance');
      }

      if (typeof previous.environment === 'number' && typeof current.environment === 'number' && current.environment <= previous.environment - 3) {
        add('warn', 'Environment fell', `${formatNumber(previous.environment)}% → ${formatNumber(current.environment)}%.`, 'overview');
      }

      if (typeof previous.efficiency === 'number' && typeof current.efficiency === 'number' && current.efficiency <= previous.efficiency - 3) {
        add('warn', 'Efficiency fell', `${formatNumber(previous.efficiency)}% → ${formatNumber(current.efficiency)}%.`, 'overview');
      }

      if (typeof previous.employeeCount === 'number' && typeof current.employeeCount === 'number' && current.employeeCount < previous.employeeCount) {
        add('warn', 'Roster reduced', `${formatNumber(previous.employeeCount)} → ${formatNumber(current.employeeCount)} employees.`, 'optimize');
      }

      if (typeof previous.totalEE === 'number' && previous.totalEE > 0 && typeof current.totalEE === 'number') {
        const pct = ((current.totalEE - previous.totalEE) / previous.totalEE) * 100;
        if (pct <= -5) add('warn', 'Total employee EE fell', `${Math.abs(pct).toFixed(1)}% below the previous snapshot.`, 'optimize');
      }
    }

    // Training attention uses already-cached Diagnostic results only. No extra
    // API request is made just to populate Overview.
    try {
      const employeesRaw = findRaw(results, 'company', 'employees');
      const employees = extractEmployeesEntries(employeesRaw);
      const newsRaw = findRaw(results, 'company', 'news');
      const logRaw = findRaw(results, 'user', 'log');

      if (employees.length && (newsRaw || logRaw)) {
        const newsParsed = collectTrainingEvents(newsRaw, employees);
        const logParsed = collectTrainingEvents(logRaw, employees);
        const events = mergeTrainingEventSources(newsParsed.events, logParsed.events);
        const entries = [...newsParsed.sourceEntries, ...logParsed.sourceEntries];
        const coverageStart = entries.length
          ? Math.min(...entries.map((entry) => Number(entry.timestamp)).filter(Number.isFinite))
          : null;

        if (events.length && coverageStart) {
          const debt = calculateRotationalDebt(employees, events, coverageStart);
          const mostOwed = debt.rows.find((row) => row.eligibleWeight > 0);
          if (mostOwed && mostOwed.debt > 1) {
            add(
              'warn',
              'Training debt needs attention',
              `${mostOwed.employee.name} is approximately ${mostOwed.debt.toFixed(2)} train(s) behind fair share.`,
              'training'
            );
          }
        }
      }
    } catch (err) {
      console.warn('[TDS] Attention Centre training check unavailable:', err);
    }

    if (!items.length) {
      add('good', 'No major changes need attention', 'Nothing crossed the current alert thresholds in the latest comparable data.');
    }

    return items.slice(0, 8);
  }

  async function renderOverviewIntelligence(panel, results) {
    const target = panel.querySelector('#tds-overview-intelligence');
    if (!target) return;

    if (!isDirectorAccess()) {
      target.innerHTML = directorFeatureNotice('Attention Centre, What Changed? and Company Timeline');
      return;
    }

    try {
      const snapshots = collapseToDaily(await getSnapshotsSorted());
      if (snapshots.length < 2) {
        target.innerHTML = `
          <div class="tds-section-label">Attention Centre</div>
          <div class="tds-box tds-box-neutral">More than one local daily snapshot is needed before change alerts and the company timeline can be calculated.</div>
          <div class="tds-section-label">What Changed?</div>
          <div class="tds-box tds-box-neutral">No previous comparable local snapshot yet.</div>`;
        return;
      }

      const current = snapshots[snapshots.length - 1];
      const previous = snapshots[snapshots.length - 2];
      const latestEvents = snapshotChangeEvents(previous, current);
      const attention = buildAttentionItems(previous, current, results);

      let html = `<div class="tds-section-label">Attention Centre</div><div class="tds-attention-grid">`;
      for (const item of attention) {
        const cls = item.severity === 'bad'
          ? 'tds-v-bad'
          : item.severity === 'warn'
            ? 'tds-v-warn'
            : 'tds-v-good';

        html += `<div class="tds-attention-item ${cls}"${item.tab ? ` data-attention-tab="${escapeHtml(item.tab)}" style="cursor:pointer;"` : ''}>
          <strong>${escapeHtml(item.title)}</strong>
          <span>${escapeHtml(item.detail)}</span>
        </div>`;
      }
      html += `</div>`;

      html += `<div class="tds-section-label">What Changed?</div>`;
      if (!latestEvents.length) {
        html += `<div class="tds-box tds-box-neutral">No meaningful changes were detected between the last two daily local snapshots.</div>`;
      } else {
        html += `<div class="tds-card">`;
        for (const event of latestEvents.slice(0, 10)) {
          html += `<div class="tds-row">
            <span class="tds-row-label">${escapeHtml(event.text)}</span>
            <span class="tds-row-value ${overviewChangeClass(event)}">${overviewChangeClass(event) === 'tds-v-good' ? '▲' : overviewChangeClass(event) === 'tds-v-bad' ? '▼' : '•'}</span>
          </div>`;
        }
        html += `</div>`;
      }

      const timelineEvents = [];
      for (let index = Math.max(1, snapshots.length - 30); index < snapshots.length; index += 1) {
        timelineEvents.push(...snapshotChangeEvents(snapshots[index - 1], snapshots[index]));
      }
      timelineEvents.sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));

      html += `<details style="margin-top:10px;">
        <summary class="tds-section-label" style="cursor:pointer;">Company Timeline</summary>`;

      if (!timelineEvents.length) {
        html += `<div class="tds-box tds-box-neutral">No meaningful company changes have been recorded in the available local snapshot history.</div>`;
      } else {
        html += `<div class="tds-timeline">`;
        for (const event of timelineEvents.slice(0, 40)) {
          html += `<div class="tds-timeline-item ${overviewChangeClass(event)}">
            <div class="tds-timeline-date">${escapeHtml(new Date(event.timestamp).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }))}</div>
            <div class="tds-timeline-text">${escapeHtml(event.text)}</div>
          </div>`;
        }
        html += `</div>`;
      }

      html += `<div class="tds-box tds-box-neutral">
        Timeline and What Changed are <strong>CALCULATED</strong> from locally stored snapshots.
        They describe changes observed together and do not claim that one change caused another.
      </div></details>`;

      target.innerHTML = html;

      target.querySelectorAll('[data-attention-tab]').forEach((node) => {
        node.addEventListener('click', () => switchTab(panel, node.dataset.attentionTab));
      });
    } catch (err) {
      target.innerHTML = `<div class="tds-box tds-box-warn">Company change intelligence could not be calculated: ${escapeHtml(String(err?.message || err))}</div>`;
    }
  }

  function renderOverviewTab(panel, results, verdict) {
    const el = panel.querySelector('[data-tabpanel="overview"]');
    if (!results || !verdict) {
      el.innerHTML = `<div class="tds-box tds-box-neutral">No data yet. Add your API key in Settings, then run Diagnostics.</div>`;
      return;
    }

    updateHeaderAccessBadge(panel, verdict);

    let html = '';
    if (verdict.level === 'employee') {
      html += `<div class="tds-box tds-box-warn">Employee features are available. You need to be the company director to access the full management features.</div>`;
    } else if (verdict.level === 'partial') {
      html += `<div class="tds-box tds-box-warn">Some features are unavailable. Check Settings and Diagnostics for details.</div>`;
    } else if (verdict.level === 'unknown') {
      html += `<div class="tds-box tds-box-danger">Access level could not be confirmed yet. Run Diagnostics to refresh it.</div>`;
    }

    const profile = findRaw(results, 'company', 'profile');
    const detailed = findRaw(results, 'company', 'detailed');
    const employeesRaw = findRaw(results, 'company', 'employees');
    const employees = extractEmployeesEntries(employeesRaw);

    html += `<div id="tds-overview-intelligence">
      <div class="tds-section-label">Attention Centre</div>
      <div class="tds-box tds-box-neutral">Analysing recent local company changes…</div>
    </div>`;

    // Show every usable scalar value returned by company/profile, rather than
    // maintaining a small hard-coded list. This means new fields Torn adds to
    // the profile automatically appear here too. Employee objects/collections
    // are excluded because the Employees section below renders them properly.
    if (profile) {
      const profileRows = collectDisplayFields(profile, {
        skipObjectKeys: ['employees', 'employee', 'positions']
      });

      const capacity = numericValue(findValueDeep(profile, [
        'employees_capacity', 'employee_capacity', 'max_employees',
        'maximum_employees', 'capacity'
      ]));
      const employeeCount = employees.length || numericValue(findValueDeep(profile, [
        'employees_hired', 'employee_count', 'employees_count', 'num_employees'
      ]));

      // Split high-level identity from operational metrics so Overview is
      // easier to scan on both desktop and PDA.
      const preferred = [
        ['name', 'Name'], ['company_name', 'Name'],
        ['type', 'Type'], ['company_type', 'Type'],
        ['director', 'Director'],
        ['id', 'ID'], ['company_id', 'ID'],
        ['rating', 'Rating'],
        ['days_old', 'Company Age'], ['age', 'Company Age'],
        ['popularity', 'Popularity'], ['efficiency', 'Efficiency'], ['environment', 'Environment'],
        ['trains_available', 'Trains Available'], ['trains', 'Trains'],
        ['daily_income', 'Daily Income'], ['daily_customers', 'Daily Customers'],
        ['weekly_income', 'Weekly Income'], ['weekly_customers', 'Weekly Customers'],
        ['company_bank', 'Company Bank'],
        ['advertising_budget', 'Advertising Budget'],
        ['company_value', 'Company Value'],
        ['storage', 'Storage'],
        ['applications_allowed', 'Applications Allowed']
      ];

      const infoLabels = new Set([
        'Name', 'Type', 'Director', 'ID'
      ]);

      const shown = new Set();
      const shownFieldNames = new Set();

      // API v2 company/profile encompasses the old profile + detailed data
      // for directors. Resolve important metrics from either payload so a
      // nesting change does not make them disappear from Overview.
      const metricSources = [profile, detailed].filter(Boolean);
      const findCompanyMetric = (aliases) => {
        for (const source of metricSources) {
          const value = findValueDeep(source, aliases);
          if (value !== null && value !== undefined && value !== '') return value;
        }
        return null;
      };

      const explicitMetrics = {
        Rating: findCompanyMetric(['rating', 'stars', 'star_rating', 'company_rating']),
        Popularity: findCompanyMetric(['popularity', 'company_popularity']),
        Efficiency: findCompanyMetric(['efficiency', 'company_efficiency']),
        Environment: findCompanyMetric(['environment', 'company_environment']),
        'Trains Available': findCompanyMetric([
          'trains_available', 'available_trains', 'trains', 'train_count',
          'trains_remaining', 'company_trains'
        ]),
        'Daily Income': findCompanyMetric(['daily_income', 'income_daily']),
        'Daily Customers': findCompanyMetric(['daily_customers', 'customers_daily']),
        'Weekly Income': findCompanyMetric(['weekly_income', 'income_weekly']),
        'Weekly Customers': findCompanyMetric(['weekly_customers', 'customers_weekly']),
        'Company Bank': findCompanyMetric(['company_bank', 'bank', 'company_funds']),
        'Advertising Budget': findCompanyMetric([
          'advertising_budget', 'advertising', 'ad_budget', 'daily_advertising'
        ]),
        'Company Value': findCompanyMetric([
          'company_value', 'value', 'market_value', 'sell_value'
        ]),
        'Storage': findCompanyMetric([
          'storage', 'storage_space', 'storage_size', 'warehouse_size'
        ]),
        'Applications Allowed': findCompanyMetric([
          'applications_allowed', 'applications_open', 'accepting_applications'
        ])
      };

      const preferredRows = [];

      for (const [key, label] of preferred) {
        const row = profileRows.find((r) => normalizeFieldName(r.key) === normalizeFieldName(key));
        const explicitValue = Object.prototype.hasOwnProperty.call(explicitMetrics, label)
          ? explicitMetrics[label]
          : null;

        if ((!row && explicitValue === null) || (row && shown.has(row.path))) continue;

        let formatter = formatCompanyValue;
        const value = row ? row.value : explicitValue;

        if (label === 'Director') {
          formatter = (value) => formatDirectorName(value, employees, results);
        } else if (label === 'Type') {
          formatter = (value) => formatCompanyType(value, results);
        } else if (label === 'ID') {
          // IDs are identifiers, not quantities: never add thousands separators.
          formatter = (value) => {
            if (value === null || value === undefined || value === '') return '—';
            return String(value).replace(/,/g, '');
          };
        } else if (label === 'Company Age') {
          formatter = formatCompanyAge;
        } else if (
          label === 'Daily Income' || label === 'Weekly Income' ||
          label === 'Company Bank' || label === 'Advertising Budget' ||
          label === 'Company Value'
        ) {
          formatter = formatCurrency;
        } else if (label === 'Popularity' || label === 'Efficiency' || label === 'Environment') {
          formatter = formatPercent;
        }

        preferredRows.push({ key, label, value, formatter, row });

        if (row) shown.add(row.path);
        shownFieldNames.add(normalizeFieldName(key));
      }

      html += '<div class="tds-section-label">Company Info</div><div class="tds-card">';

      for (const item of preferredRows.filter((item) => infoLabels.has(item.label))) {
        if (item.label === 'Director') {
          html += `<div class="tds-row">
            <span class="tds-row-label">Director</span>
            <span class="tds-row-value" id="tds-director-value">${escapeHtml(item.formatter(item.value))}</span>
          </div>`;
          state.currentDirectorValue = item.value;
        } else {
          html += companyOverviewRow(item.label, item.value, item.formatter);
        }
      }

      // Employee count belongs with the company's identity/size rather than
      // the operational statistics below.
      if (employeeCount !== null || capacity !== null) {
        html += companyOverviewRow('Number of Employees', employeeCount, () => {
          if (employeeCount !== null && capacity !== null) {
            return `${formatNumber(employeeCount)} / ${formatNumber(capacity)}`;
          }
          if (employeeCount !== null) return formatNumber(employeeCount);
          return `— / ${formatNumber(capacity)}`;
        });
      }

      html += '</div>';

      html += '<div class="tds-section-label">Company Statistics</div><div class="tds-card">';

      for (const item of preferredRows.filter((item) => !infoLabels.has(item.label))) {
        html += companyOverviewRow(item.label, item.value, item.formatter);
      }

      const preferredLabels = new Set(preferredRows.map((item) => item.label));
      for (const label of [
        'Rating', 'Popularity', 'Efficiency', 'Environment', 'Trains Available',
        'Advertising Budget', 'Company Value', 'Storage', 'Applications Allowed'
      ]) {
        if (preferredLabels.has(label)) continue;
        const value = explicitMetrics[label];
        if (value === null || value === undefined || value === '') continue;

        let formatter = formatCompanyValue;
        if (label === 'Popularity' || label === 'Efficiency' || label === 'Environment') {
          formatter = formatPercent;
        } else if (label === 'Advertising Budget' || label === 'Company Value') {
          formatter = formatCurrency;
        }
        html += companyOverviewRow(label, value, formatter);
      }

      // Preserve every other scalar Torn returns, but place it in Statistics.
      for (const row of profileRows) {
        if (shown.has(row.path)) continue;
        const nk = normalizeFieldName(row.key);
        if (shownFieldNames.has(nk)) continue;

        // Already represented by Number of Employees.
        if (/^(employeeshired|employeecount|employeescount|numemployees|employeescapacity|employeecapacity|maxemployees|maximumemployees|capacity)$/.test(nk)) continue;

        let formatter = formatCompanyValue;

        if (/^(dailyincome|weeklyincome)$/.test(nk)) {
          formatter = formatCurrency;
        } else if (/^(daysold|age)$/.test(nk)) {
          formatter = formatCompanyAge;
        } else if (/^(id|companyid)$/.test(nk)) {
          formatter = (value) => {
            if (value === null || value === undefined || value === '') return '—';
            return String(value).replace(/,/g, '');
          };
        }

        html += companyOverviewRow(row.label, row.value, formatter);
        shown.add(row.path);
      }

      html += '</div>';
    }

    // company/detailed is director-only. If the key can access it, include all
    // scalar fields here as part of Overview as requested. If Torn blocks it,
    // the existing access notice at the top already explains why.
    if (detailed) {
      const detailedRows = collectDisplayFields(detailed, {
        skipObjectKeys: ['employees', 'employee', 'positions']
      });
      if (detailedRows.length) {
        html += '<div class="tds-section-label">Company Details</div><div class="tds-card">';
        for (const row of detailedRows) {
          const nk = normalizeFieldName(row.key);
          const formatter = /^(dailyincome|weeklyincome)$/.test(nk) ? formatCurrency : formatCompanyValue;
          html += companyOverviewRow(row.label, row.value, formatter);
        }
        html += '</div>';
      }
    }

    html += '<div class="tds-section-label">Employees</div>';
    if (employees.length > 0) {
      html += '<div class="tds-card">';

      employees.slice(0, 15).forEach((employee) => {
        const emp = employee.raw;
        const effectiveness = emp.effectiveness && typeof emp.effectiveness === 'object'
          ? emp.effectiveness
          : null;
        const lastAction = emp.last_action && typeof emp.last_action === 'object'
          ? emp.last_action
          : null;
        const status = emp.status && typeof emp.status === 'object'
          ? emp.status
          : null;

        // Torn exposes two different concepts here:
        //   last_action.status -> Online / Idle / Offline presence
        //   status.state       -> player state such as Okay / Hospital / Traveling
        //   status.description -> human-readable detail for that state
        const onlineStatus = lastAction?.status || '—';
        const playerState = status?.state || '—';
        const stateDetail = status?.description || '—';
        const onlineMeta = employeeOnlineStatusMeta(onlineStatus);
        const lastActionText =
          lastAction?.relative ||
          formatTimestampRelative(lastAction?.timestamp) ||
          '—';

        html += `
          <details class="tds-employee-row" data-employee-id="${escapeHtml(String(employee.id))}" data-employee-name="${escapeHtml(String(employee.name))}">
            <summary class="tds-employee-summary">
              <div class="tds-employee-top">
                <div>
                  <div class="tds-employee-name" data-employee-id="${escapeHtml(String(employee.id))}" data-employee-name="${escapeHtml(String(employee.name))}">${escapeHtml(String(employee.name))}</div>
                  <div class="tds-employee-meta">
                    ${escapeHtml(String(employee.position || 'Employee'))}
                    <span class="${onlineMeta.textClass}" style="margin-left:6px;">· ${escapeHtml(String(lastActionText))}</span>
                  </div>
                </div>
                <div style="display:flex; align-items:center; gap:8px;">
                  <span class="tds-badge ${onlineMeta.badgeClass}">${escapeHtml(String(onlineStatus))}</span>
                  <span class="tds-employee-chevron">\u25b8</span>
                </div>
              </div>
            </summary>

            <div class="tds-card" style="margin:8px 0 0;">
              <div class="tds-row"><span class="tds-row-label">Days employed</span><span class="tds-row-value">${formatNumber(emp.days_in_company)}</span></div>
              <div class="tds-section-label tds-employee-subheading" style="margin-top:10px;">Working Stats</div>
              <div class="tds-row"><span class="tds-row-label">Manual Labor</span><span class="tds-row-value">${formatNumber(emp.manual_labor)}</span></div>
              <div class="tds-row"><span class="tds-row-label">Intelligence</span><span class="tds-row-value">${formatNumber(emp.intelligence)}</span></div>
              <div class="tds-row"><span class="tds-row-label">Endurance</span><span class="tds-row-value">${formatNumber(emp.endurance)}</span></div>

              ${effectiveness ? `
                <div class="tds-section-label tds-employee-subheading" style="margin-top:10px;">Effectiveness</div>
                <div class="tds-row"><span class="tds-row-label">Working Stats</span><span class="tds-row-value">${formatNumber(effectiveness.working_stats)}</span></div>
                <div class="tds-row"><span class="tds-row-label">Settled In</span><span class="tds-row-value">${formatNumber(effectiveness.settled_in)}</span></div>
                <div class="tds-row"><span class="tds-row-label">Director Education</span><span class="tds-row-value">${formatNumber(effectiveness.director_education)}</span></div>
                <div class="tds-row"><span class="tds-row-label">EE Merits</span><span class="tds-row-value">${typeof getEmployeeEEMerits(emp) === 'number' ? formatNumber(getEmployeeEEMerits(emp)) : '—'}</span></div>
                <div class="tds-row"><span class="tds-row-label">Addiction</span><span class="tds-row-value">${formatNumber(effectiveness.addiction)}</span></div>
                <div class="tds-row"><span class="tds-row-label">Total</span><span class="tds-row-value">${formatNumber(effectiveness.total)}</span></div>
              ` : ''}

              ${status || lastAction ? `
                <div class="tds-section-label tds-employee-subheading" style="margin-top:10px;">Status</div>
                <div class="tds-row"><span class="tds-row-label">Online Status</span><span class="tds-row-value ${onlineMeta.textClass}">${escapeHtml(String(onlineStatus))}</span></div>
                <div class="tds-row"><span class="tds-row-label">State</span><span class="tds-row-value">${escapeHtml(String(playerState))}</span></div>
                <div class="tds-row"><span class="tds-row-label">Detail</span><span class="tds-row-value">${escapeHtml(String(stateDetail))}</span></div>
                <div class="tds-row"><span class="tds-row-label">Last action</span><span class="tds-row-value ${onlineMeta.textClass}">${escapeHtml(String(lastActionText))}</span></div>
              ` : ''}

              <div class="tds-section-label tds-employee-subheading" style="margin-top:10px;">Role Summary</div>
              <div class="tds-box tds-box-neutral">${escapeHtml(employeeRoleSummary(employee))}</div>
              <div class="tds-profile-actions">
                <button class="tds-btn" data-inline-employee-tab="training"
                  data-employee-id="${escapeHtml(String(employee.id))}"
                  data-employee-name="${escapeHtml(String(employee.name))}">
                  View in Training
                </button>
                <button class="tds-btn" data-inline-employee-tab="optimize"
                  data-employee-id="${escapeHtml(String(employee.id))}"
                  data-employee-name="${escapeHtml(String(employee.name))}">
                  View in Employee Effectiveness
                </button>
              </div>
            </div>
          </details>`;
      });

      if (employees.length > 15) {
        html += `<div class="tds-box tds-box-neutral" style="margin-top:10px;">Showing the first 15 employees of ${employees.length} returned by the API.</div>`;
      }
      html += '</div>';
    } else {
      html += `<div class="tds-box tds-box-neutral">No employee records could be mapped from the company/employees response. Diagnostics shows the actual response fields so the parser can be extended without displaying raw JSON.</div>`;
    }

    el.innerHTML = html;
    bindEmployeeProfileLinks(panel);
    renderOverviewIntelligence(panel, results).catch((err) =>
      console.warn('[TDS] Overview intelligence render failed:', err)
    );

    if (state.currentDirectorValue !== undefined) {
      refreshDirectorName(panel, state.currentDirectorValue).catch((err) =>
        console.warn('[TDS] Director name refresh failed:', err)
      );
    }

    el.querySelectorAll('[data-inline-employee-tab]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();

        const employee = findEmployeeByIdOrName(
          button.dataset.employeeId,
          button.dataset.employeeName
        );
        if (!employee) return;

        focusEmployeeInTab(
          panel,
          button.dataset.inlineEmployeeTab,
          employee
        );
      });
    });
  }

  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------------------------------------------------------------------
  // 5c. LICENSE CHECK -- Torn User ID against a public GitHub-hosted list.
  //     Fully separate from the Torn API: uses raw.githubusercontent.com,
  //     sends only the numeric User ID (already public within Torn itself),
  //     and never touches the API key or any company data.
  // ---------------------------------------------------------------------
  const LICENSE_GATED_TABS = ['overview', 'finance', 'stock', 'training', 'benchmark', 'optimize'];

  function findOwnUserId(results) {
    const basic = findRaw(results, 'user', 'basic');
    if (!basic) return null;
    const key = Object.keys(basic).find((k) =>
      /^(player_id|user_id|id)$/i.test(k) && (typeof basic[k] === 'number' || typeof basic[k] === 'string'));
    if (!key) return null;
    const n = Number(basic[key]);
    return Number.isFinite(n) ? n : null;
  }

  function fetchLicenseList() {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: LICENSE_JSON_URL,
        timeout: 15000,
        onload: (res) => {
          let parsed;
          try {
            parsed = JSON.parse(res.responseText);
          } catch (e) {
            reject({
              reason: `licensed-users.json is not valid JSON yet. Expected an array like `
                + `[{"userId":4237873,"status":"active"}]. Current content starts with: `
                + `"${String(res.responseText).slice(0, 80)}"`,
            });
            return;
          }
          const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.users) ? parsed.users : null);
          if (!list) {
            reject({ reason: 'licensed-users.json parsed as JSON but isn\u2019t an array of {userId, status} entries yet.' });
            return;
          }
          resolve(list);
        },
        onerror: () => reject({ reason: 'Network error contacting raw.githubusercontent.com' }),
        ontimeout: () => reject({ reason: 'Timed out contacting raw.githubusercontent.com' }),
      });
    });
  }

  function parseLicenseDate(value) {
    if (!value) return null;
    const raw = String(value).trim();
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;

    const ms = Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      0, 0, 0, 0
    );

    return Number.isFinite(ms) ? ms : null;
  }

  function formatLicenseDate(ms) {
    if (!Number.isFinite(ms)) return '\u2014';
    return new Date(ms).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }

  function formatLicenseRemaining(ms) {
    if (!Number.isFinite(ms)) return '\u2014';
    if (ms <= 0) return 'Expired';

    const totalDays = Math.ceil(ms / 86400000);
    const months30 = Math.floor(totalDays / 30);
    const days = totalDays % 30;

    if (months30 > 0 && days > 0) {
      return `${months30} x 30-day month${months30 === 1 ? '' : 's'} + ${days} day${days === 1 ? '' : 's'}`;
    }
    if (months30 > 0) {
      return `${months30} x 30-day month${months30 === 1 ? '' : 's'}`;
    }
    return `${days} day${days === 1 ? '' : 's'}`;
  }

  function evaluateLicenseEntry(entry, now = Date.now()) {
    if (!entry || typeof entry !== 'object') {
      return { status: 'unlicensed', licenseType: null };
    }

    const type = String(entry.licenseType ?? entry.license_type ?? '').trim().toLowerCase();

    if (type === 'perpetual' || type === 'lifetime') {
      return {
        status: 'active',
        licenseType: 'perpetual',
        startsAt: parseLicenseDate(entry.startsAt ?? entry.starts_at),
        expiresAt: null,
        durationDays: null,
      };
    }

    if (type === 'term' || type === 'fixed' || type === 'timed') {
      const startsAt = parseLicenseDate(entry.startsAt ?? entry.starts_at);
      const durationDays = Number(entry.durationDays ?? entry.duration_days);

      if (!Number.isFinite(startsAt) || !Number.isInteger(durationDays) || durationDays <= 0) {
        return {
          status: 'unknown',
          licenseType: 'term',
          startsAt,
          expiresAt: null,
          durationDays: Number.isFinite(durationDays) ? durationDays : null,
          reason: 'Term licence requires startsAt (YYYY-MM-DD) and a positive integer durationDays.',
        };
      }

      const expiresAt = startsAt + (durationDays * 86400000);
      const status = now < startsAt
        ? 'pending'
        : now < expiresAt
          ? 'active'
          : 'expired';

      return {
        status,
        licenseType: 'term',
        startsAt,
        expiresAt,
        durationDays,
      };
    }

    const rawStatus = String(entry.status ?? entry.flag ?? entry.state ?? '').toLowerCase();

    if (rawStatus === 'active' || rawStatus === 'expired') {
      return {
        status: rawStatus,
        licenseType: 'legacy',
        startsAt: null,
        expiresAt: null,
        durationDays: null,
      };
    }

    return {
      status: 'unknown',
      licenseType: type || null,
      reason: 'Licence entry is missing a recognised licenseType or legacy status.',
    };
  }

  function licenseStatusMeta(status) {
    switch (status) {
      case 'active': return { label: 'ACTIVE', cls: 'tds-v-good' };
      case 'expired': return { label: 'EXPIRED', cls: 'tds-v-bad' };
      case 'pending': return { label: 'NOT STARTED', cls: 'tds-v-warn' };
      case 'unlicensed': return { label: 'NOT LICENSED', cls: 'tds-v-bad' };
      default: return { label: 'UNKNOWN', cls: 'tds-v-warn' };
    }
  }

  async function checkLicense(panel, { force = false } = {}) {
    const results = state.lastResults;
    const userId = results ? findOwnUserId(results) : null;

    if (!userId) {
      state.license = {
        status: 'unknown',
        reason: 'Torn User ID not available yet \u2014 run Diagnostics with an API key first (needs user/basic).',
        checkedAt: Date.now(),
        userId: null,
      };
      applyLicenseGate(panel);
      return;
    }

    const cached = GM_getValue(STORAGE_KEY_LICENSE_CACHE, null);
    if (!force && cached && cached.userId === userId && (Date.now() - cached.checkedAt) < LICENSE_CACHE_TTL_MS) {
      state.license = cached;
      applyLicenseGate(panel);
      return;
    }

    try {
      const list = await fetchLicenseList();
      const entry = list.find((row) => Number(row.userId ?? row.user_id ?? row.id) === userId);

      if (!entry) {
        state.license = {
          status: 'unlicensed',
          checkedAt: Date.now(),
          userId,
          source: 'github',
        };
      } else {
        const evaluated = evaluateLicenseEntry(entry, Date.now());
        state.license = {
          ...evaluated,
          checkedAt: Date.now(),
          userId,
          source: 'github',
        };
      }
    } catch (err) {
      state.license = {
        status: 'unknown',
        reason: err.reason || 'License check failed.',
        checkedAt: Date.now(),
        userId,
        source: 'github-error',
      };
    }

    GM_setValue(STORAGE_KEY_LICENSE_CACHE, state.license);
    applyLicenseGate(panel);
  }

  function renderLicenseStatusInSettings(panel) {
    const el = panel.querySelector('[data-tabpanel="settings"]');
    if (!el) return;
    const idEl = el.querySelector('#tds-license-userid');
    const statusEl = el.querySelector('#tds-license-status-value');
    const checkedEl = el.querySelector('#tds-license-checked');
    const typeEl = el.querySelector('#tds-license-type');
    const startedEl = el.querySelector('#tds-license-started');
    const expiresEl = el.querySelector('#tds-license-expires');
    const remainingEl = el.querySelector('#tds-license-remaining');
    const reasonRow = el.querySelector('#tds-license-reason-row');
    const reasonEl = el.querySelector('#tds-license-reason');
    if (!idEl || !statusEl || !checkedEl) return;

    const license = state.license;
    if (!license) {
      idEl.textContent = '\u2014';
      statusEl.textContent = 'Not checked yet';
      statusEl.className = 'tds-row-value tds-v-dim';
      checkedEl.textContent = '\u2014';
      if (typeEl) typeEl.textContent = '\u2014';
      if (startedEl) startedEl.textContent = '\u2014';
      if (expiresEl) expiresEl.textContent = '\u2014';
      if (remainingEl) remainingEl.textContent = '\u2014';
      if (reasonRow) reasonRow.style.display = 'none';
      return;
    }

    idEl.textContent = license.userId ?? '\u2014';
    const meta = licenseStatusMeta(license.status);
    statusEl.textContent = meta.label;
    statusEl.className = `tds-row-value ${meta.cls}`;
    checkedEl.textContent = license.checkedAt ? formatTimestampRelative(license.checkedAt) : '\u2014';

    if (typeEl) {
      typeEl.textContent =
        license.licenseType === 'perpetual'
          ? 'PERPETUAL'
          : license.licenseType === 'term'
            ? `${formatNumber(license.durationDays || 0)} DAY TERM`
            : license.licenseType === 'legacy'
              ? 'LEGACY'
              : '\u2014';
    }

    if (startedEl) {
      startedEl.textContent =
        license.licenseType === 'term' || (license.licenseType === 'perpetual' && license.startsAt)
          ? formatLicenseDate(license.startsAt)
          : '\u2014';
    }

    if (expiresEl) {
      expiresEl.textContent =
        license.licenseType === 'perpetual'
          ? 'Never'
          : license.licenseType === 'term'
            ? formatLicenseDate(license.expiresAt)
            : '\u2014';
    }

    if (remainingEl) {
      remainingEl.textContent =
        license.licenseType === 'perpetual'
          ? 'Perpetual'
          : license.licenseType === 'term'
            ? formatLicenseRemaining((license.expiresAt || 0) - Date.now())
            : '\u2014';
    }

    if (license.reason && reasonRow && reasonEl) {
      reasonRow.style.display = '';
      reasonEl.textContent = license.reason;
    } else if (reasonRow) {
      reasonRow.style.display = 'none';
    }
  }

  function applyLicenseGate(panel) {
    const license = state.license || { status: 'unknown' };
    const active = license.status === 'active';

    LICENSE_GATED_TABS.forEach((tab) => {
      const btn = panel.querySelector(`.tds-tab[data-tab="${tab}"]`);
      if (!btn) return;
      btn.classList.toggle('tds-tab-locked', !active);
      if (!active) btn.title = 'Requires an active license \u2014 see Settings';
      else btn.removeAttribute('title');
    });

    if (!active) {
      const meta = licenseStatusMeta(license.status);
      const msg = `
        <div class="tds-box tds-box-warn">
          <strong>License required.</strong> Status: <span class="${meta.cls}">${meta.label}</span>${license.reason ? ` \u2014 ${escapeHtml(license.reason)}` : ''}.
          Go to Settings for details.
        </div>`;
      LICENSE_GATED_TABS.forEach((tab) => {
        const panelEl = panel.querySelector(`[data-tabpanel="${tab}"]`);
        if (panelEl) panelEl.innerHTML = msg;
      });

      const activeTabBtn = panel.querySelector('.tds-tab-active');
      if (activeTabBtn && LICENSE_GATED_TABS.includes(activeTabBtn.dataset.tab)) {
        switchTab(panel, 'settings');
      }
    }

    renderLicenseStatusInSettings(panel);
  }


  // ---------------------------------------------------------------------
  // 5b. SHARED HELPERS for Finance / Training / Benchmark tabs
  // ---------------------------------------------------------------------
  function findRaw(results, section, selections) {
    const r = results?.find((x) => x.section === section && x.selections === selections && x.status === 'ok');
    return r ? r.raw : null;
  }

  function findBlockedReason(results, section, selections) {
    const r = results?.find((x) => x.section === section && x.selections === selections);
    if (!r || r.status !== 'blocked') return null;
    return `Torn error ${r.code ?? ''}: ${r.reason}`.trim();
  }

  // Normalizes the employee payload into a consistent [{ id, raw, name, position }]
  // shape. Torn responses can arrive as an object keyed by employee ID, an
  // array of [id, employee] pairs, an array of employee objects, or a wrapper
  // object containing an employees collection. Never stringify the payload
  // into the UI as the fallback.
  function extractEmployeesEntries(companyEmployeesRaw) {
    if (!companyEmployeesRaw) return [];

    let list = companyEmployeesRaw;

    if (!Array.isArray(list) && typeof list === 'object') {
      const employeesKey = Object.keys(list).find((k) => /employees?/i.test(k));
      if (employeesKey && list[employeesKey] && typeof list[employeesKey] === 'object') {
        list = list[employeesKey];
      }
    }

    let entries = [];

    if (Array.isArray(list)) {
      // A single Object.entries-style pair: ["3951439", { ...employee... }]
      if (list.length === 2 && (typeof list[0] === 'string' || typeof list[0] === 'number') &&
          list[1] && typeof list[1] === 'object' && !Array.isArray(list[1])) {
        entries = [[list[0], list[1]]];
      } else {
        entries = list.map((value, index) => {
          if (Array.isArray(value) && value.length >= 2 && value[1] && typeof value[1] === 'object') {
            return [value[0], value[1]];
          }
          return [value?.id ?? index, value];
        });
      }
    } else if (typeof list === 'object') {
      // A single employee object: treat it as one entry only if it looks like
      // an employee rather than a wrapper/container.
      const looksLikeEmployee = ['name', 'position', 'days_in_company', 'manual_labor',
        'intelligence', 'endurance', 'effectiveness', 'last_action', 'status']
        .some((key) => Object.prototype.hasOwnProperty.call(list, key));

      entries = looksLikeEmployee
        ? [[list.id ?? 'employee', list]]
        : Object.entries(list);
    }

    return entries
      .filter(([, emp]) => emp && typeof emp === 'object' && !Array.isArray(emp))
      .map(([id, emp]) => ({
        id,
        raw: emp,
        name: emp.name ?? `#${id}`,
        position: emp.position ?? ''
      }));
  }

  function normalizeFieldName(name) {
    return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function findValueDeep(obj, preferredNames) {
    if (!obj || typeof obj !== 'object') return null;
    const wanted = new Set(preferredNames.map(normalizeFieldName));
    const seen = new WeakSet();
    let found = null;

    function walk(value) {
      if (found !== null || !value || typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);

      for (const [key, child] of Object.entries(value)) {
        if (wanted.has(normalizeFieldName(key)) && child !== undefined && child !== null && typeof child !== 'object') {
          found = child;
          return;
        }
      }
      for (const child of Object.values(value)) {
        if (child && typeof child === 'object') walk(child);
        if (found !== null) return;
      }
    }

    walk(obj);
    return found;
  }

  function numericValue(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
    return null;
  }

  function displayValue(value) {
    if (value === undefined || value === null || value === '') return '—';
    if (typeof value === 'number') return formatNumber(value);
    return String(value);
  }

  function companyOverviewRow(label, value, formatter = displayValue) {
    return `<div class="tds-row"><span class="tds-row-label">${escapeHtml(label)}</span><span class="tds-row-value">${escapeHtml(formatter(value))}</span></div>`;
  }

  function humanizeFieldName(name) {
    return String(name || '')
      .replace(/[_-]+/g, ' ')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function collectDisplayFields(raw, options = {}) {
    if (!raw || typeof raw !== 'object') return [];
    const skip = new Set((options.skipObjectKeys || []).map(normalizeFieldName));
    const rows = [];
    const seen = new WeakSet();

    function walk(value, pathParts = [], depth = 0) {
      if (!value || typeof value !== 'object' || seen.has(value) || depth > 5) return;
      seen.add(value);

      for (const [key, child] of Object.entries(value)) {
        const nextPath = [...pathParts, key];
        const path = nextPath.join('.');
        if (child && typeof child === 'object' && !Array.isArray(child)) {
          if (skip.has(normalizeFieldName(key))) continue;
          walk(child, nextPath, depth + 1);
          continue;
        }
        if (Array.isArray(child)) {
          if (skip.has(normalizeFieldName(key))) continue;
          if (child.every((v) => v === null || ['string', 'number', 'boolean'].includes(typeof v))) {
            rows.push({ key, path, label: humanizeFieldName(key), value: child.join(', ') });
          }
          continue;
        }
        if (child === undefined || child === null || child === '') continue;
        rows.push({ key, path, label: humanizeFieldName(key), value: child });
      }
    }

    // Common Torn API wrapper objects should not make labels read like
    // "Company > Name"; recurse into them directly when they are the only
    // meaningful container.
    const keys = Object.keys(raw);
    const wrapperKey = keys.find((k) => /^(company|profile|detailed|details)$/i.test(k) && raw[k] && typeof raw[k] === 'object' && !Array.isArray(raw[k]));
    if (wrapperKey && keys.length <= 3) walk(raw[wrapperKey]);
    else walk(raw);
    return rows;
  }

  function formatCompanyValue(value) {
    if (value === undefined || value === null || value === '') return '—';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'number') return formatNumber(value);
    return String(value);
  }

  function formatCurrency(value) {
    const n = numericValue(value);
    if (n === null) return formatCompanyValue(value);
    return `$${formatNumber(n)}`;
  }

  function formatPercent(value) {
    if (value === undefined || value === null || value === '') return '—';
    const text = String(value).trim();
    if (text.endsWith('%')) return text;
    const n = numericValue(value);
    return n === null ? formatCompanyValue(value) : `${formatNumber(n)}%`;
  }

  function formatCompanyAge(value) {
    const totalDays = numericValue(value);
    if (totalDays === null) return formatCompanyValue(value);

    const days = Math.max(0, Math.floor(totalDays));
    if (days < 365) return `${formatNumber(days)} ${days === 1 ? 'day' : 'days'}`;

    // The API exposes company age as a day count, not a foundation date, so
    // month values here use 30-day company-age months after each 365-day year.
    const years = Math.floor(days / 365);
    const afterYears = days % 365;
    const months = Math.floor(afterYears / 30);
    const remainingDays = afterYears % 30;
    const parts = [`${years} ${years === 1 ? 'year' : 'years'}`];
    if (months) parts.push(`${months} ${months === 1 ? 'month' : 'months'}`);
    if (remainingDays || !months) parts.push(`${remainingDays} ${remainingDays === 1 ? 'day' : 'days'}`);
    return parts.join(', ');
  }

  function formatDirectorName(value, employees, results) {
    let directorId = null;
    let directorName = null;

    if (value && typeof value === 'object') {
      directorName = findValueDeep(value, ['name', 'player_name', 'username']);
      directorId = findValueDeep(value, ['id', 'player_id', 'user_id']);
    } else {
      directorId = value;
    }

    directorId = String(directorId ?? '').trim();
    if (!directorId) return directorName ? String(directorName) : '—';

    if (!directorName) {
      const rosterMatch = (employees || []).find(
        (employee) => String(employee.id) === directorId
      );
      if (rosterMatch?.name && !String(rosterMatch.name).startsWith('#')) {
        directorName = String(rosterMatch.name);
      }
    }

    if (!directorName) {
      const basic = findRaw(results, 'user', 'basic');
      const basicId = basic && findValueDeep(basic, ['player_id', 'user_id', 'id']);
      const basicName = basic && findValueDeep(basic, ['name', 'player_name', 'username']);
      if (
        basicId !== null &&
        String(basicId) === directorId &&
        basicName
      ) {
        directorName = String(basicName);
      }
    }

    if (!directorName) {
      const cached = GM_getValue(STORAGE_KEY_DIRECTOR_NAME_CACHE, null);
      if (
        cached &&
        String(cached.id || '') === directorId &&
        cached.name &&
        Date.now() - Number(cached.timestamp || 0) < 24 * 60 * 60 * 1000
      ) {
        directorName = String(cached.name);
      }
    }

    return directorName
      ? `${directorName} [${directorId}]`
      : directorId;
  }

  async function refreshDirectorName(panel, directorValue) {
    let directorId = directorValue;

    if (directorValue && typeof directorValue === 'object') {
      const existingName = findValueDeep(
        directorValue,
        ['name', 'player_name', 'username']
      );
      const objectId = findValueDeep(
        directorValue,
        ['id', 'player_id', 'user_id']
      );

      if (existingName && objectId !== null) return;
      directorId = objectId;
    }

    directorId = String(directorId ?? '').trim();
    if (!directorId || !/^\d+$/.test(directorId)) return;

    const current = panel.querySelector('#tds-director-value');
    if (!current || /\[\d+\]$/.test(current.textContent || '')) return;

    const cached = GM_getValue(STORAGE_KEY_DIRECTOR_NAME_CACHE, null);
    if (
      cached &&
      String(cached.id || '') === directorId &&
      cached.name &&
      Date.now() - Number(cached.timestamp || 0) < 24 * 60 * 60 * 1000
    ) {
      current.textContent = `${cached.name} [${directorId}]`;
      return;
    }

    try {
      const data = await ApiClient.call('user', 'basic', directorId);
      const name = findValueDeep(data, ['name', 'player_name', 'username']);

      if (!name) return;

      GM_setValue(STORAGE_KEY_DIRECTOR_NAME_CACHE, {
        id: directorId,
        name: String(name),
        timestamp: Date.now(),
      });

      const target = panel.querySelector('#tds-director-value');
      if (target) target.textContent = `${name} [${directorId}]`;
    } catch (err) {
      console.warn('[TDS] Director name lookup unavailable:', err);
    }
  }

  function formatCompanyType(value, results) {
    if (value && typeof value === 'object') {
      const name = findValueDeep(value, ['name', 'type_name', 'company_type_name']);
      const id = findValueDeep(value, ['id', 'type', 'type_id', 'company_type']);
      if (name && id !== null) return `${name} (${id})`;
      if (name) return String(name);
      if (id !== null) value = id;
    }

    const typeId = numericValue(value);
    if (typeId === null) return formatCompanyValue(value);

    const reference = findRaw(results, 'torn', 'companies');
    const typeName = resolveCompanyTypeName(reference, typeId);
    return typeName ? `${typeName} (${typeId})` : String(typeId);
  }

  function resolveCompanyTypeName(raw, typeId) {
    if (!raw || typeof raw !== 'object') return null;
    const wanted = String(typeId);
    const seen = new WeakSet();
    let found = null;

    function walk(value) {
      if (found || !value || typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);

      if (!Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, wanted)) {
        const candidate = value[wanted];
        if (candidate && typeof candidate === 'object') {
          const name = findValueDeep(candidate, ['name', 'company_name', 'type_name']);
          if (name) {
            found = String(name);
            return;
          }
        } else if (typeof candidate === 'string') {
          found = candidate;
          return;
        }
      }

      for (const child of Object.values(value)) {
        if (!child || typeof child !== 'object') continue;
        const id = findValueDeep(child, ['id', 'type_id', 'company_type']);
        if (id !== null && String(id) === wanted) {
          const name = findValueDeep(child, ['name', 'company_name', 'type_name']);
          if (name) {
            found = String(name);
            return;
          }
        }
      }

      for (const child of Object.values(value)) {
        if (child && typeof child === 'object') walk(child);
        if (found) return;
      }
    }

    walk(raw);
    return found;
  }

  function findNestedObject(obj, keyPattern) {
    if (!obj || typeof obj !== 'object') return null;
    if (Object.keys(obj).some((k) => keyPattern.test(k))) return obj;
    return null;
  }

  function formatNumber(n) {
    if (typeof n !== 'number' || Number.isNaN(n)) return '—';
    return n.toLocaleString('en-GB');
  }

  function formatTimestampRelative(ts) {
    if (!ts) return '—';
    const seconds = Math.max(0, Math.floor((Date.now() - Number(ts)) / 1000));
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h ago`;
  }

  // Looks for a wage/salary-shaped numeric field on an employee object
  // without assuming its exact name — flags what it found so the UI can
  // label it EXACT (real field) rather than a guess.
  function findWageField(emp) {
    if (!emp || typeof emp !== 'object') return null;
    const key = Object.keys(emp).find((k) => /wage|salary/i.test(k) && typeof emp[k] === 'number');
    return key ? { key, value: emp[key] } : null;
  }

  function getEmployeeEffectiveness(emp) {
    if (!emp || typeof emp !== 'object') return null;

    // Current Torn company/employees responses expose effectiveness as an
    // object. Read every explicit component Torn supplies. EE merits are read
    // from the employee effectiveness breakdown only; they are never inferred
    // from Total EE because other adjustments can also affect that total.
    const raw = emp.effectiveness;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const total = numericValue(raw.total);
      const merits = numericValue(
        findValueDeep(raw, [
          'merits',
          'merit',
          'employee_effectiveness_merits',
          'employee_effectiveness_merit',
          'ee_merits',
          'effectiveness_merits'
        ])
      );
      return {
        source: 'effectiveness',
        workingStats: numericValue(raw.working_stats),
        settledIn: numericValue(raw.settled_in),
        directorEducation: numericValue(raw.director_education),
        merits,
        addiction: numericValue(raw.addiction),
        total,
      };
    }

    // Backwards compatibility for older/alternate response shapes where EE
    // may be returned as a single numeric field.
    const key = Object.keys(emp).find((k) => /effectiveness|^ee$/i.test(k) && typeof emp[k] === 'number');
    if (!key) return null;
    return {
      source: key,
      workingStats: null,
      settledIn: null,
      directorEducation: null,
      merits: null,
      addiction: null,
      total: emp[key],
    };
  }

  function findEffectivenessField(emp) {
    const ee = getEmployeeEffectiveness(emp);
    return ee && typeof ee.total === 'number' ? { key: ee.source, value: ee.total } : null;
  }

  function getEmployeeEEMerits(emp) {
    const ee = getEmployeeEffectiveness(emp);
    return ee && typeof ee.merits === 'number' ? ee.merits : null;
  }

  function formatEEMerits(emp) {
    const merits = getEmployeeEEMerits(emp);
    return merits !== null ? formatNumber(merits) : '—';
  }

  function formatMoney(n) {
    if (typeof n !== 'number' || Number.isNaN(n)) return '—';
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
    if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
    return `${sign}$${abs.toFixed(0)}`;
  }

  function dayKey(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }

  function isoDayKey(ts) {
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  async function getSnapshotsSorted() {
    const all = await LocalDB.getAll('snapshots');
    return all.sort((a, b) => a.timestamp - b.timestamp);
  }

  // One entry per distinct local calendar day, keeping the LAST snapshot
  // taken that day (freshest read for that day). This is purely local,
  // locally-timestamped data — never backfilled or invented for days
  // before you started running the diagnostic.
  function collapseToDaily(snapshots) {
    const byDay = new Map();
    for (const snap of snapshots) byDay.set(dayKey(snap.timestamp), snap); // later overwrites earlier same-day
    return [...byDay.values()].sort((a, b) => a.timestamp - b.timestamp);
  }

  // -----------------------------------------------------------------------
  // COMPANY PERFORMANCE HISTORY
  // -----------------------------------------------------------------------
  function firstNumericDeep(obj, names) {
    for (const name of names) {
      const value = numericValue(findValueDeep(obj, [name]));
      if (value !== null) return value;
    }
    return null;
  }

  function performanceRoleSummary(employeesRaw) {
    const employees = extractEmployeesEntries(employeesRaw);
    const roleEE = {};
    const roleHeadcount = {};
    let totalEE = 0;
    let employeesWithEE = 0;

    for (const employee of employees) {
      const role = String(employee.position || 'Unassigned');
      const ee = getEmployeeEffectiveness(employee.raw);
      const total = typeof ee?.total === 'number' ? ee.total : null;

      roleHeadcount[role] = (roleHeadcount[role] || 0) + 1;

      if (total !== null) {
        roleEE[role] = (roleEE[role] || 0) + total;
        totalEE += total;
        employeesWithEE += 1;
      }
    }

    return {
      employeeCount: employees.length,
      employeesWithEE,
      totalEE,
      roleEE,
      roleHeadcount,
    };
  }

  function salesCapacityFromRoleEE(roleEE) {
    let total = 0;
    let matched = 0;

    for (const [role, value] of Object.entries(roleEE || {})) {
      if (!/\b(sales?|seller|cashier|retail)\b/i.test(String(role))) continue;
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      total += value;
      matched += 1;
    }

    return matched ? total : null;
  }

  function buildPerformanceRecord(profile, detailed, employeesRaw, timestamp = Date.now()) {
    const combined = { ...(profile || {}), ...(detailed || {}) };
    const roles = performanceRoleSummary(employeesRaw);

    return {
      day: isoDayKey(timestamp),
      timestamp,
      source: 'local',
      observed: {
        dailyIncome: firstNumericDeep(combined, ['daily_income', 'dailyIncome']),
        weeklyIncome: firstNumericDeep(combined, ['weekly_income', 'weeklyIncome']),
        dailyCustomers: firstNumericDeep(combined, ['daily_customers', 'dailyCustomers']),
        weeklyCustomers: firstNumericDeep(combined, ['weekly_customers', 'weeklyCustomers']),
        popularity: firstNumericDeep(combined, ['popularity']),
        efficiency: firstNumericDeep(combined, ['efficiency']),
        environment: firstNumericDeep(combined, ['environment']),
        employeeCount: roles.employeeCount,
      },
      calculated: {
        totalEE: roles.employeesWithEE ? roles.totalEE : null,
        salesEE: salesCapacityFromRoleEE(roles.roleEE),
        roleEE: roles.roleEE,
        roleHeadcount: roles.roleHeadcount,
      },
    };
  }

  function performanceRecordFromResults(results, timestamp = Date.now()) {
    if (!results) return null;

    return buildPerformanceRecord(
      findRaw(results, 'company', 'profile'),
      findRaw(results, 'company', 'detailed'),
      findRaw(results, 'company', 'employees'),
      timestamp
    );
  }

  function performanceRecordFromSnapshot(snapshot) {
    if (!snapshot) return null;

    if (snapshot.performance && snapshot.performance.observed) {
      return snapshot.performance;
    }

    return buildPerformanceRecord(
      snapshot.company_profile,
      snapshot.company_detailed,
      snapshot.company_employees,
      snapshot.timestamp
    );
  }

  function mergeDefinedFields(base, incoming) {
    const merged = { ...(base || {}) };

    for (const [key, value] of Object.entries(incoming || {})) {
      if (value === null || value === undefined) continue;
      merged[key] = value;
    }

    return merged;
  }

  async function getDailyPerformanceHistory() {
    const compact = await LocalDB.getAll('performance');

    // Migrate/use legacy raw snapshots too, so existing users do not lose the
    // history they already collected before the compact store was introduced.
    const snapshots = await getSnapshotsSorted();
    const legacy = collapseToDaily(snapshots)
      .map(performanceRecordFromSnapshot)
      .filter(Boolean);

    const byDay = new Map();

    for (const record of legacy) {
      const day = record.day || isoDayKey(record.timestamp);
      byDay.set(day, {
        ...record,
        day,
        source: record.source || 'local',
      });
    }

    // Compact records win because they can include Torn historical backfill.
    for (const record of compact) {
      if (!record?.day) continue;

      const existing = byDay.get(record.day);
      if (!existing) {
        byDay.set(record.day, record);
        continue;
      }

      byDay.set(record.day, {
        ...existing,
        ...record,
        observed: mergeDefinedFields(
          existing.observed,
          record.observed
        ),
        calculated: mergeDefinedFields(
          existing.calculated,
          record.calculated
        ),
      });
    }

    return [...byDay.values()]
      .filter((record) => {
        const observed = record.observed || {};
        const calculated = record.calculated || {};
        return [
          observed.dailyIncome,
          observed.dailyCustomers,
          observed.weeklyIncome,
          observed.weeklyCustomers,
          calculated.totalEE,
          calculated.salesEE,
        ].some((value) => typeof value === 'number');
      })
      .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
  }

  async function saveCompactPerformanceRecord(record) {
    if (!record) return;

    const day = record.day || isoDayKey(record.timestamp || Date.now());
    const existing = (await LocalDB.getAll('performance')).find((row) => row.day === day);

    const merged = {
      ...(existing || {}),
      ...record,
      day,
      observed: mergeDefinedFields(
        existing?.observed,
        record.observed
      ),
      calculated: mergeDefinedFields(
        existing?.calculated,
        record.calculated
      ),
    };

    await LocalDB.put('performance', merged);
    await prunePerformanceHistory();
  }


  function snapshotTimestampForDaysAgo(daysAgo) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - daysAgo);
    return Math.floor(d.getTime() / 1000);
  }

  function buildBackfillTargetDays(historyDays = 30) {
    const targets = [];

    // Newest -> oldest. If we only know the company name, matching a recent
    // snapshot first lets us discover the real company ID and then use that ID
    // for older dates, even if the company name changed historically.
    for (let daysAgo = 0; daysAgo < historyDays; daysAgo += 1) {
      const timestampSeconds = snapshotTimestampForDaysAgo(daysAgo);
      const timestampMs = timestampSeconds * 1000;

      targets.push({
        daysAgo,
        day: isoDayKey(timestampMs),
        timestampSeconds,
        timestampMs,
      });
    }

    return targets;
  }

  function performanceRecordHasFinancials(record) {
    if (!record) return false;

    const observed = record.observed || {};

    return [
      observed.dailyIncome,
      observed.weeklyIncome,
      observed.dailyCustomers,
      observed.weeklyCustomers,
    ].some((value) => typeof value === 'number' && Number.isFinite(value));
  }

  function analyseBackfillCoverage(history, historyDays = 30) {
    const targets = buildBackfillTargetDays(historyDays);
    const byDay = new Map(
      (history || []).map((record) => [
        record.day || isoDayKey(record.timestamp),
        record,
      ])
    );

    const stored = [];
    const missing = [];

    for (const target of targets) {
      const record = byDay.get(target.day);

      if (record && performanceRecordHasFinancials(record)) {
        stored.push({ ...target, record });
      } else {
        missing.push(target);
      }
    }

    const coveredRecords = stored
      .map((item) => item.record)
      .filter(Boolean)
      .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));

    return {
      historyDays,
      targets,
      stored,
      missing,
      storedCount: stored.length,
      missingCount: missing.length,
      oldest:
        coveredRecords.length
          ? coveredRecords[0]
          : null,
      newest:
        coveredRecords.length
          ? coveredRecords[coveredRecords.length - 1]
          : null,
    };
  }

  async function backfillCompanyPerformanceHistory(
    companyIdentity,
    targetDays,
    onProgress = null
  ) {
    let resolvedCompanyId = companyIdentity?.id ?? null;
    const companyName = String(companyIdentity?.name || '').trim();

    if ((resolvedCompanyId === null || resolvedCompanyId === undefined) && !companyName) {
      throw new Error('Company ID and company name are both unavailable.');
    }

    const targets = Array.isArray(targetDays)
      ? [...targetDays]
      : buildBackfillTargetDays(30);

    // Always newest -> oldest so an exact-name match can discover the actual
    // company ID before we inspect older snapshots.
    targets.sort(
      (a, b) => Number(b.timestampMs || 0) - Number(a.timestampMs || 0)
    );

    let saved = 0;
    let unavailable = 0;
    let errors = 0;
    let matchedByName = 0;
    let matchedById = 0;
    const errorDetails = [];

    if (!targets.length) {
      onProgress?.({
        day: null,
        complete: 0,
        total: 0,
      });

      return {
        saved,
        unavailable,
        errors,
        errorDetails,
        requested: 0,
        matchedByName,
        matchedById,
        resolvedCompanyId,
      };
    }

    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index];
      const {
        timestampSeconds,
        timestampMs,
        day,
      } = target;

      onProgress?.({
        day,
        complete: index,
        total: targets.length,
      });

      try {
        const csv = await ApiClient.callV2Text('company/snapshot', {
          timestamp: timestampSeconds,
        });

        const map = buildSnapshotFinancialMap(csv);

        let row =
          resolvedCompanyId !== null && resolvedCompanyId !== undefined
            ? map.get(String(resolvedCompanyId))
            : null;

        let matchedBy = row ? 'id' : null;

        if (!row && companyName) {
          const wanted = normalizeFieldName(companyName);

          const matches = [...map.values()].filter((candidate) =>
            candidate?.name &&
            normalizeFieldName(candidate.name) === wanted
          );

          if (matches.length === 1) {
            row = matches[0];
            matchedBy = 'name';

            // Once the exact current company name identifies one company,
            // remember its ID and use that ID for all older snapshots.
            if (
              resolvedCompanyId === null ||
              resolvedCompanyId === undefined
            ) {
              resolvedCompanyId = row.id;
              console.log(
                '[TDS] Historical backfill resolved company ID from snapshot:',
                resolvedCompanyId
              );
            }
          } else if (matches.length > 1) {
            throw new Error(
              `Multiple snapshot companies matched the exact name "${companyName}". Refusing to guess.`
            );
          }
        }

        if (!row) {
          unavailable += 1;

          console.warn(
            '[TDS] Backfill snapshot did not contain company',
            {
              resolvedCompanyId,
              companyName,
              day,
            }
          );

          continue;
        }

        if (matchedBy === 'name') matchedByName += 1;
        if (matchedBy === 'id') matchedById += 1;

        console.log(
          '[TDS] Backfill snapshot company match',
          {
            day,
            matchedBy,
            id: row.id,
            name: row.name,
          }
        );

        await saveCompactPerformanceRecord({
          day,
          timestamp: timestampMs,
          source: 'torn_snapshot',
          observed: {
            dailyIncome: row.dailyIncome,
            weeklyIncome: row.weeklyIncome,
            dailyCustomers: row.dailyCustomers,
            weeklyCustomers: row.weeklyCustomers,
          },
          calculated: {
            totalEE: null,
            salesEE: null,
            roleEE: null,
            roleHeadcount: null,
          },
        });

        saved += 1;
      } catch (err) {
        errors += 1;

        const reason = String(
          err?.reason ??
          err?.message ??
          err ??
          'Unknown error'
        );

        errorDetails.push({
          day,
          reason,
        });

        console.error(
          '[TDS] Historical backfill error',
          {
            day,
            reason,
            error: err,
          }
        );
      }
    }

    onProgress?.({
      day: null,
      complete: targets.length,
      total: targets.length,
    });

    return {
      saved,
      unavailable,
      errors,
      errorDetails,
      requested: targets.length,
      matchedByName,
      matchedById,
      resolvedCompanyId,
    };
  }

  function pearsonCorrelation(pairs) {
    const rows = pairs.filter(
      (pair) =>
        Array.isArray(pair) &&
        pair.length === 2 &&
        typeof pair[0] === 'number' &&
        Number.isFinite(pair[0]) &&
        typeof pair[1] === 'number' &&
        Number.isFinite(pair[1])
    );

    if (rows.length < 3) return null;

    const xs = rows.map((row) => row[0]);
    const ys = rows.map((row) => row[1]);
    const avgX = xs.reduce((sum, value) => sum + value, 0) / xs.length;
    const avgY = ys.reduce((sum, value) => sum + value, 0) / ys.length;

    let numerator = 0;
    let xSq = 0;
    let ySq = 0;

    for (let i = 0; i < rows.length; i += 1) {
      const dx = xs[i] - avgX;
      const dy = ys[i] - avgY;
      numerator += dx * dy;
      xSq += dx * dx;
      ySq += dy * dy;
    }

    if (xSq <= 0 || ySq <= 0) return null;
    return numerator / Math.sqrt(xSq * ySq);
  }

  function correlationLabel(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'Insufficient variation/data';

    const abs = Math.abs(value);
    const strength =
      abs >= 0.75
        ? 'Strong'
        : abs >= 0.5
          ? 'Moderate'
          : abs >= 0.25
            ? 'Weak'
            : 'Very weak';

    return `${strength} ${value >= 0 ? 'positive' : 'negative'} (${value.toFixed(2)})`;
  }

  function performanceConfidence(historyLength) {
    if (historyLength >= 14) return 'Medium';
    if (historyLength >= 7) return 'Low–Medium';
    return 'Low';
  }

  function historyExtrema(history, getter) {
    const values = history
      .map((row) => getter(row))
      .filter((value) => typeof value === 'number' && Number.isFinite(value));

    if (!values.length) return { min: null, max: null };

    return {
      min: Math.min(...values),
      max: Math.max(...values),
    };
  }

  function extremaClass(value, extrema) {
    if (typeof value !== 'number' || !extrema) return '';

    if (
      extrema.max !== null &&
      extrema.min !== null &&
      extrema.max !== extrema.min &&
      value === extrema.max
    ) {
      return 'tds-v-good tds-history-high';
    }

    if (
      extrema.max !== null &&
      extrema.min !== null &&
      extrema.max !== extrema.min &&
      value === extrema.min
    ) {
      return 'tds-v-bad tds-history-low';
    }

    return '';
  }

  function formatPerformanceDate(timestamp) {
    const d = new Date(timestamp);
    return d.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
    });
  }

  function medianNumeric(values) {
    const nums = values
      .filter((value) => typeof value === 'number' && Number.isFinite(value))
      .sort((a, b) => a - b);

    if (!nums.length) return null;

    const mid = Math.floor(nums.length / 2);
    return nums.length % 2
      ? nums[mid]
      : (nums[mid - 1] + nums[mid]) / 2;
  }

  function analyseSalesEEPerformance(history) {
    const paired = (history || []).filter((row) =>
      typeof row.calculated?.salesEE === 'number' &&
      Number.isFinite(row.calculated.salesEE) &&
      typeof row.observed?.dailyCustomers === 'number' &&
      Number.isFinite(row.observed.dailyCustomers) &&
      typeof row.observed?.dailyIncome === 'number' &&
      Number.isFinite(row.observed.dailyIncome)
    );

    const uniqueSalesEE = new Set(
      paired.map((row) => Math.round(row.calculated.salesEE))
    );

    const salesValues = paired.map((row) => row.calculated.salesEE);
    const minSalesEE = salesValues.length ? Math.min(...salesValues) : null;
    const maxSalesEE = salesValues.length ? Math.max(...salesValues) : null;
    const variationRatio =
      minSalesEE !== null &&
      maxSalesEE !== null &&
      maxSalesEE > 0
        ? (maxSalesEE - minSalesEE) / maxSalesEE
        : 0;

    const customerCorrelation = pearsonCorrelation(
      paired.map((row) => [
        row.calculated.salesEE,
        row.observed.dailyCustomers,
      ])
    );

    const incomeCorrelation = pearsonCorrelation(
      paired.map((row) => [
        row.calculated.salesEE,
        row.observed.dailyIncome,
      ])
    );

    const medianCustomers = medianNumeric(
      paired.map((row) => row.observed.dailyCustomers)
    );

    const medianIncome = medianNumeric(
      paired.map((row) => row.observed.dailyIncome)
    );

    // "Healthy outcome" is deliberately broad: both customers and income
    // must be at least 90% of this company's median for the paired sample.
    // This is not a Torn formula; it is used only to identify historically
    // observed lower-EE days that did not coincide with a large outcome drop.
    const healthyRows =
      medianCustomers !== null && medianIncome !== null
        ? paired.filter((row) =>
            row.observed.dailyCustomers >= medianCustomers * 0.90 &&
            row.observed.dailyIncome >= medianIncome * 0.90
          )
        : [];

    const latest = paired.length ? paired[paired.length - 1] : null;
    const latestSalesEE = latest?.calculated?.salesEE ?? null;

    let adaptiveFloor = CORE_CAPACITY_RETAIN_RATIO;
    let adaptive = false;
    let reason =
      'Default 85% Core-role EE safety floor retained because there is not enough paired performance evidence yet.';

    // Require at least a week of paired observations, meaningful EE variation,
    // and at least three healthy comparison days before changing the floor.
    if (
      paired.length >= 7 &&
      uniqueSalesEE.size >= 3 &&
      variationRatio >= 0.05 &&
      healthyRows.length >= 3 &&
      typeof latestSalesEE === 'number' &&
      latestSalesEE > 0
    ) {
      const healthySalesEE = healthyRows
        .map((row) => row.calculated.salesEE)
        .filter((value) => typeof value === 'number' && Number.isFinite(value));

      const observedHealthyMinimum = Math.min(...healthySalesEE);
      const observedRatio = observedHealthyMinimum / latestSalesEE;

      // Never allow history alone to make the optimiser extremely aggressive.
      // Evidence may adjust Core protection only within 80%-95%.
      adaptiveFloor = Math.max(
        0.80,
        Math.min(0.95, observedRatio)
      );

      // Avoid changing the displayed/used floor for tiny differences.
      if (Math.abs(adaptiveFloor - CORE_CAPACITY_RETAIN_RATIO) >= 0.02) {
        adaptive = true;
        reason =
          `Evidence-informed floor based on the lowest observed Sales EE level that still coincided with at least 90% of median customers and income.`;
      } else {
        adaptiveFloor = CORE_CAPACITY_RETAIN_RATIO;
        reason =
          'Historical evidence is broadly consistent with the existing 85% safety floor, so no adjustment was made.';
      }
    }

    return {
      pairedCount: paired.length,
      uniqueSalesEECount: uniqueSalesEE.size,
      variationRatio,
      customerCorrelation,
      incomeCorrelation,
      medianCustomers,
      medianIncome,
      healthyCount: healthyRows.length,
      latestSalesEE,
      minSalesEE,
      maxSalesEE,
      adaptiveFloor,
      adaptive,
      reason,
    };
  }

  function adaptiveEvidenceConfidence(analysis) {
    if (!analysis) return 'LOW';

    if (
      analysis.pairedCount >= 21 &&
      analysis.uniqueSalesEECount >= 5 &&
      analysis.variationRatio >= 0.10
    ) {
      return 'HIGHER';
    }

    if (
      analysis.pairedCount >= 14 &&
      analysis.uniqueSalesEECount >= 4 &&
      analysis.variationRatio >= 0.07
    ) {
      return 'MEDIUM';
    }

    if (
      analysis.pairedCount >= 7 &&
      analysis.uniqueSalesEECount >= 3 &&
      analysis.variationRatio >= 0.05
    ) {
      return 'LOW-MEDIUM';
    }

    return 'LOW';
  }

  async function renderOptimizerPerformanceEvidence(container) {
    const target = container.querySelector('#tds-performance-evidence');
    if (!target) return;

    try {
      const history = await getDailyPerformanceHistory();

      if (!history.length) {
        target.innerHTML = `<div class="tds-box tds-box-neutral">
          No local performance history yet. Run Diagnostics on future days to build observations.
        </div>`;
        return;
      }

      const latest = history[history.length - 1];

      const eeHistory = history.filter(
        (row) =>
          typeof row.calculated?.salesEE === 'number' &&
          Number.isFinite(row.calculated.salesEE)
      );

      const latestEE =
        eeHistory.length
          ? eeHistory[eeHistory.length - 1]
          : null;

      const previousEE =
        eeHistory.length > 1
          ? eeHistory[eeHistory.length - 2]
          : null;

      const adaptiveAnalysis = analyseSalesEEPerformance(history);
      const customerCorrelation = adaptiveAnalysis.customerCorrelation;
      const incomeCorrelation = adaptiveAnalysis.incomeCorrelation;

      let html = `<div class="tds-box tds-box-info">
        <strong>Performance evidence:</strong>
        ${formatNumber(history.length)} total local/history observation${history.length === 1 ? '' : 's'} available.
        ${formatNumber(adaptiveAnalysis.pairedCount)} day${adaptiveAnalysis.pairedCount === 1 ? '' : 's'} contain both Sales EE and real income/customer outcomes.
        Evidence confidence: <strong>${escapeHtml(adaptiveEvidenceConfidence(adaptiveAnalysis))}</strong>.
        Correlations are observational only and do not prove cause/effect.
      </div>`;

      html += `<div class="tds-card">
        <div class="tds-row">
          <span class="tds-row-label">Latest Sales EE capacity</span>
          <span class="tds-row-value">${
            latestEE
              ? `${formatNumber(Math.round(latestEE.calculated.salesEE))} EE points · ${escapeHtml(formatPerformanceDate(latestEE.timestamp))}`
              : 'No locally recorded Sales EE yet'
          }</span>
        </div>
        <div class="tds-row"><span class="tds-row-label">Latest daily customers</span><span class="tds-row-value">${typeof latest.observed?.dailyCustomers === 'number' ? formatNumber(latest.observed.dailyCustomers) : '—'}</span></div>
        <div class="tds-row"><span class="tds-row-label">Latest daily income</span><span class="tds-row-value">${typeof latest.observed?.dailyIncome === 'number' ? formatMoney(latest.observed.dailyIncome) : '—'}</span></div>
        <div class="tds-row"><span class="tds-row-label">Sales EE ↔ daily customers</span><span class="tds-row-value">${escapeHtml(correlationLabel(customerCorrelation))}</span></div>
        <div class="tds-row"><span class="tds-row-label">Sales EE ↔ daily income</span><span class="tds-row-value">${escapeHtml(correlationLabel(incomeCorrelation))}</span></div>
      </div>`;

      html += `<div class="tds-section-label">Adaptive EE impact assessment</div>
        <div class="tds-card">
          <div class="tds-row">
            <span class="tds-row-label">Paired EE + performance days</span>
            <span class="tds-row-value">${formatNumber(adaptiveAnalysis.pairedCount)}</span>
          </div>
          <div class="tds-row">
            <span class="tds-row-label">Distinct Sales EE levels observed</span>
            <span class="tds-row-value">${formatNumber(adaptiveAnalysis.uniqueSalesEECount)}</span>
          </div>
          <div class="tds-row">
            <span class="tds-row-label">Observed Sales EE range</span>
            <span class="tds-row-value">${
              typeof adaptiveAnalysis.minSalesEE === 'number' &&
              typeof adaptiveAnalysis.maxSalesEE === 'number'
                ? `${formatNumber(Math.round(adaptiveAnalysis.minSalesEE))} → ${formatNumber(Math.round(adaptiveAnalysis.maxSalesEE))} EE points`
                : '—'
            }</span>
          </div>
          <div class="tds-row">
            <span class="tds-row-label">Sales EE variation</span>
            <span class="tds-row-value">${(adaptiveAnalysis.variationRatio * 100).toFixed(1)}%</span>
          </div>
          <div class="tds-row">
            <span class="tds-row-label">Core-role safety floor</span>
            <span class="tds-row-value ${adaptiveAnalysis.adaptive ? 'tds-v-good' : ''}">
              <strong>${(adaptiveAnalysis.adaptiveFloor * 100).toFixed(0)}%</strong>
              ${adaptiveAnalysis.adaptive ? ' · evidence-informed' : ' · default'}
            </span>
          </div>
        </div>
        <div class="tds-box ${adaptiveAnalysis.adaptive ? 'tds-box-info' : 'tds-box-neutral'}" style="margin-top:8px;">
          ${escapeHtml(adaptiveAnalysis.reason)}
        </div>`;

      if (latestEE && previousEE) {
        const salesDelta =
          latestEE.calculated.salesEE -
          previousEE.calculated.salesEE;

        const customerDelta =
          typeof latestEE.observed?.dailyCustomers === 'number' &&
          typeof previousEE.observed?.dailyCustomers === 'number'
            ? latestEE.observed.dailyCustomers - previousEE.observed.dailyCustomers
            : null;

        const incomeDelta =
          typeof latestEE.observed?.dailyIncome === 'number' &&
          typeof previousEE.observed?.dailyIncome === 'number'
            ? latestEE.observed.dailyIncome - previousEE.observed.dailyIncome
            : null;

        html += `<div class="tds-section-label">Latest observed change</div>
        <div class="tds-box tds-box-neutral">
          Comparing the two most recent days that actually contain locally recorded Sales EE:
          <strong>${escapeHtml(formatPerformanceDate(previousEE.timestamp))}</strong> → <strong>${escapeHtml(formatPerformanceDate(latestEE.timestamp))}</strong>.
        </div>
        <div class="tds-card">
          <div class="tds-row"><span class="tds-row-label">Sales EE capacity</span><span class="tds-row-value">${salesDelta > 0 ? '+' : ''}${formatNumber(Math.round(salesDelta))} EE points</span></div>
          <div class="tds-row"><span class="tds-row-label">Daily customers</span><span class="tds-row-value">${customerDelta === null ? '—' : `${customerDelta > 0 ? '+' : ''}${formatNumber(customerDelta)}`}</span></div>
          <div class="tds-row"><span class="tds-row-label">Daily income</span><span class="tds-row-value">${incomeDelta === null ? '—' : `${incomeDelta > 0 ? '+' : ''}${formatMoney(incomeDelta)}`}</span></div>
        </div>`;
      } else {
        html += `<div class="tds-section-label">Latest observed change</div>
          <div class="tds-box tds-box-neutral">
            ${latestEE
              ? `Only one day currently contains Sales EE (${escapeHtml(formatPerformanceDate(latestEE.timestamp))}). A change can be calculated after a second EE-bearing daily observation is stored.`
              : 'No daily observations currently contain Sales EE. Run Diagnostics with employee data available to create the first EE-bearing observation.'}
          </div>`;
      }

      html += `<div class="tds-box tds-box-neutral" style="margin-top:10px;">
        <strong>Observed:</strong> income, customers and company values returned by Torn.<br>
        <strong>Calculated:</strong> Total EE and role EE capacity computed from the roster.<br>
        <strong>Estimated:</strong> optimiser recommendations and capacity floors; these are management heuristics.
      </div>`;

      target.innerHTML = html;
    } catch (err) {
      target.innerHTML = `<div class="tds-box tds-box-warn">
        Local performance history could not be read: ${escapeHtml(String(err?.message || err || 'Unknown error'))}
      </div>`;
    }
  }

  // =======================================================================
  // FINANCE TAB
  // =======================================================================
  async function renderFinanceTab(panel) {
    const el = panel.querySelector('[data-tabpanel="finance"]');
    const results = state.lastResults;
    if (!results) {
      el.innerHTML = `<div class="tds-box tds-box-neutral">Run the diagnostic first (Overview tab or the \u27f3 button) \u2014 Finance reads from that data plus your local snapshot history.</div>`;
      return;
    }
    if (!isDirectorAccess()) {
      el.innerHTML = directorFeatureNotice('Company Financials');
      return;
    }


    const profile = findRaw(results, 'company', 'profile');
    const detailed = findRaw(results, 'company', 'detailed');
    const employeesRaw = findRaw(results, 'company', 'employees');
    const blockedProfile = findBlockedReason(results, 'company', 'profile');
    const blockedDetailed = findBlockedReason(results, 'company', 'detailed');

    let html = '';

    if (!profile && !detailed) {
      html += `<div class="tds-box tds-box-danger"><strong>Company profile unavailable.</strong> ${blockedProfile || 'No data returned.'} Finance needs at least this to show anything.</div>`;
      el.innerHTML = html;
      return;
    }

    // Torn refactored the company API in 2026. The current company/profile
    // response can contain the former detailed data, and income fields are
    // normally named daily_income / weekly_income. Search recursively so the
    // Finance tab works with both legacy and wrapped response shapes.
    const combined = { ...(profile || {}), ...(detailed || {}) };

    function findNumericFieldDeep(obj, preferredNames, fallbackPattern) {
      const preferred = new Set(preferredNames.map((name) => name.toLowerCase()));
      const seen = new WeakSet();
      let fallback = null;
      function walk(value, path = '') {
        if (!value || typeof value !== 'object' || seen.has(value)) return null;
        seen.add(value);
        for (const [key, child] of Object.entries(value)) {
          const currentPath = path ? `${path}.${key}` : key;
          if (typeof child === 'number' && Number.isFinite(child)) {
            const lower = key.toLowerCase();
            if (preferred.has(lower)) return { key, value: child, path: currentPath };
            if (!fallback && fallbackPattern.test(key)) fallback = { key, value: child, path: currentPath };
          } else if (child && typeof child === 'object') {
            const found = walk(child, currentPath);
            if (found && preferred.has(found.key.toLowerCase())) return found;
          }
        }
        return null;
      }
      return walk(obj) || fallback;
    }

    const dailyField = findNumericFieldDeep(combined, ['daily_income', 'daily_profit'], /daily[_ ]?(income|profit)/i);
    const weeklyField = findNumericFieldDeep(combined, ['weekly_income', 'weekly_profit'], /weekly[_ ]?(income|profit)/i);

    const employees = extractEmployeesEntries(employeesRaw);
    const wageFields = employees.map((e) => findWageField(e.raw)).filter(Boolean);
    let totalSalary = wageFields.length > 0 ? wageFields.reduce((sum, w) => sum + w.value, 0) : null;
    let salaryFieldName = wageFields[0]?.key;
    // Fallback: some responses may only expose an aggregate wage/salary
    // figure at the company level rather than per employee.
    if (totalSalary === null) {
      const aggregateWage = Object.entries(combined).find(([k, v]) => typeof v === 'number' && /wage|salar/i.test(k));
      if (aggregateWage) {
        totalSalary = aggregateWage[1];
        salaryFieldName = aggregateWage[0];
      }
    }

    const todayGross = dailyField ? dailyField.value : null;
    const todayNet = todayGross !== null && totalSalary !== null ? todayGross - totalSalary : null;

    // --- Today snapshot card ---
    html += '<div class="tds-section-label">Today</div><div class="tds-card">';
    html += `<div class="tds-row"><span class="tds-row-label">Daily Income</span><span class="tds-row-value">${todayGross !== null ? formatMoney(todayGross) : '<span class="tds-v-dim">Unavailable</span>'}</span></div>`;
    html += `<div class="tds-row"><span class="tds-row-label">Salaries</span><span class="tds-row-value tds-v-bad">${totalSalary !== null ? '-' + formatMoney(totalSalary) : '<span class="tds-v-dim">Unavailable</span>'}</span></div>`;
    html += `<div class="tds-row"><span class="tds-row-label">Income after Salaries</span><span class="tds-row-value ${todayNet !== null ? (todayNet >= 0 ? 'tds-v-good' : 'tds-v-bad') : ''}">${todayNet !== null ? formatMoney(todayNet) : '<span class="tds-v-dim">Unavailable</span>'}</span></div>`;
    if (weeklyField) {
      html += `<div class="tds-row"><span class="tds-row-label">Weekly Income</span><span class="tds-row-value">${formatMoney(weeklyField.value)}</span></div>`;
    }
    html += '</div>';
    if (todayGross === null) {
      html += `<div class="tds-box tds-box-warn">No numeric daily_income/daily_profit field was found in the company profile or detailed response. Fields actually present — profile: ${profile ? Object.keys(profile).join(', ') : (blockedProfile || 'blocked')}; detailed: ${detailed ? Object.keys(detailed).join(', ') : (blockedDetailed || 'blocked')}.</div>`;
    }

    // --- Company health, if company/detailed is accessible with this key ---
    if (detailed) {
      const bankField = Object.entries(detailed).find(([k, v]) => typeof v === 'number' && /bank/i.test(k));
      const popField = Object.entries(detailed).find(([k, v]) => typeof v === 'number' && /popular/i.test(k));
      const effField = Object.entries(detailed).find(([k, v]) => typeof v === 'number' && /efficien/i.test(k));
      const envField = Object.entries(detailed).find(([k, v]) => typeof v === 'number' && /environ/i.test(k));
      if (bankField || popField || effField || envField) {
        html += '<div class="tds-section-label">Company Health</div><div class="tds-card">';
        if (bankField) html += `<div class="tds-row"><span class="tds-row-label">Company bank</span><span class="tds-row-value">${formatMoney(bankField[1])}</span></div>`;
        if (popField) html += `<div class="tds-row"><span class="tds-row-label">Popularity</span><span class="tds-row-value">${popField[1]}%</span></div>`;
        if (effField) html += `<div class="tds-row"><span class="tds-row-label">Efficiency</span><span class="tds-row-value">${effField[1]}%</span></div>`;
        if (envField) html += `<div class="tds-row"><span class="tds-row-label">Environment</span><span class="tds-row-value">${envField[1]}%</span></div>`;
        html += '</div>';
      }
    }

    // --- Daily performance comparison ---
    // Prefer the compact Performance History layer, which can include both
    // locally observed days and Torn historical Snapshot backfill.
    const dailyPerformance = await getDailyPerformanceHistory();
    const comparableIncomeDays = dailyPerformance.filter(
      (row) => typeof row.observed?.dailyIncome === 'number'
    );

    html += '<div class="tds-section-label">Latest Day vs Previous Day <span class="tds-v-dim" style="font-weight:400;">(Torn Snapshot / local performance history)</span></div>';

    if (comparableIncomeDays.length < 2) {
      html += `<div class="tds-box tds-box-neutral">
        Insufficient comparable income history — ${comparableIncomeDays.length} day${comparableIncomeDays.length === 1 ? '' : 's'} currently has a usable daily income value.
        Use <strong>Backfill available Torn history</strong> below to retrieve retained historical Company Snapshot data where available.
      </div>`;
    } else {
      const latestDay = comparableIncomeDays[comparableIncomeDays.length - 1];
      const previousDay = comparableIncomeDays[comparableIncomeDays.length - 2];

      const latestIncome = latestDay.observed.dailyIncome;
      const previousIncome = previousDay.observed.dailyIncome;
      const change = latestIncome - previousIncome;
      const pct = previousIncome !== 0
        ? (change / Math.abs(previousIncome)) * 100
        : null;

      html += '<div class="tds-card">';
      html += `<div class="tds-row"><span class="tds-row-label">${escapeHtml(formatPerformanceDate(latestDay.timestamp))} (${latestDay.source === 'torn_snapshot' ? 'Torn Snapshot' : 'Local'})</span><span class="tds-row-value">${formatMoney(latestIncome)}</span></div>`;
      html += `<div class="tds-row"><span class="tds-row-label">${escapeHtml(formatPerformanceDate(previousDay.timestamp))} (${previousDay.source === 'torn_snapshot' ? 'Torn Snapshot' : 'Local'})</span><span class="tds-row-value">${formatMoney(previousIncome)}</span></div>`;
      html += `<div class="tds-row"><span class="tds-row-label">Change</span><span class="tds-row-value ${change >= 0 ? 'tds-v-good' : 'tds-v-bad'}">${change >= 0 ? '+' : ''}${formatMoney(change)}${pct !== null ? ` (${change >= 0 ? '↑' : '↓'} ${Math.abs(pct).toFixed(1)}%)` : ''}</span></div>`;

      const latestCustomers = latestDay.observed?.dailyCustomers;
      const previousCustomers = previousDay.observed?.dailyCustomers;
      if (
        typeof latestCustomers === 'number' &&
        typeof previousCustomers === 'number'
      ) {
        const customerChange = latestCustomers - previousCustomers;
        const customerPct = previousCustomers !== 0
          ? (customerChange / Math.abs(previousCustomers)) * 100
          : null;

        html += `<div class="tds-row"><span class="tds-row-label">Daily customers change</span><span class="tds-row-value ${customerChange >= 0 ? 'tds-v-good' : 'tds-v-bad'}">${customerChange >= 0 ? '+' : ''}${formatNumber(customerChange)}${customerPct !== null ? ` (${customerChange >= 0 ? '↑' : '↓'} ${Math.abs(customerPct).toFixed(1)}%)` : ''}</span></div>`;
      }

      html += '</div>';

      const recentIncomeDays = comparableIncomeDays.slice(-7);
      if (recentIncomeDays.length >= 2) {
        const values = recentIncomeDays.map(
          (row) => row.observed.dailyIncome
        );
        const minValue = Math.min(...values);
        const maxValue = Math.max(...values);
        const range = Math.max(1, maxValue - minValue);

        html += `<div class="tds-section-label">Last ${values.length} comparable days <span class="tds-v-dim" style="font-weight:400;">(Performance History)</span></div>`;

        html += `<div class="tds-income-chart">`;

        recentIncomeDays.forEach((row) => {
          const value = row.observed.dailyIncome;

          // Use a minimum visible height while scaling the rest of the bars
          // across the recent range so close daily values remain readable.
          const normalized =
            maxValue === minValue
              ? 0.75
              : 0.20 + ((value - minValue) / range) * 0.80;

          const height = Math.max(
            12,
            Math.round(normalized * 105)
          );

          const cls =
            value === maxValue && maxValue !== minValue
              ? 'tds-v-good'
              : value === minValue && maxValue !== minValue
                ? 'tds-v-bad'
                : '';

          html += `<div class="tds-income-chart-item ${cls}">
            <div class="tds-income-chart-value">${escapeHtml(formatMoney(value))}</div>
            <div class="tds-income-chart-bar-wrap">
              <div class="tds-income-chart-bar" style="height:${height}px;" title="${escapeHtml(formatPerformanceDate(row.timestamp))}: ${escapeHtml(formatMoney(value))}"></div>
            </div>
            <div class="tds-income-chart-date">${escapeHtml(formatPerformanceDate(row.timestamp))}</div>
            <div class="tds-income-chart-source">${row.source === 'torn_snapshot' ? 'Torn Snapshot' : 'Local'}</div>
          </div>`;
        });

        html += `</div>
          <div class="tds-box tds-box-neutral" style="margin-top:8px;">
            <strong>Chart scale:</strong> bars are scaled across the visible recent range so small day-to-day differences remain readable.
            Green marks the highest value in this window; red marks the lowest.
          </div>`;
      }
    }

    // --- Product sale activity from company/news ---
    // This is API-derived and mirrors the useful "what sold" information from
    // Torn's company financial view without scraping or automating the page.
    const stockRawForFinance = findRaw(results, 'company', 'stock');
    const stockItemsForFinance = extractStockItems(stockRawForFinance);

    if (stockItemsForFinance.length) {
      html += '<div class="tds-section-label">Product Sales — Last 24h vs Previous 24h <span class="tds-v-dim" style="font-weight:400;">(company/news)</span></div>';

      try {
        const diagnosticNews = findRaw(results, 'company', 'news');
        const newsRaw = diagnosticNews || await fetchCompanyNewsForStock();
        const salesCompare = aggregateSalesComparison(
          newsRaw,
          stockItemsForFinance
        );

        if (!salesCompare.parsedEvents) {
          html += `<div class="tds-box tds-box-neutral">
            Company news was readable, but no stock-sale events were recognised in the returned history.
          </div>`;
        } else {
          const coverageComplete = salesCompare.coverageHours >= 48;

          html += `<div class="tds-box ${coverageComplete ? 'tds-box-info' : 'tds-box-warn'}">
            ${coverageComplete
              ? 'Returned company-news history covers at least 48 hours, so the two windows are directly comparable.'
              : `Returned company-news history covers about ${salesCompare.coverageHours.toFixed(1)} hours. Previous-24h figures may therefore be partial.`}
          </div>`;

          const unitChange = salesCompare.currentUnits - salesCompare.previousUnits;
          const unitPct = salesCompare.previousUnits > 0
            ? (unitChange / salesCompare.previousUnits) * 100
            : null;

          html += `<div class="tds-card">
            <div class="tds-row"><span class="tds-row-label">Units sold — last 24h</span><span class="tds-row-value">${formatNumber(salesCompare.currentUnits)}</span></div>
            <div class="tds-row"><span class="tds-row-label">Units sold — previous 24h</span><span class="tds-row-value">${formatNumber(salesCompare.previousUnits)}</span></div>
            <div class="tds-row"><span class="tds-row-label">Unit-sales change</span><span class="tds-row-value ${unitChange >= 0 ? 'tds-v-good' : 'tds-v-bad'}">${unitChange >= 0 ? '+' : ''}${formatNumber(unitChange)}${unitPct !== null ? ` (${unitChange >= 0 ? '↑' : '↓'} ${Math.abs(unitPct).toFixed(1)}%)` : ''}</span></div>`;

          if (
            salesCompare.currentPricedUnits > 0 ||
            salesCompare.previousPricedUnits > 0
          ) {
            const revenueChange =
              salesCompare.currentRevenue -
              salesCompare.previousRevenue;

            html += `<div class="tds-row"><span class="tds-row-label">Observed sale revenue — last 24h</span><span class="tds-row-value">${formatMoney(salesCompare.currentRevenue)}</span></div>
              <div class="tds-row"><span class="tds-row-label">Observed sale revenue — previous 24h</span><span class="tds-row-value">${formatMoney(salesCompare.previousRevenue)}</span></div>
              <div class="tds-row"><span class="tds-row-label">Observed revenue change</span><span class="tds-row-value ${revenueChange >= 0 ? 'tds-v-good' : 'tds-v-bad'}">${revenueChange >= 0 ? '+' : ''}${formatMoney(revenueChange)}</span></div>`;
          }

          html += '</div>';

          const productRows = salesCompare.products.filter(
            (row) => row.currentUnits > 0 || row.previousUnits > 0
          );

          if (productRows.length) {
            html += `<div style="overflow-x:auto;"><table class="tds-table tds-performance-history">
              <thead><tr>
                <th>Product</th>
                <th>Last 24h</th>
                <th>Previous 24h</th>
                <th>Change</th>
              </tr></thead><tbody>`;

            for (const row of productRows) {
              const delta = row.currentUnits - row.previousUnits;
              html += `<tr>
                <td><strong>${escapeHtml(row.name)}</strong></td>
                <td>${formatNumber(row.currentUnits)}</td>
                <td>${formatNumber(row.previousUnits)}</td>
                <td class="${delta >= 0 ? 'tds-v-good' : 'tds-v-bad'}">${delta >= 0 ? '+' : ''}${formatNumber(delta)}</td>
              </tr>`;
            }

            html += '</tbody></table></div>';
          }
        }
      } catch (err) {
        html += `<div class="tds-box tds-box-warn">
          Product-sale comparison unavailable: ${escapeHtml(String(err?.reason || err?.message || err))}
        </div>`;
      }
    }

    const performanceHistory = await getDailyPerformanceHistory();

    html += `<div class="tds-section-label">Company Performance History</div>`;

    if (!performanceHistory.length) {
      html += `<div class="tds-box tds-box-neutral">
        No usable performance observations yet. Future Diagnostics runs will build this automatically.
      </div>`;
    } else {
      const displayHistory = performanceHistory.slice(-90).reverse();

      const incomeExtrema = historyExtrema(
        performanceHistory,
        (row) => row.observed?.dailyIncome
      );
      const customerExtrema = historyExtrema(
        performanceHistory,
        (row) => row.observed?.dailyCustomers
      );
      const totalEEExtrema = historyExtrema(
        performanceHistory,
        (row) => row.calculated?.totalEE
      );
      const salesEEExtrema = historyExtrema(
        performanceHistory,
        (row) => row.calculated?.salesEE
      );

      html += `<div class="tds-box tds-box-info">
        Compact Performance History keeps a rolling <strong>${MAX_PERFORMANCE_DAYS}-day</strong> local log.
        The table shows up to the most recent 90 days. Green highlights the highest recorded value for that metric; red highlights the lowest.
      </div>`;

      html += `<div style="overflow-x:auto;"><table class="tds-table tds-performance-history">
        <thead><tr>
          <th>Date</th>
          <th>Source</th>
          <th>Daily Income</th>
          <th>Daily Customers</th>
          <th>Total EE</th>
          <th>Sales EE Capacity</th>
          <th>Employees</th>
        </tr></thead><tbody>`;

      for (const row of displayHistory) {
        const income = row.observed?.dailyIncome;
        const customers = row.observed?.dailyCustomers;
        const totalEE = row.calculated?.totalEE;
        const salesEE = row.calculated?.salesEE;

        html += `<tr>
          <td>${escapeHtml(formatPerformanceDate(row.timestamp))}</td>
          <td>${row.source === 'torn_snapshot' ? 'Torn Snapshot' : 'Local'}</td>
          <td class="${extremaClass(income, incomeExtrema)}">${typeof income === 'number' ? formatMoney(income) : '—'}</td>
          <td class="${extremaClass(customers, customerExtrema)}">${typeof customers === 'number' ? formatNumber(customers) : '—'}</td>
          <td class="${extremaClass(totalEE, totalEEExtrema)}">${typeof totalEE === 'number' ? formatNumber(Math.round(totalEE)) : '—'}</td>
          <td class="${extremaClass(salesEE, salesEEExtrema)}">${typeof salesEE === 'number' ? `${formatNumber(Math.round(salesEE))} EE` : '—'}</td>
          <td>${typeof row.observed?.employeeCount === 'number' ? formatNumber(row.observed.employeeCount) : '—'}</td>
        </tr>`;
      }

      html += `</tbody></table></div>`;

      const backfillCoverage = analyseBackfillCoverage(performanceHistory, 30);

      html += `<div class="tds-section-label">History Coverage</div>
      <div class="tds-card">
        <div class="tds-row">
          <span class="tds-row-label">Available 30-day window stored</span>
          <span class="tds-row-value"><strong>${formatNumber(backfillCoverage.storedCount)} / ${formatNumber(backfillCoverage.historyDays)} days</strong></span>
        </div>
        <div class="tds-row">
          <span class="tds-row-label">Missing days</span>
          <span class="tds-row-value ${backfillCoverage.missingCount ? 'tds-v-warn' : 'tds-v-good'}"><strong>${formatNumber(backfillCoverage.missingCount)}</strong></span>
        </div>
        <div class="tds-row">
          <span class="tds-row-label">Oldest stored day in current window</span>
          <span class="tds-row-value">${backfillCoverage.oldest ? escapeHtml(formatPerformanceDate(backfillCoverage.oldest.timestamp)) : '—'}</span>
        </div>
        <div class="tds-row">
          <span class="tds-row-label">Newest stored day in current window</span>
          <span class="tds-row-value">${backfillCoverage.newest ? escapeHtml(formatPerformanceDate(backfillCoverage.newest.timestamp)) : '—'}</span>
        </div>
      </div>`;

      html += `<div class="tds-box tds-box-neutral" style="margin-top:10px;">
        <strong>Historical backfill:</strong> Torn's Company Snapshot can supply retained historical income/customer figures for dates before this script recorded them.
        Backfill now requests <strong>only missing days</strong> from the current 30-day window.
        Historical Snapshot rows cannot reconstruct past employee EE or staffing, so those fields remain blank rather than being guessed.
      </div>
      <div style="margin-top:10px;">
        <button class="tds-btn-ghost" id="tds-history-backfill">Backfill available Torn history</button>
        <span id="tds-history-backfill-status" class="tds-v-dim" style="margin-left:8px;"></span>
        <div class="tds-history-progress" id="tds-history-backfill-progress" hidden>
          <div class="tds-history-progress-bar" id="tds-history-backfill-progress-bar"></div>
        </div>
        <div id="tds-history-backfill-detail" class="tds-v-dim" style="margin-top:5px;"></div>
      </div>`;

      const customerCorrelation = pearsonCorrelation(
        performanceHistory.map((row) => [row.calculated?.salesEE, row.observed?.dailyCustomers])
      );
      const incomeCorrelation = pearsonCorrelation(
        performanceHistory.map((row) => [row.calculated?.salesEE, row.observed?.dailyIncome])
      );

      html += `<div class="tds-card" style="margin-top:10px;">
        <div class="tds-row"><span class="tds-row-label">Observations</span><span class="tds-row-value">${formatNumber(performanceHistory.length)}</span></div>
        <div class="tds-row"><span class="tds-row-label">Sales EE ↔ Daily Customers</span><span class="tds-row-value">${escapeHtml(correlationLabel(customerCorrelation))}</span></div>
        <div class="tds-row"><span class="tds-row-label">Sales EE ↔ Daily Income</span><span class="tds-row-value">${escapeHtml(correlationLabel(incomeCorrelation))}</span></div>
        <div class="tds-row"><span class="tds-row-label">Evidence Confidence</span><span class="tds-row-value">${escapeHtml(performanceConfidence(performanceHistory.length))}</span></div>
      </div>`;

      html += `<div class="tds-box tds-box-neutral" style="margin-top:10px;">
        <strong>Observed:</strong> Torn-reported company results.
        <strong>Calculated:</strong> EE totals derived from the employee roster.
        <strong>Estimated:</strong> optimiser recommendations shown elsewhere in the suite.
        Correlation is descriptive only and does not prove cause/effect.
      </div>`;
    }

    html += `<div class="tds-box tds-box-neutral" style="margin-top:10px;">
      <strong>Local retention:</strong> full diagnostic snapshots are capped at ${MAX_SNAPSHOTS} because they can be relatively large.
      Compact Performance History is stored separately and rolls after ${MAX_PERFORMANCE_DAYS} daily records (about 2 years).
    </div>`;

    el.innerHTML = html;

    const backfillButton = el.querySelector('#tds-history-backfill');
    const backfillStatus = el.querySelector('#tds-history-backfill-status');
    const backfillProgress = el.querySelector('#tds-history-backfill-progress');
    const backfillProgressBar = el.querySelector('#tds-history-backfill-progress-bar');
    const backfillDetail = el.querySelector('#tds-history-backfill-detail');

    if (backfillButton) {
      const currentCoverage = analyseBackfillCoverage(
        performanceHistory,
        30
      );

      const lastBackfillDay = GM_getValue(
        STORAGE_KEY_HISTORY_BACKFILL_DAY,
        ''
      );

      const lastBackfillResult = GM_getValue(
        STORAGE_KEY_HISTORY_BACKFILL_RESULT,
        null
      );

      if (currentCoverage.missingCount === 0) {
        backfillButton.disabled = true;
        backfillButton.textContent = 'History complete';

        if (backfillStatus) {
          backfillStatus.textContent =
            'All 30 days in the current historical window are already stored.';
          backfillStatus.classList.remove('tds-v-dim', 'tds-v-warn');
          backfillStatus.classList.add('tds-v-good');
        }

        if (backfillDetail) {
          backfillDetail.textContent =
            `Coverage: ${formatNumber(currentCoverage.storedCount)} / ${formatNumber(currentCoverage.historyDays)} days. No API requests are needed.`;
        }
      } else {
        backfillButton.disabled = false;
        backfillButton.textContent =
          `Backfill ${formatNumber(currentCoverage.missingCount)} missing day${currentCoverage.missingCount === 1 ? '' : 's'}`;

        if (backfillStatus) {
          backfillStatus.textContent =
            `${formatNumber(currentCoverage.storedCount)} / ${formatNumber(currentCoverage.historyDays)} days already stored.`;
        }

        if (
          backfillDetail &&
          lastBackfillDay &&
          lastBackfillResult
        ) {
          backfillDetail.textContent =
            `Last run: ${formatNumber(lastBackfillResult.saved || 0)} newly saved · ` +
            `${formatNumber(lastBackfillResult.unavailable || 0)} not found · ` +
            `${formatNumber(lastBackfillResult.errors || 0)} error(s). ` +
            `Only currently missing days will be requested next.`;
        }
      }

      backfillButton.addEventListener('click', async () => {
        console.log('[TDS] Historical backfill button clicked');
        const currentResults = state.lastResults;
        const profile = findRaw(currentResults, 'company', 'profile');
        const own = getOwnCompanyCompareInfo(profile, currentResults);

        console.log('[TDS] Historical backfill company detected:', own);

        const historyBeforeBackfill = await getDailyPerformanceHistory();
        const coverageBeforeBackfill = analyseBackfillCoverage(
          historyBeforeBackfill,
          30
        );

        if (coverageBeforeBackfill.missingCount === 0) {
          backfillButton.disabled = true;
          backfillButton.textContent = 'History complete';

          if (backfillStatus) {
            backfillStatus.textContent =
              'All 30 days are already stored — no API requests made.';
          }

          if (backfillDetail) {
            backfillDetail.textContent =
              `Coverage: ${formatNumber(coverageBeforeBackfill.storedCount)} / ${formatNumber(coverageBeforeBackfill.historyDays)} days.`;
          }

          return;
        }

        if (own.id === null && !own.name) {
          if (backfillStatus) {
            backfillStatus.textContent = 'Company ID and name unavailable — cannot start backfill.';
            backfillStatus.classList.remove('tds-v-dim');
            backfillStatus.classList.add('tds-v-bad');
          }
          console.warn('[TDS] Historical backfill aborted: company identity unavailable');
          return;
        }

        backfillButton.disabled = true;
        backfillButton.textContent = 'Backfilling…';

        if (backfillStatus) {
          const companyText =
            own.id !== null
              ? `company ${formatNumber(own.id)}${own.name ? ` (${own.name})` : ''}`
              : `${own.name} using exact name matching`;

          backfillStatus.textContent =
            `Checking ${formatNumber(coverageBeforeBackfill.missingCount)} missing day${coverageBeforeBackfill.missingCount === 1 ? '' : 's'} for ${companyText}…`;
        }

        if (backfillProgress) backfillProgress.hidden = false;
        if (backfillProgressBar) backfillProgressBar.style.width = '0%';

        if (backfillDetail) {
          backfillDetail.textContent =
            'This performs read-only Torn API requests. No company actions are submitted.';
        }

        console.log('[TDS] Historical backfill starting for company', own.id);

        try {
          const result = await backfillCompanyPerformanceHistory(
            own,
            coverageBeforeBackfill.missing,
            (progress) => {
              const pct = progress.total
                ? Math.min(100, Math.round((progress.complete / progress.total) * 100))
                : 0;

              if (backfillProgressBar) {
                backfillProgressBar.style.width = `${pct}%`;
              }

              if (backfillStatus) {
                backfillStatus.textContent =
                  `Checking missing days ${progress.complete}/${progress.total}${progress.day ? ` · ${progress.day}` : ''}`;
              }

              if (backfillDetail) {
                backfillDetail.textContent =
                  `Progress: ${pct}% · Historical Snapshot data is saved locally as compact daily records.`;
              }
            }
          );

          GM_setValue(STORAGE_KEY_HISTORY_BACKFILL_DAY, isoDayKey(Date.now()));
          GM_setValue(STORAGE_KEY_HISTORY_BACKFILL_RESULT, {
            saved: result.saved,
            unavailable: result.unavailable,
            errors: result.errors,
            requested: result.requested,
            resolvedCompanyId: result.resolvedCompanyId,
            matchedByName: result.matchedByName,
            matchedById: result.matchedById,
            completedAt: Date.now(),
          });

          if (backfillProgressBar) {
            backfillProgressBar.style.width = '100%';
          }

          if (backfillStatus) {
            backfillStatus.textContent = 'Backfill complete.';
          }

          if (backfillDetail) {
            const summary =
              `${formatNumber(coverageBeforeBackfill.storedCount)} already stored · ` +
              `${formatNumber(result.saved)} newly downloaded · ` +
              `${formatNumber(result.unavailable)} not found · ` +
              `${formatNumber(result.errors)} error(s) · ` +
              `${formatNumber(result.requested)} missing day(s) checked.`;

            const firstError = result.errorDetails?.[0];

            backfillDetail.textContent = firstError
              ? `${summary} First error (${firstError.day}): ${firstError.reason}`
              : summary;
          }

          backfillButton.textContent = 'Refreshing history…';

          // Give the user a moment to see the completion state, then refresh
          // Company Financials so the new historical rows/chart appear.
          setTimeout(() => {
            renderFinanceTab(panel).catch((err) =>
              console.warn('[TDS] Finance refresh after backfill failed:', err)
            );
          }, 900);
        } catch (err) {
          if (backfillStatus) {
            backfillStatus.textContent = 'Backfill failed.';
          }

          if (backfillDetail) {
            backfillDetail.textContent =
              String(err?.reason || err?.message || err);
          }

          backfillButton.disabled = false;
          backfillButton.textContent = 'Backfill available Torn history';
        }
      });
    }

  }

  // =======================================================================
  // STOCK MANAGEMENT TAB
  // =======================================================================
  const STOCK_NEWS_CACHE_MS = 5 * 60 * 1000;

  function deepObjectEntries(raw) {
    const out = [];
    const seen = new WeakSet();
    function walk(value, path = []) {
      if (!value || typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);
      out.push({ value, path });
      if (Array.isArray(value)) value.forEach((child, i) => walk(child, [...path, String(i)]));
      else Object.entries(value).forEach(([key, child]) => walk(child, [...path, key]));
    }
    walk(raw);
    return out;
  }

  function pickNumeric(obj, names) {
    if (!obj || typeof obj !== 'object') return null;
    for (const name of names) {
      const wanted = normalizeFieldName(name);
      const entry = Object.entries(obj).find(([k, v]) => normalizeFieldName(k) === wanted && numericValue(v) !== null);
      if (entry) return numericValue(entry[1]);
    }
    return null;
  }

  function pickText(obj, names) {
    if (!obj || typeof obj !== 'object') return null;
    for (const name of names) {
      const wanted = normalizeFieldName(name);
      const entry = Object.entries(obj).find(([k, v]) => normalizeFieldName(k) === wanted && (typeof v === 'string' || typeof v === 'number'));
      if (entry && String(entry[1]).trim()) return String(entry[1]).trim();
    }
    return null;
  }

  function extractStockItems(stockRaw) {
    if (!stockRaw) return [];
    const candidates = [];
    const seenKeys = new Set();

    for (const { value, path } of deepObjectEntries(stockRaw)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;

      // Torn's company/stock response can expose each product as an object
      // keyed by its product name under company_stock, e.g.
      // company_stock["Product Name"] = { cost, in_stock, on_order, price,
      // rrp, sold_amount, sold_worth }. Older/alternate response shapes may
      // instead contain the name as a field, so support both.
      const pathName = path.length ? String(path[path.length - 1]) : '';
      const directName = pickText(value, ['name', 'item_name', 'stock_name', 'product_name']);
      const hasStockMetrics = [
        'cost', 'in_stock', 'on_order', 'price', 'rrp', 'sold_amount', 'sold_worth',
        'amount', 'quantity', 'qty', 'stock', 'inventory'
      ].some((field) => pickNumeric(value, [field]) !== null);

      const name = directName || (
        hasStockMetrics &&
        pathName &&
        !/^(company_stock|stock|data|items)$/i.test(pathName)
          ? pathName
          : null
      );

      const id = pickText(value, ['id', 'item_id', 'stock_id', 'product_id']);
      const current = pickNumeric(value, [
        'in_stock', 'instock', 'amount', 'quantity', 'qty', 'stock', 'available', 'inventory'
      ]);
      const onOrder = pickNumeric(value, ['on_order', 'onorder', 'ordered', 'incoming']);
      const setPrice = pickNumeric(value, ['price', 'selling_price', 'sell_price', 'price_each', 'priceeach']);
      const costEach = pickNumeric(value, ['cost', 'cost_each', 'costeach', 'unit_cost', 'buy_price']);
      const rrp = pickNumeric(value, ['rrp', 'recommended_retail_price', 'retail_price']);
      const soldTotal = pickNumeric(value, [
        'sold_amount', 'soldamount', 'sold_total', 'soldtotal', 'total_sold', 'units_sold_total'
      ]);
      const soldWorth = pickNumeric(value, ['sold_worth', 'soldworth', 'sales_worth', 'revenue']);
      const soldDaily = pickNumeric(value, ['sold_daily', 'solddaily', 'daily_sold', 'sold_day', 'sold_today', 'daily_sales', 'sales_day']);
      const sold24 = pickNumeric(value, ['sold_24h', 'sold24h', 'sold_day', 'sold_today', 'daily_sold', 'daily_sales', 'sales_day']);
      const sold7 = pickNumeric(value, ['sold_7d', 'sold7d', 'sold_week', 'weekly_sold', 'weekly_sales', 'sales_week']);

      if (!name || (
        current === null &&
        onOrder === null &&
        soldTotal === null &&
        sold24 === null &&
        sold7 === null &&
        soldDaily === null &&
        setPrice === null
      )) continue;

      const key = `${id || ''}|${name}`.toLowerCase();
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);

      candidates.push({
        id,
        name,
        current,
        onOrder,
        setPrice,
        costEach,
        rrp,
        soldTotal,
        soldWorth,
        soldDaily,
        sold24,
        sold7,
        raw: value
      });
    }

    return candidates.sort((a, b) => a.name.localeCompare(b.name));
  }

  function flattenNewsEntries(newsRaw) {
    if (!newsRaw) return [];
    const rows = [];
    const seen = new Set();
    for (const { value, path } of deepObjectEntries(newsRaw)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const timestamp = pickNumeric(value, ['timestamp', 'time', 'created_at', 'date']);
      const text = pickText(value, ['text', 'news', 'message', 'description', 'event', 'title']);
      const id = pickText(value, ['id', 'news_id', 'event_id']) || path.join('.');
      if (!text || !timestamp) continue;
      const key = `${id}|${timestamp}|${text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ id, timestamp, text, raw: value });
    }
    return rows.sort((a, b) => b.timestamp - a.timestamp);
  }

  function parseSaleFromNews(entry, stockItems) {
    const raw = entry.raw || {};
    const text = String(entry.text || '');
    if (!/(sold|sale|customer|purchased|bought)/i.test(text)) return null;

    let qty = pickNumeric(raw, ['quantity', 'qty', 'amount', 'sold', 'units', 'count']);
    let itemName = pickText(raw, ['item_name', 'stock_name', 'product_name', 'item', 'product']);

    const patterns = [
      /(?:sold|sale of)\s+(\d[\d,]*)\s+(?:x\s+)?(.+?)(?:\s+(?:for|at|to|worth)\b|[.!]|$)/i,
      /(\d[\d,]*)\s+(?:x\s+)?(.+?)\s+(?:were\s+|was\s+)?sold\b/i,
      /(.+?)\s*[:\-]\s*(\d[\d,]*)\s+(?:sold|sales)\b/i,
    ];
    if (qty === null || !itemName) {
      for (const re of patterns) {
        const m = text.match(re);
        if (!m) continue;
        if (/^\D/.test(m[1])) {
          itemName = itemName || m[1].trim();
          qty = qty ?? Number(String(m[2]).replace(/,/g, ''));
        } else {
          qty = qty ?? Number(String(m[1]).replace(/,/g, ''));
          itemName = itemName || m[2].trim();
        }
        break;
      }
    }
    if (!Number.isFinite(qty) || qty <= 0 || !itemName) return null;

    // Prefer a current stock item name so minor wording differences in news
    // aggregate into the same row.
    const normalizedNewsName = normalizeFieldName(itemName);
    const match = stockItems.find((item) => {
      const n = normalizeFieldName(item.name);
      return n === normalizedNewsName || n.includes(normalizedNewsName) || normalizedNewsName.includes(n);
    });
    let salePrice = pickNumeric(raw, [
      'price', 'sale_price', 'sold_price', 'price_each', 'unit_price', 'selling_price'
    ]);

    if (salePrice === null) {
      const pricePatterns = [
        /(?:for|at)\s*\$\s*([\d,]+(?:\.\d+)?)(?:\s+each)?\b/i,
        /\$\s*([\d,]+(?:\.\d+)?)\s*(?:each|per\s+item|per\s+unit)\b/i,
      ];
      for (const re of pricePatterns) {
        const m = text.match(re);
        if (!m) continue;
        const parsed = Number(String(m[1]).replace(/,/g, ''));
        if (Number.isFinite(parsed)) {
          salePrice = parsed;
          break;
        }
      }
    }

    return {
      timestamp: entry.timestamp,
      quantity: qty,
      name: match?.name || itemName,
      id: match?.id || null,
      price: salePrice
    };
  }

  function aggregateSalesComparison(newsRaw, stockItems) {
    const nowSec = Math.floor(Date.now() / 1000);
    const dayAgo = nowSec - 86400;
    const twoDaysAgo = nowSec - 2 * 86400;

    const entries = flattenNewsEntries(newsRaw);
    let parsedEvents = 0;
    let currentUnits = 0;
    let previousUnits = 0;
    let currentRevenue = 0;
    let previousRevenue = 0;
    let currentPricedUnits = 0;
    let previousPricedUnits = 0;

    const productMap = new Map();

    for (const entry of entries) {
      const sale = parseSaleFromNews(entry, stockItems);
      if (!sale) continue;
      parsedEvents += 1;

      if (sale.timestamp < twoDaysAgo) continue;

      const key = String(sale.id || normalizeFieldName(sale.name));
      const row = productMap.get(key) || {
        name: sale.name,
        currentUnits: 0,
        previousUnits: 0,
        currentRevenue: 0,
        previousRevenue: 0,
      };

      const isCurrent = sale.timestamp >= dayAgo;
      const isPrevious = sale.timestamp >= twoDaysAgo && sale.timestamp < dayAgo;

      if (isCurrent) {
        row.currentUnits += sale.quantity;
        currentUnits += sale.quantity;

        if (typeof sale.price === 'number') {
          const revenue = sale.quantity * sale.price;
          row.currentRevenue += revenue;
          currentRevenue += revenue;
          currentPricedUnits += sale.quantity;
        }
      } else if (isPrevious) {
        row.previousUnits += sale.quantity;
        previousUnits += sale.quantity;

        if (typeof sale.price === 'number') {
          const revenue = sale.quantity * sale.price;
          row.previousRevenue += revenue;
          previousRevenue += revenue;
          previousPricedUnits += sale.quantity;
        }
      }

      productMap.set(key, row);
    }

    const oldestTimestamp = entries.length
      ? Math.min(...entries.map((entry) => entry.timestamp))
      : null;

    return {
      parsedEvents,
      newsEntries: entries.length,
      oldestTimestamp,
      coverageHours: oldestTimestamp
        ? Math.max(0, (nowSec - oldestTimestamp) / 3600)
        : 0,
      currentUnits,
      previousUnits,
      currentRevenue,
      previousRevenue,
      currentPricedUnits,
      previousPricedUnits,
      products: [...productMap.values()].sort(
        (a, b) => b.currentUnits - a.currentUnits
      ),
    };
  }

  function aggregateSales(newsRaw, stockItems) {
    const nowSec = Math.floor(Date.now() / 1000);
    const dayAgo = nowSec - 86400;
    const weekAgo = nowSec - 7 * 86400;
    const totals = new Map();
    const entries = flattenNewsEntries(newsRaw);
    let parsedEvents = 0;

    for (const entry of entries) {
      const sale = parseSaleFromNews(entry, stockItems);
      if (!sale) continue;
      parsedEvents += 1;
      const key = String(sale.id || normalizeFieldName(sale.name));
      const row = totals.get(key) || {
        name: sale.name,
        sold24: 0,
        sold7: 0,
        lastSoldPrice: null,
        lastSoldAt: null,
        pricedUnits24: 0,
        pricedRevenue24: 0
      };

      if (sale.timestamp >= weekAgo) row.sold7 += sale.quantity;
      if (sale.timestamp >= dayAgo) row.sold24 += sale.quantity;

      if (sale.price !== null && sale.price !== undefined) {
        if (!row.lastSoldAt || sale.timestamp > row.lastSoldAt) {
          row.lastSoldAt = sale.timestamp;
          row.lastSoldPrice = sale.price;
        }
        if (sale.timestamp >= dayAgo) {
          row.pricedUnits24 += sale.quantity;
          row.pricedRevenue24 += sale.quantity * sale.price;
        }
      }

      totals.set(key, row);
    }

    const oldestTimestamp = entries.length ? Math.min(...entries.map((e) => e.timestamp)) : null;
    return { totals, parsedEvents, newsEntries: entries.length, oldestTimestamp };
  }

  async function fetchCompanyNewsForStock() {
    if (state.stock.newsCache && Date.now() - state.stock.newsCacheAt < STOCK_NEWS_CACHE_MS) return state.stock.newsCache;
    const now = Math.floor(Date.now() / 1000);
    const from = now - 7 * 86400;
    let data;
    try {
      data = await ApiClient.call('company', 'news', '', { from, to: now });
    } catch (err) {
      // Some API versions ignore/rename the window parameters. Fall back to
      // the normal news selection before declaring the history unavailable.
      data = await ApiClient.call('company', 'news');
    }
    state.stock.newsCache = data;
    state.stock.newsCacheAt = Date.now();
    return data;
  }

  function stockDaysRemaining(current, dailyRate) {
    if (current === null || typeof current !== 'number') return null;
    if (!dailyRate || dailyRate <= 0) return null;
    return current / dailyRate;
  }

  function stockGrossMargin(setPrice, costEach) {
    if (setPrice === null || costEach === null) return null;
    return setPrice - costEach;
  }

  function stockMarginPercent(setPrice, costEach) {
    if (setPrice === null || costEach === null || costEach <= 0) return null;
    return ((setPrice - costEach) / costEach) * 100;
  }

  function stockSalesTrend(sold24, sold7) {
    const day = sold24 !== null ? Math.max(0, Number(sold24) || 0) : null;
    const week = sold7 !== null ? Math.max(0, Number(sold7) || 0) : null;

    if (day === null || week === null) {
      return { percent: null, label: 'No trend', className: '' };
    }

    const weeklyDailyAverage = week / 7;

    if (weeklyDailyAverage <= 0) {
      if (day > 0) return { percent: null, label: 'New demand', className: 'tds-v-good' };
      return { percent: 0, label: 'Flat', className: '' };
    }

    const percent = ((day - weeklyDailyAverage) / weeklyDailyAverage) * 100;

    if (percent >= 15) {
      return { percent, label: `↑ ${percent.toFixed(0)}%`, className: 'tds-v-good' };
    }

    if (percent <= -15) {
      return { percent, label: `↓ ${Math.abs(percent).toFixed(0)}%`, className: 'tds-v-bad' };
    }

    return { percent, label: `≈ ${percent >= 0 ? '+' : ''}${percent.toFixed(0)}%`, className: '' };
  }

  function stockRiskStatus(daysLeft, current, dailyRate) {
    if (current !== null && current <= 0) {
      return {
        label: 'OUT OF STOCK',
        className: 'tds-v-bad',
        priority: 4,
        reason: 'No stock remaining.'
      };
    }

    if (dailyRate === null || dailyRate === undefined || dailyRate <= 0) {
      return {
        label: 'No recent demand',
        className: '',
        priority: 0,
        reason: 'No usable recent daily sales rate.'
      };
    }

    if (daysLeft === null) {
      return {
        label: 'Unknown',
        className: '',
        priority: 0,
        reason: 'Stock cover could not be calculated.'
      };
    }

    if (daysLeft <= 1) {
      return {
        label: 'Critical',
        className: 'tds-v-bad',
        priority: 4,
        reason: `Approximately ${daysLeft.toFixed(1)} day of stock remaining.`
      };
    }

    if (daysLeft <= 3) {
      return {
        label: 'Low',
        className: 'tds-v-bad',
        priority: 3,
        reason: `Approximately ${daysLeft.toFixed(1)} days of stock remaining.`
      };
    }

    if (daysLeft <= 7) {
      return {
        label: 'Watch',
        className: '',
        priority: 2,
        reason: `Approximately ${daysLeft.toFixed(1)} days of stock remaining.`
      };
    }

    if (daysLeft >= 30) {
      return {
        label: 'High cover',
        className: '',
        priority: 0,
        reason: `Approximately ${daysLeft.toFixed(1)} days of stock remaining.`
      };
    }

    return {
      label: 'Healthy',
      className: 'tds-v-good',
      priority: 1,
      reason: `Approximately ${daysLeft.toFixed(1)} days of stock remaining.`
    };
  }

  function restockPriority(rec, risk, trend) {
    if (!rec || rec.restock === null || rec.restock <= 0) {
      return {
        label: 'None',
        className: '',
        score: 0
      };
    }

    let score = risk?.priority || 0;

    if (trend?.percent !== null && trend.percent >= 15) score += 1;
    if (rec.restock >= rec.target * 0.75) score += 1;

    if (score >= 5) return { label: 'URGENT', className: 'tds-v-bad', score };
    if (score >= 3) return { label: 'High', className: 'tds-v-bad', score };
    if (score >= 2) return { label: 'Medium', className: '', score };
    return { label: 'Low', className: '', score };
  }

  function stockInventoryValue(items) {
    return items.reduce((sum, item) => {
      if (typeof item.current !== 'number' || typeof item.setPrice !== 'number') return sum;
      return sum + Math.max(0, item.current) * Math.max(0, item.setPrice);
    }, 0);
  }

  function pricingRecommendation(item, sold24, sold7, lastSoldPrice) {
    const setPrice = item.setPrice;
    const rrp = item.rrp;
    const current = item.current;
    const day = sold24 !== null ? Math.max(0, Number(sold24) || 0) : null;
    const week = sold7 !== null ? Math.max(0, Number(sold7) || 0) : null;
    const weeklyDailyAverage = week !== null ? week / 7 : null;
    const dailyRate = day !== null ? day : (item.soldDaily !== null ? item.soldDaily : weeklyDailyAverage);
    const daysLeft = stockDaysRemaining(current, dailyRate);

    if (setPrice === null) {
      return {
        action: 'No price data',
        className: '',
        suggested: null,
        reason: 'Torn did not return the currently configured selling price.'
      };
    }

    const trend =
      day !== null && weeklyDailyAverage !== null && weeklyDailyAverage > 0
        ? ((day - weeklyDailyAverage) / weeklyDailyAverage) * 100
        : null;

    let score = 0;
    const reasons = [];

    // Strong recent demand and plenty of cover suggests there is room to test
    // a small increase. Weak demand with lots of inventory suggests the reverse.
    if (trend !== null) {
      if (trend >= 15) {
        score += 2;
        reasons.push(`24h sales are ${trend.toFixed(0)}% above the 7-day daily average`);
      } else if (trend <= -15) {
        score -= 2;
        reasons.push(`24h sales are ${Math.abs(trend).toFixed(0)}% below the 7-day daily average`);
      } else {
        reasons.push('24h sales are close to the 7-day daily average');
      }
    }

    if (daysLeft !== null) {
      if (daysLeft >= 14) {
        score += 1;
        reasons.push(`${daysLeft.toFixed(1)} days of stock remain`);
      } else if (daysLeft <= 4) {
        score -= 1;
        reasons.push(`only ${daysLeft.toFixed(1)} days of stock remain`);
      }
    }

    if (rrp !== null) {
      if (setPrice < rrp * 0.85) {
        score += 1;
        reasons.push(`set price is well below RRP (${formatCurrency(rrp)})`);
      } else if (setPrice > rrp * 1.20) {
        score -= 1;
        reasons.push(`set price is well above RRP (${formatCurrency(rrp)})`);
      }
    }

    if (lastSoldPrice !== null) {
      if (lastSoldPrice >= setPrice) {
        reasons.push(`latest observed sale cleared at ${formatCurrency(lastSoldPrice)}`);
      } else {
        score -= 1;
        reasons.push(`latest observed sale price (${formatCurrency(lastSoldPrice)}) is below the set price`);
      }
    }

    let action = 'Hold';
    let suggested = setPrice;
    let className = '';

    if (score >= 2) {
      action = 'Consider raising';
      suggested = setPrice + 1;
      className = 'tds-v-good';
    } else if (score <= -2) {
      action = 'Consider lowering';
      suggested = Math.max(item.costEach !== null ? item.costEach : 0, setPrice - 1);
      className = 'tds-v-bad';
    }

    return {
      action,
      suggested,
      className,
      daysLeft,
      trend,
      reason: reasons.length ? reasons.join('; ') : 'Not enough recent sales evidence to justify changing the price.'
    };
  }

  function restockRecommendation(current, sold24, sold7) {
    if (sold24 === null && sold7 === null) return null;
    const day = Math.max(0, Number(sold24) || 0);
    const week = Math.max(0, Number(sold7) || 0);
    if (day === 0 && week === 0) return { target: 0, restock: 0, baseline: 0 };

    // Use the faster of the recent one-day run-rate and the observed seven-day
    // total, then add a 20% safety buffer. This is a recommendation, not a Torn
    // API field, and is labelled DERIVED in the UI.
    const baseline = Math.max(week, day * 7);
    const target = Math.ceil(baseline * 1.20);
    const restock = current === null ? null : Math.max(0, target - Math.max(0, current));
    return { target, restock, baseline };
  }

  async function renderStockTab(panel, { refresh = false } = {}) {
    const el = panel.querySelector('[data-tabpanel="stock"]');
    if (!el) return;
    const results = state.lastResults;

    if (!results) {
      el.innerHTML = `<div class="tds-box tds-box-neutral">Run Diagnostics once so Stock Management can read your company stock.</div>`;
      return;
    }
    if (!isDirectorAccess()) {
      el.innerHTML = directorFeatureNotice('Stock Management');
      return;
    }


    const stockRaw = findRaw(results, 'company', 'stock');
    const blocked = findBlockedReason(results, 'company', 'stock');

    if (!stockRaw) {
      el.innerHTML = `<div class="tds-box tds-box-danger"><strong>Company stock unavailable.</strong> ${escapeHtml(blocked || 'No company/stock data was returned.')}</div>`;
      return;
    }

    const items = extractStockItems(stockRaw);

    if (el.hidden && !refresh) {
      el.innerHTML = `<div class="tds-box tds-box-neutral">Stock data is ready. Open this tab to load recent sales history, restock targets, margins and read-only pricing recommendations.</div>`;
      return;
    }

    if (!items.length) {
      el.innerHTML = `<div class="tds-box tds-box-warn"><strong>Stock data was returned, but no product rows could be recognised.</strong><br>The suite supports Torn's current <code>company_stock → product name → { cost, in_stock, on_order, price, rrp, sold_amount, sold_worth }</code> structure as well as older field-based shapes. If this still appears, please send the Company stock field names from Diagnostics.</div>`;
      return;
    }

    el.innerHTML = `<div class="tds-box tds-box-neutral">Loading recent sales and pricing history…</div>`;

    let sales = { totals: new Map(), parsedEvents: 0, newsEntries: 0, oldestTimestamp: null };
    let newsError = null;

    try {
      if (refresh) {
        state.stock.newsCache = null;
        state.stock.newsCacheAt = 0;
      }
      const diagnosticNews = findRaw(results, 'company', 'news');
      const newsRaw = diagnosticNews || await fetchCompanyNewsForStock();
      sales = aggregateSales(newsRaw, items);
    } catch (err) {
      newsError = err;
    }

    let html = `
      <div class="tds-box tds-box-info">
        <strong>Read-only pricing assistant:</strong> this tab does <strong>not</strong> submit prices or interact with Torn's Pricing form.
        It only analyses data Torn returns and suggests <strong>Hold / Consider raising / Consider lowering</strong>.
        Suggested prices are advisory and deliberately move only <strong>$1 at a time</strong>.
      </div>
      <div class="tds-box tds-box-info">
        <strong>Restock recommendation:</strong> target = 120% of the higher of <em>last 7 days sold</em> or <em>last 24 hours × 7</em>.
        This gives roughly one week of fast-moving stock plus a 20% buffer. Targets are <strong>DERIVED</strong>.
      </div>`;

    if (newsError) {
      html += `<div class="tds-box tds-box-warn"><strong>Item-level sales history unavailable.</strong> ${escapeHtml(newsError.reason || 'company/news could not be read with this key')}. Current stock/pricing fields returned directly by Torn are still shown.</div>`;
    } else if (!sales.parsedEvents) {
      html += `<div class="tds-box tds-box-warn">Company news was accessible (${formatNumber(sales.newsEntries)} entries inspected), but no item-sale events were recognised. Direct <code>company/stock</code> sales fields are still used where available; Last Sold Price stays unavailable rather than being guessed.</div>`;
    } else {
      const coverage = sales.oldestTimestamp ? formatTimestampRelative(sales.oldestTimestamp * 1000) : 'unknown';
      html += `<div class="tds-box tds-box-neutral">Parsed ${formatNumber(sales.parsedEvents)} stock-sale event(s) from company news. Oldest returned news: ${escapeHtml(coverage)}.</div>`;
    }

    const stockRows = items.map((item) => {
      const keyById = String(item.id || '');
      const keyByName = normalizeFieldName(item.name);
      const fromNews = sales.totals.get(keyById) || sales.totals.get(keyByName);

      const sold24 = item.sold24 !== null
        ? item.sold24
        : (fromNews ? fromNews.sold24 : (item.soldDaily !== null ? item.soldDaily : null));

      const sold7 = item.sold7 !== null
        ? item.sold7
        : (fromNews ? fromNews.sold7 : null);

      const soldDaily = item.soldDaily !== null
        ? item.soldDaily
        : (sold24 !== null ? sold24 : (sold7 !== null ? sold7 / 7 : null));

      const lastSoldPrice = fromNews?.lastSoldPrice ?? null;
      const averageSoldPrice24 =
        fromNews && fromNews.pricedUnits24 > 0
          ? fromNews.pricedRevenue24 / fromNews.pricedUnits24
          : null;

      const rec = restockRecommendation(item.current, sold24, sold7);
      const priceRec = pricingRecommendation(item, sold24, sold7, lastSoldPrice);
      const margin = stockGrossMargin(item.setPrice, item.costEach);
      const marginPct = stockMarginPercent(item.setPrice, item.costEach);
      const daysLeft = stockDaysRemaining(item.current, soldDaily);
      const risk = stockRiskStatus(daysLeft, item.current, soldDaily);
      const trend = stockSalesTrend(sold24, sold7);
      const priority = restockPriority(rec, risk, trend);

      const estDailyGross =
        margin !== null && soldDaily !== null
          ? margin * soldDaily
          : null;

      const estWeeklyGross =
        estDailyGross !== null
          ? estDailyGross * 7
          : null;

      return {
        item,
        sold24,
        sold7,
        soldDaily,
        lastSoldPrice,
        averageSoldPrice24,
        rec,
        priceRec,
        margin,
        marginPct,
        daysLeft,
        risk,
        trend,
        priority,
        estDailyGross,
        estWeeklyGross,
      };
    });

    const totalStockUnits = stockRows.reduce(
      (sum, row) => sum + (typeof row.item.current === 'number' ? Math.max(0, row.item.current) : 0),
      0
    );

    const totalInventoryRetailValue = stockRows.reduce(
      (sum, row) =>
        sum +
        (
          typeof row.item.current === 'number' &&
          typeof row.item.setPrice === 'number'
            ? Math.max(0, row.item.current) * Math.max(0, row.item.setPrice)
            : 0
        ),
      0
    );

    const estimatedDailyGrossTotal = stockRows.reduce(
      (sum, row) => sum + (typeof row.estDailyGross === 'number' ? row.estDailyGross : 0),
      0
    );

    const estimatedWeeklyGrossTotal = stockRows.reduce(
      (sum, row) => sum + (typeof row.estWeeklyGross === 'number' ? row.estWeeklyGross : 0),
      0
    );

    const restockItemCount = stockRows.filter(
      (row) => row.rec && typeof row.rec.restock === 'number' && row.rec.restock > 0
    ).length;

    const urgentStockCount = stockRows.filter(
      (row) => row.risk.priority >= 3
    ).length;

    const priceReviewCount = stockRows.filter(
      (row) => row.priceRec.action === 'Consider raising' || row.priceRec.action === 'Consider lowering'
    ).length;

    html += `
      <div class="tds-section-label">Stock intelligence</div>
      <div class="tds-stock-summary">
        <div class="tds-stock-summary-card">
          <div class="tds-stock-summary-label">Products</div>
          <div class="tds-stock-summary-value">${formatNumber(stockRows.length)}</div>
        </div>
        <div class="tds-stock-summary-card">
          <div class="tds-stock-summary-label">Units In Stock</div>
          <div class="tds-stock-summary-value">${formatNumber(totalStockUnits)}</div>
        </div>
        <div class="tds-stock-summary-card">
          <div class="tds-stock-summary-label">Retail Stock Value</div>
          <div class="tds-stock-summary-value">${formatCurrency(totalInventoryRetailValue)}</div>
        </div>
        <div class="tds-stock-summary-card">
          <div class="tds-stock-summary-label">Est. Daily Gross</div>
          <div class="tds-stock-summary-value">${formatCurrency(estimatedDailyGrossTotal)}</div>
        </div>
        <div class="tds-stock-summary-card">
          <div class="tds-stock-summary-label">Est. Weekly Gross</div>
          <div class="tds-stock-summary-value">${formatCurrency(estimatedWeeklyGrossTotal)}</div>
        </div>
        <div class="tds-stock-summary-card">
          <div class="tds-stock-summary-label">Need Restock</div>
          <div class="tds-stock-summary-value ${restockItemCount ? 'tds-v-bad' : 'tds-v-good'}">${formatNumber(restockItemCount)}</div>
        </div>
        <div class="tds-stock-summary-card">
          <div class="tds-stock-summary-label">Low / Critical</div>
          <div class="tds-stock-summary-value ${urgentStockCount ? 'tds-v-bad' : 'tds-v-good'}">${formatNumber(urgentStockCount)}</div>
        </div>
        <div class="tds-stock-summary-card">
          <div class="tds-stock-summary-label">Price Reviews</div>
          <div class="tds-stock-summary-value">${formatNumber(priceReviewCount)}</div>
        </div>
      </div>`;

    html += `<div style="overflow-x:auto;">
      <table class="tds-table tds-stock-table">
        <thead>
          <tr>
            <th>Product</th>
            <th>Cost</th>
            <th>RRP</th>
            <th>Set Price</th>
            <th>Last Sold</th>
            <th>In Stock</th>
            <th>Sold Daily</th>
            <th>Sold 24h</th>
            <th>Sold 7d</th>
            <th>Trend</th>
            <th>Stock Status</th>
            <th>Days Left</th>
            <th>Margin / Unit</th>
            <th>Est. Daily Gross</th>
            <th>Est. Weekly Gross</th>
            <th>Target Stock</th>
            <th>Restock</th>
            <th>Restock Priority</th>
            <th>Pricing</th>
            <th>Suggested</th>
          </tr>
        </thead>
        <tbody>`;

    for (const row of stockRows) {
      const {
        item,
        sold24,
        sold7,
        soldDaily,
        lastSoldPrice,
        averageSoldPrice24,
        rec,
        priceRec,
        margin,
        marginPct,
        daysLeft,
        risk,
        trend,
        priority,
        estDailyGross,
        estWeeklyGross,
      } = row;

      const restockText = rec
        ? (rec.restock === null ? '—' : formatNumber(rec.restock))
        : '—';

      const lastPriceHtml = lastSoldPrice !== null
        ? `${formatCurrency(lastSoldPrice)}${averageSoldPrice24 !== null ? `<div class="tds-v-dim">24h avg ${formatCurrency(averageSoldPrice24)}</div>` : ''}`
        : '—';

      html += `<tr>
        <td><strong>${escapeHtml(item.name)}</strong>${item.soldTotal !== null ? `<div class="tds-v-dim">Lifetime sold: ${formatNumber(item.soldTotal)}</div>` : ''}</td>
        <td>${item.costEach === null ? '—' : formatCurrency(item.costEach)}</td>
        <td>${item.rrp === null ? '—' : formatCurrency(item.rrp)}</td>
        <td><strong>${item.setPrice === null ? '—' : formatCurrency(item.setPrice)}</strong></td>
        <td>${lastPriceHtml}</td>
        <td>${item.current === null ? '—' : formatNumber(item.current)}</td>
        <td>${soldDaily === null ? '—' : formatNumber(Math.round(soldDaily))}</td>
        <td>${sold24 === null ? '—' : formatNumber(Math.round(sold24))}</td>
        <td>${sold7 === null ? '—' : formatNumber(Math.round(sold7))}</td>
        <td class="${trend.className}"><strong>${escapeHtml(trend.label)}</strong></td>
        <td class="${risk.className}"><strong>${escapeHtml(risk.label)}</strong><div class="tds-v-dim">${escapeHtml(risk.reason)}</div></td>
        <td>${daysLeft === null ? '—' : `${daysLeft.toFixed(1)}d`}</td>
        <td>${margin === null ? '—' : `${formatCurrency(margin)}${marginPct !== null ? `<div class="tds-v-dim">${marginPct.toFixed(0)}%</div>` : ''}`}</td>
        <td>${estDailyGross === null ? '—' : formatCurrency(estDailyGross)}</td>
        <td>${estWeeklyGross === null ? '—' : formatCurrency(estWeeklyGross)}</td>
        <td>${rec ? formatNumber(rec.target) : '—'}</td>
        <td><strong>${restockText}</strong></td>
        <td class="${priority.className}"><strong>${escapeHtml(priority.label)}</strong></td>
        <td class="${priceRec.className}">
          <strong>${escapeHtml(priceRec.action)}</strong>
          <div class="tds-v-dim" style="max-width:240px;white-space:normal;">${escapeHtml(priceRec.reason)}</div>
        </td>
        <td class="${priceRec.className}"><strong>${priceRec.suggested === null ? '—' : formatCurrency(priceRec.suggested)}</strong></td>
      </tr>`;
    }

    html += `</tbody></table></div>`;

    const attentionRows = [...stockRows]
      .filter((row) =>
        row.priority.score > 0 ||
        row.priceRec.action === 'Consider raising' ||
        row.priceRec.action === 'Consider lowering'
      )
      .sort((a, b) =>
        b.priority.score - a.priority.score ||
        (a.daysLeft ?? Number.POSITIVE_INFINITY) - (b.daysLeft ?? Number.POSITIVE_INFINITY)
      )
      .slice(0, 8);

    if (attentionRows.length) {
      html += `<div class="tds-section-label">Stock attention</div><div class="tds-card">`;

      for (const row of attentionRows) {
        const recText =
          row.rec && row.rec.restock > 0
            ? `Restock ${formatNumber(row.rec.restock)}`
            : 'No restock needed';

        const priceText =
          row.priceRec.action !== 'Hold'
            ? ` · ${escapeHtml(row.priceRec.action)}${row.priceRec.suggested !== null ? ` ${formatCurrency(row.priceRec.suggested)}` : ''}`
            : '';

        html += `<div class="tds-row">
          <span class="tds-row-label"><strong>${escapeHtml(row.item.name)}</strong></span>
          <span class="tds-row-value ${row.risk.className || row.priority.className}">
            ${escapeHtml(row.risk.label)} · ${recText}${priceText}
          </span>
        </div>`;
      }

      html += `</div>`;
    }

    html += `
      <div class="tds-box tds-box-neutral" style="margin-top:10px;">
        <strong>Pricing recommendation rules:</strong> recent 24h sales are compared with the 7-day daily average, stock cover is considered, RRP is used when Torn supplies it, and an observed Last Sold Price is used when it can be parsed reliably.
        A recommendation only moves one dollar from the configured price so the tool stays conservative.
      </div>
      <div style="margin-top:10px;">
        <button class="tds-btn-ghost" id="tds-stock-refresh">Refresh sales</button>
      </div>`;

    el.innerHTML = html;
    el.querySelector('#tds-stock-refresh')?.addEventListener('click', () =>
      renderStockTab(panel, { refresh: true })
    );
  }


  // =======================================================================
  // OPTIMIZE TAB — position requirement fit, not a fabricated EE formula
  // =======================================================================
  function findCompanyTypeReferenceNode(reference, typeId) {
    if (!reference || typeId === null || typeId === undefined) return null;
    const wanted = String(typeId);
    const seen = new WeakSet();
    let best = null;
    function walk(value) {
      if (best || !value || typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);
      if (!Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, wanted)) {
        const candidate = value[wanted];
        if (candidate && typeof candidate === 'object') { best = candidate; return; }
      }
      if (!Array.isArray(value)) {
        const id = findValueDeep(value, ['id', 'type_id', 'company_type']);
        if (id !== null && String(id) === wanted) { best = value; return; }
      }
      for (const child of Object.values(value)) {
        if (child && typeof child === 'object') walk(child);
        if (best) return;
      }
    }
    walk(reference);
    return best;
  }

  function extractPositionRequirements(reference, typeId) {
    const root = findCompanyTypeReferenceNode(reference, typeId) || reference;
    if (!root) return [];
    const positions = [];
    const seen = new Set();
    for (const { value, path } of deepObjectEntries(root)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const name = pickText(value, ['name', 'position', 'position_name', 'title']) || (path.length ? path[path.length - 1] : null);
      const manual = pickNumeric(value, ['manual_labor', 'manual', 'man_required', 'manual_required', 'man']);
      const intelligence = pickNumeric(value, ['intelligence', 'int_required', 'intelligence_required', 'int']);
      const endurance = pickNumeric(value, ['endurance', 'end_required', 'endurance_required', 'end']);
      const special = pickText(value, [
        'special', 'special_role', 'specialRole', 'role_special',
        'effect', 'position_special', 'positionSpecial'
      ]);
      const statCount = [manual, intelligence, endurance].filter((v) => v !== null && v > 0).length;
      if (!name || statCount < 1) continue;
      const key = normalizeFieldName(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      positions.push({
        name: String(name),
        manual,
        intelligence,
        endurance,
        special: special && !/^none$/i.test(String(special)) ? String(special) : null
      });
    }
    return positions;
  }

  function employeePositionFit(emp, position) {
    const actual = {
      manual: numericValue(emp.manual_labor) ?? 0,
      intelligence: numericValue(emp.intelligence) ?? 0,
      endurance: numericValue(emp.endurance) ?? 0,
    };
    const req = { manual: position.manual, intelligence: position.intelligence, endurance: position.endurance };
    const ratios = [];
    let shortfall = 0;
    let requiredCount = 0;
    for (const key of Object.keys(req)) {
      if (req[key] === null || req[key] <= 0) continue;
      requiredCount += 1;
      const ratio = actual[key] / req[key];
      ratios.push(Math.min(1, ratio));
      shortfall += Math.max(0, req[key] - actual[key]) / req[key];
    }
    if (!requiredCount) return null;
    const coverage = Math.round((ratios.reduce((a, b) => a + b, 0) / requiredCount) * 100);
    return { coverage, shortfall, requiredCount };
  }

  // Official Torn work-stat efficiency formula, applied once per required
  // position stat. Company positions normally use a primary + secondary stat.
  // Exact requirement on both stats therefore gives 90 Working Stats EE.
  function calculatePositionWorkingStats(emp, position) {
    const actual = {
      manual: numericValue(emp.manual_labor) ?? 0,
      intelligence: numericValue(emp.intelligence) ?? 0,
      endurance: numericValue(emp.endurance) ?? 0,
    };
    const req = {
      manual: numericValue(position.manual),
      intelligence: numericValue(position.intelligence),
      endurance: numericValue(position.endurance),
    };

    let total = 0;
    let used = 0;
    for (const key of Object.keys(req)) {
      const required = req[key];
      if (required === null || required <= 0) continue;

      const stat = Math.max(0, actual[key] || 0);
      const ratio = stat / required;
      const base = Math.min(45, 45 * ratio);
      const overRequirement = ratio > 0 ? Math.max(0, 5 * Math.log2(ratio)) : 0;

      total += Math.floor(base + overRequirement);
      used += 1;
    }

    return used ? total : null;
  }

  function estimateEffectivenessAtPosition(emp, ee, position) {
    const workingStats = calculatePositionWorkingStats(emp, position);
    if (workingStats === null) return null;

    // Everything except Working Stats is retained from Torn's current Total EE.
    // This automatically preserves Settled In, Director Education, Merits,
    // Addiction, inactivity adjustments, and any future components Torn may add
    // without us needing to guess each field individually.
    const currentWorking = typeof ee?.workingStats === 'number' ? ee.workingStats : null;
    const currentTotal = typeof ee?.total === 'number' ? ee.total : null;
    const nonPositionAdjustment =
      currentWorking !== null && currentTotal !== null
        ? currentTotal - currentWorking
        : 0;

    return {
      workingStats,
      total: workingStats + nonPositionAdjustment,
      nonPositionAdjustment,
    };
  }

  function buildEmployeePositionMatrix(employees, positions) {
    return employees.map((employee) => {
      const ee = getEmployeeEffectiveness(employee.raw);

      const cells = positions.map((position) => {
        const fit = employeePositionFit(employee.raw, position);
        const estimate = estimateEffectivenessAtPosition(employee.raw, ee, position);

        return {
          position,
          fit,
          estimate,
        };
      });

      const ranked = cells
        .filter((cell) => cell.estimate && typeof cell.estimate.total === 'number')
        .sort((a, b) =>
          b.estimate.total - a.estimate.total ||
          (b.fit?.coverage ?? 0) - (a.fit?.coverage ?? 0)
        );

      const best = ranked[0] || null;

      return {
        employee,
        ee,
        cells,
        best,
      };
    });
  }

  function specialPositionEffect(special) {
    const key = String(special || '').toLowerCase();

    if (key === 'cleaner') {
      return 'Helps maintain company environment.';
    }
    if (key === 'manager') {
      return 'Increases the effectiveness of underperforming employees.';
    }
    if (key === 'marketer') {
      return 'Increases the effectiveness of the advertising budget.';
    }
    if (key === 'secretary') {
      return 'Shows detailed employee earnings / sales contribution.';
    }
    if (key === 'trainer') {
      return 'Generates additional company trains based on trainer effectiveness.';
    }

    return null;
  }

  function inferSpecialPosition(positionName, typeId = null, typeName = null) {
    const rawName = String(positionName || '').trim();
    const name = normalizeFieldName(rawName);
    const companyName = normalizeFieldName(typeName || '');

    // First use role names that directly identify Torn's universal special
    // positions. These work across company types.
    const exactGeneric = new Map([
      ['cleaner', 'Cleaner'],
      ['janitor', 'Cleaner'],
      ['kitchenassistant', 'Cleaner'],

      ['manager', 'Manager'],
      ['storemanager', 'Manager'],
      ['linemanager', 'Manager'],
      ['leaddeveloper', 'Manager'],
      ['headchef', 'Manager'],
      ['supervisor', 'Manager'],
      ['teamleader', 'Manager'],
      ['bosun', 'Manager'],

      ['marketer', 'Marketer'],
      ['marketingmanager', 'Marketer'],
      ['marketingexecutive', 'Marketer'],
      ['photographer', 'Marketer'],
      ['spokesperson', 'Marketer'],

      ['secretary', 'Secretary'],
      ['receptionist', 'Secretary'],
      ['accountant', 'Secretary'],
      ['bookkeeper', 'Secretary'],
      ['officeclerk', 'Secretary'],
      ['companyliaison', 'Secretary'],
      ['analyst', 'Secretary'],

      ['trainer', 'Trainer'],
      ['trainingadvisor', 'Trainer'],
      ['trainingadviser', 'Trainer'],
      ['consultant', 'Trainer'],
      ['specialist', 'Trainer'],
      ['teacher', 'Trainer'],
      ['defenceconsultant', 'Trainer'],
    ]);

    if (exactGeneric.has(name)) return exactGeneric.get(name);

    // Some titles are company-type specific and cannot safely be inferred from
    // their words alone. Keep explicit fallbacks for known official Torn role
    // tables when the API omits the Special field.
    const isAdultNovelties =
      Number(typeId) === 10 ||
      companyName === 'adultnovelties';

    if (isAdultNovelties) {
      const adultNovelties = new Map([
        ['humanresources', 'Trainer'],
        ['hrofficer', 'Trainer'],
        ['storemanager', 'Manager'],
        ['marketingmanager', 'Marketer'],
        ['receptionist', 'Secretary'],
        ['cleaner', 'Cleaner'],
        ['sexpert', null],
        ['salesassistant', null],
      ]);

      if (adultNovelties.has(name)) return adultNovelties.get(name);
    }

    return null;
  }

  function resolvePositionSpecial(position, typeId = null, typeName = null) {
    if (position?.special && !/^none$/i.test(String(position.special))) {
      return String(position.special);
    }

    return inferSpecialPosition(position?.name, typeId, typeName);
  }

  function classifyCompanyRole(position) {
    const name = String(position?.name || '');
    const special = String(position?.resolvedSpecial || position?.special || '');

    const reasons = [];
    let level = 'standard';
    let score = 0;

    // Revenue-facing roles are important because removing all employees from
    // them can leave the company with nobody assigned to the obvious selling /
    // customer-facing function. This is a management heuristic, not an API flag.
    if (/\b(sales?|salesperson|sales assistant|cashier|seller|retail)\b/i.test(name)) {
      score += 4;
      level = 'core';
      reasons.push('revenue / sales role');
    }

    // Torn exposes special position functions on company role reference data.
    // These are operationally meaningful support functions but are not claimed
    // here as mandatory unless Torn ever exposes such a flag.
    if (special) {
      if (/manager/i.test(special)) {
        score += 3;
        if (level !== 'core') level = 'important';
        reasons.push(`special: ${special}`);
      } else if (/cleaner/i.test(special)) {
        score += 2;
        if (level === 'standard') level = 'important';
        reasons.push(`special: ${special}`);
      } else if (/secretary/i.test(special)) {
        score += 2;
        if (level === 'standard') level = 'important';
        reasons.push(`special: ${special}`);
      } else if (/marketer/i.test(special)) {
        score += 2;
        if (level === 'standard') level = 'important';
        reasons.push(`special: ${special}`);
      } else if (/trainer/i.test(special)) {
        score += 1;
        if (level === 'standard') level = 'support';
        reasons.push(`special: ${special}`);
      } else {
        score += 1;
        if (level === 'standard') level = 'support';
        reasons.push(`special: ${special}`);
      }
    }

    return { level, score, reasons };
  }

  function analyseCompanyRoles(positions, matrix) {
    const currentCounts = countEmployeesByPosition(matrix, false);

    const roles = positions.map((position) => {
      const classification = classifyCompanyRole(position);
      return {
        position,
        classification,
        current: currentCounts.get(position.name) || 0,
      };
    });

    const operational = roles
      .filter((role) =>
        role.classification.level === 'core' ||
        role.classification.level === 'important'
      )
      .sort((a, b) =>
        b.classification.score - a.classification.score ||
        String(a.position.name).localeCompare(String(b.position.name))
      );

    return { roles, operational };
  }

  function countEmployeesByPosition(matrix, useBest = false) {
    const counts = new Map();

    for (const row of matrix) {
      const positionName = useBest
        ? row.best?.position?.name
        : row.employee?.position;

      if (!positionName) continue;

      counts.set(
        positionName,
        (counts.get(positionName) || 0) + 1
      );
    }

    return counts;
  }

  function buildPositionBalanceWarnings(matrix, positions) {
    const currentCounts = countEmployeesByPosition(matrix, false);
    const projectedCounts = countEmployeesByPosition(matrix, true);

    const warnings = [];

    for (const position of positions) {
      const name = position.name;
      const current = currentCounts.get(name) || 0;
      const projected = projectedCounts.get(name) || 0;

      if (current > 0 && projected === 0) {
        warnings.push({
          severity: 3,
          position: name,
          current,
          projected,
          text: `${name} would drop from ${current} employee${current === 1 ? '' : 's'} to 0.`
        });
      } else if (current >= 2 && projected < Math.ceil(current / 2)) {
        warnings.push({
          severity: 2,
          position: name,
          current,
          projected,
          text: `${name} would fall from ${current} to ${projected}.`
        });
      }
    }

    // Dynamically flag loss of operationally important roles based on the
    // company type's actual position list and special-function metadata.
    for (const position of positions) {
      const classification = classifyCompanyRole(position);

      if (
        classification.level !== 'core' &&
        classification.level !== 'important'
      ) {
        continue;
      }

      const current = currentCounts.get(position.name) || 0;
      const projected = projectedCounts.get(position.name) || 0;

      if (current > 0 && projected < current) {
        const already = warnings.some((w) => w.position === position.name);

        if (!already) {
          warnings.push({
            severity: projected === 0 ? 3 : 2,
            position: position.name,
            current,
            projected,
            text: `${position.name} would fall from ${current} to ${projected}; this role is classified as operationally important${position.resolvedSpecial ? ` (${position.resolvedSpecial})` : ''}.`
          });
        }
      }
    }

    warnings.sort((a, b) =>
      b.severity - a.severity ||
      b.current - a.current ||
      String(a.position).localeCompare(String(b.position))
    );

    return {
      currentCounts,
      projectedCounts,
      warnings
    };
  }

  const CORE_CAPACITY_RETAIN_RATIO = 0.85;
  const IMPORTANT_CAPACITY_RETAIN_RATIO = 0.70;
  const STAGED_MOVE_LIMIT = 3;

  function employeeRoleCapacity(row, positionName) {
    const cell = findMatrixCell(row, positionName);
    const estimated = cell?.estimate?.total;

    if (typeof estimated === 'number' && Number.isFinite(estimated)) {
      return Math.max(0, estimated);
    }

    const current = row.ee?.total;
    return typeof current === 'number' && Number.isFinite(current)
      ? Math.max(0, current)
      : 0;
  }

  function calculateRoleCapacity(matrix, positionName, assignments = null) {
    let total = 0;

    if (assignments) {
      for (const assignment of assignments) {
        if (assignment.assignedPosition !== positionName) continue;
        total += employeeRoleCapacity(assignment.row, positionName);
      }
      return total;
    }

    for (const row of matrix) {
      if (row.employee.position !== positionName) continue;
      total += employeeRoleCapacity(row, positionName);
    }

    return total;
  }

  function roleCapacityRules(positions, matrix, coreRetainRatio = CORE_CAPACITY_RETAIN_RATIO) {
    const rules = new Map();

    for (const position of positions) {
      const classification = classifyCompanyRole(position);
      const currentCapacity = calculateRoleCapacity(matrix, position.name);
      const currentCount = matrix.filter(
        (row) => row.employee.position === position.name
      ).length;

      let retainRatio = 0;

      if (classification.level === 'core' && currentCount > 0) {
        retainRatio = coreRetainRatio;
      } else if (classification.level === 'important' && currentCount > 0) {
        retainRatio = IMPORTANT_CAPACITY_RETAIN_RATIO;
      }

      rules.set(position.name, {
        position,
        classification,
        currentCapacity,
        currentCount,
        retainRatio,
        minimumCapacity: currentCapacity * retainRatio,
      });
    }

    return rules;
  }

  function buildCoverageMinimums(positions, matrix) {
    const currentCounts = countEmployeesByPosition(matrix, false);
    const minimums = new Map();

    for (const position of positions) {
      const classification = classifyCompanyRole(position);
      const current = currentCounts.get(position.name) || 0;

      let minimum = 0;

      // Core sales/revenue roles are protected at their current staffing level
      // so the optimiser never "improves EE" by stripping the company's sales floor.
      if (classification.level === 'core' && current > 0) {
        minimum = current;
      }
      // Other operationally important roles keep at least one employee if
      // currently staffed.
      else if (classification.level === 'important' && current > 0) {
        minimum = 1;
      }

      minimums.set(position.name, minimum);
    }

    return { currentCounts, minimums };
  }

  function findMatrixCell(row, positionName) {
    return row.cells.find((cell) => cell.position.name === positionName) || null;
  }

  function optimiseCompanyAssignments(
    matrix,
    positions,
    coreRetainRatio = CORE_CAPACITY_RETAIN_RATIO
  ) {
    const capacityRules = roleCapacityRules(
      positions,
      matrix,
      coreRetainRatio
    );
    const currentCounts = countEmployeesByPosition(matrix, false);

    const assignments = matrix.map((row) => {
      const currentCell = findMatrixCell(row, row.employee.position);
      const currentEstimated =
        currentCell?.estimate?.total ??
        row.ee?.total ??
        null;

      return {
        row,
        currentPosition: row.employee.position,
        assignedPosition: row.employee.position,
        currentEE: typeof row.ee?.total === 'number' ? row.ee.total : currentEstimated,
        assignedEE: currentEstimated,
      };
    });

    function projectedRoleCapacity(positionName, simulatedAssignments = assignments) {
      return calculateRoleCapacity(matrix, positionName, simulatedAssignments);
    }

    function canMoveWithCapacity(assignment, targetPosition) {
      const source = assignment.assignedPosition;
      if (!source || source === targetPosition) return false;

      const sourceRule = capacityRules.get(source);

      // Standard/support roles have no protected-capacity floor.
      if (!sourceRule || sourceRule.retainRatio <= 0) return true;

      const sourceCapacityBefore = projectedRoleCapacity(source);
      const leavingCapacity = employeeRoleCapacity(assignment.row, source);
      const sourceCapacityAfter = Math.max(0, sourceCapacityBefore - leavingCapacity);

      return sourceCapacityAfter + 1e-9 >= sourceRule.minimumCapacity;
    }

    const appliedMoves = [];
    const movedEmployees = new Set();

    // Conservative greedy optimisation: choose the largest positive EE move
    // that does not push a protected role below its retained-capacity floor.
    while (true) {
      let bestMove = null;

      for (const assignment of assignments) {
        if (movedEmployees.has(String(assignment.row.employee.id))) continue;

        for (const cell of assignment.row.cells) {
          const target = cell.position.name;
          const targetEE = cell.estimate?.total;

          if (typeof targetEE !== 'number') continue;
          if (!canMoveWithCapacity(assignment, target)) continue;
          if (typeof assignment.assignedEE !== 'number') continue;

          const gain = targetEE - assignment.assignedEE;
          if (gain <= 0) continue;

          if (
            !bestMove ||
            gain > bestMove.gain ||
            (
              gain === bestMove.gain &&
              (cell.fit?.coverage ?? 0) > (bestMove.cell.fit?.coverage ?? 0)
            )
          ) {
            bestMove = { assignment, cell, gain };
          }
        }
      }

      if (!bestMove) break;

      const assignment = bestMove.assignment;
      const from = assignment.assignedPosition;
      const to = bestMove.cell.position.name;

      assignment.assignedPosition = to;
      assignment.assignedEE = bestMove.cell.estimate.total;
      movedEmployees.add(String(assignment.row.employee.id));

      appliedMoves.push({
        employee: assignment.row.employee,
        from,
        to,
        currentEE: assignment.currentEE,
        newEE: assignment.assignedEE,
        gain: bestMove.gain,
        fit: bestMove.cell.fit,
      });
    }

    const projectedCounts = new Map();
    for (const assignment of assignments) {
      const role = assignment.assignedPosition;
      projectedCounts.set(role, (projectedCounts.get(role) || 0) + 1);
    }

    const currentTotalEE = assignments.reduce(
      (sum, assignment) =>
        sum + (typeof assignment.currentEE === 'number' ? assignment.currentEE : 0),
      0
    );

    const projectedTotalEE = assignments.reduce(
      (sum, assignment) =>
        sum + (typeof assignment.assignedEE === 'number' ? assignment.assignedEE : 0),
      0
    );

    const protectedRoles = positions
      .map((position) => {
        const rule = capacityRules.get(position.name);
        const currentCapacity = rule?.currentCapacity ?? 0;
        const projectedCapacity = projectedRoleCapacity(position.name);

        return {
          position,
          retainRatio: rule?.retainRatio ?? 0,
          minimumCapacity: rule?.minimumCapacity ?? 0,
          currentCapacity,
          projectedCapacity,
          capacityRetained:
            currentCapacity > 0
              ? (projectedCapacity / currentCapacity) * 100
              : null,
          current: currentCounts.get(position.name) || 0,
          projected: projectedCounts.get(position.name) || 0,
        };
      })
      .filter((row) => row.retainRatio > 0);

    const stagedMoves = appliedMoves.slice(0, STAGED_MOVE_LIMIT);

    return {
      assignments,
      appliedMoves,
      stagedMoves,
      currentTotalEE,
      projectedTotalEE,
      totalGain: projectedTotalEE - currentTotalEE,
      currentCounts,
      projectedCounts,
      protectedRoles,
      capacityRules,
    };
  }

  async function renderOptimizeTab(panel) {
    const el = panel.querySelector('[data-tabpanel="optimize"]');
    if (!el) return;
    const results = state.lastResults;

    if (!results) {
      el.innerHTML = `<div class="tds-box tds-box-neutral">Run Diagnostics once so Employee Effectiveness can read employee working stats and position requirements.</div>`;
      return;
    }

    const employees = extractEmployeesEntries(findRaw(results, 'company', 'employees'));
    const profile = findRaw(results, 'company', 'profile');
    const reference = findRaw(results, 'torn', 'companies');
    const typeId = numericValue(findValueDeep(profile, ['company_type', 'type_id', 'type']));
    let positions = extractPositionRequirements(reference, typeId);
    const typeName = resolveCompanyTypeName(reference, typeId);

    positions = positions.map((position) => ({
      ...position,
      resolvedSpecial: resolvePositionSpecial(position, typeId, typeName),
    }));

    let html = `<div class="tds-box tds-box-info">
      <strong>Employee Effectiveness:</strong> current Total EE and any explicitly returned EE Merit contribution are Torn values.
      Position estimates change only the position-dependent Working Stats component and retain the employee's current non-position EE adjustment, including EE Merits when Torn supplies them.
      All recommendations are advisory only.
    </div>`;

    if (!employees.length) {
      el.innerHTML = html + `<div class="tds-box tds-box-danger">No employee data is available.</div>`;
      return;
    }

    if (!positions.length) {
      el.innerHTML = html + `<div class="tds-box tds-box-warn">No reliable position requirement data was found for this company type, so a position matrix cannot be calculated safely.</div>`;
      return;
    }

    const matrix = buildEmployeePositionMatrix(employees, positions);
    const roleAnalysis = analyseCompanyRoles(positions, matrix);
    const balance = buildPositionBalanceWarnings(matrix, positions);

    let optimizerHistory = [];
    try {
      optimizerHistory = await getDailyPerformanceHistory();
    } catch (err) {
      console.warn('[TDS] Adaptive optimiser history unavailable:', err);
    }

    const adaptiveAnalysis = analyseSalesEEPerformance(optimizerHistory);
    const optimizer = optimiseCompanyAssignments(
      matrix,
      positions,
      adaptiveAnalysis.adaptiveFloor
    );

    html += `<div class="tds-section-label">Company roles</div>`;

    html += `<div class="tds-box tds-box-info">
      <strong>Available roles for this company type:</strong>
      ${formatNumber(positions.length)} role${positions.length === 1 ? '' : 's'} detected dynamically from Torn's company-type reference data.
    </div>`;

    html += `<div style="overflow-x:auto;">
      <table class="tds-table tds-optimize-table">
        <thead>
          <tr>
            <th>Role</th>
            <th>Current Staff</th>
            <th>Special Function</th>
            <th>Special Effect</th>
            <th>Operational Classification</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>`;

    for (const role of roleAnalysis.roles) {
      const cls =
        role.classification.level === 'core'
          ? 'tds-v-good'
          : role.classification.level === 'important'
            ? ''
            : 'tds-v-dim';

      const label =
        role.classification.level === 'core'
          ? 'Core'
          : role.classification.level === 'important'
            ? 'Important'
            : role.classification.level === 'support'
              ? 'Support'
              : 'Standard';

      html += `<tr>
        <td><strong>${escapeHtml(role.position.name)}</strong></td>
        <td>${formatNumber(role.current)}</td>
        <td>${role.position.resolvedSpecial ? escapeHtml(role.position.resolvedSpecial) : 'None'}</td>
        <td>${role.position.resolvedSpecial
          ? escapeHtml(specialPositionEffect(role.position.resolvedSpecial) || 'Special effect recognised, description unavailable.')
          : 'No special position effect'}</td>
        <td class="${cls}"><strong>${label}</strong></td>
        <td>${role.classification.reasons.length
          ? escapeHtml(role.classification.reasons.join(', '))
          : 'No special operational marker detected'}</td>
      </tr>`;
    }

    html += `</tbody></table></div>`;

    html += `<div class="tds-section-label">Operationally important roles</div>`;

    if (!roleAnalysis.operational.length) {
      html += `<div class="tds-box tds-box-neutral">
        No role in this company type was automatically classified as Core / Important.
        The script will therefore rely on current staffing-balance warnings rather than inventing an essential-role requirement.
      </div>`;
    } else {
      html += `<div class="tds-card">`;

      for (const role of roleAnalysis.operational) {
        const classification =
          role.classification.level === 'core'
            ? 'Core'
            : 'Important';

        html += `<div class="tds-row">
          <span class="tds-row-label">
            <strong>${escapeHtml(role.position.name)}</strong>
            ${role.position.resolvedSpecial ? `<span class="tds-v-dim"> · ${escapeHtml(role.position.resolvedSpecial)}</span>` : ''}
          </span>
          <span class="tds-row-value">
            ${classification} · ${formatNumber(role.current)} currently assigned
          </span>
        </div>`;
      }

      html += `</div>`;
    }

    html += `<div class="tds-box tds-box-neutral" style="margin-top:10px;">
      <strong>About role specials:</strong> the suite uses the Special value from Torn's company reference data when it is present.
      If Torn omits that field, it falls back to known Torn special-position mappings for recognised role titles/company types.
      Roles with no Torn special are shown as <strong>None</strong>.
      Operationally Important is still a management classification, not an official mandatory-staffing flag.
    </div>`;

    html += `<div class="tds-box tds-box-warn">
      <strong>Important — position capacity & company balance:</strong>
      the recommendations below evaluate each employee <strong>individually</strong>.
      Moving everyone to their personal “Best Position” can leave important roles understaffed or completely empty.
      Treat the matrix as a decision aid, not a one-click staffing plan.
    </div>`;

    html += `<div class="tds-balance-grid">
      <div class="tds-balance-card">
        <div class="tds-balance-title">Current → Recommended Headcount</div>`;

    for (const position of positions) {
      const current = balance.currentCounts.get(position.name) || 0;
      const projected = balance.projectedCounts.get(position.name) || 0;

      if (current === 0 && projected === 0) continue;

      const cls =
        projected < current
          ? 'tds-v-bad'
          : projected > current
            ? 'tds-v-good'
            : '';

      html += `<div class="tds-balance-row">
        <span>${escapeHtml(position.name)}</span>
        <span class="${cls}"><strong>${current} → ${projected}</strong></span>
      </div>`;
    }

    html += `</div>`;

    html += `<div class="tds-balance-card">
      <div class="tds-balance-title">Potential Staffing Risks</div>`;

    if (!balance.warnings.length) {
      html += `<div class="tds-v-good">No obvious role-collapse risk detected from the individual recommendations.</div>`;
    } else {
      for (const warning of balance.warnings) {
        html += `<div style="margin-bottom:6px;" class="tds-v-bad">
          ⚠ ${escapeHtml(warning.text)}
        </div>`;
      }
    }

    html += `<div class="tds-v-dim" style="margin-top:8px;">
      This warning checks current vs individually recommended headcount only.
      It does not yet know minimum staffing requirements or position-capacity rules.
    </div></div></div>`;

    html += `<div class="tds-section-label">Performance evidence</div>`;
    html += `<div id="tds-performance-evidence"><div class="tds-box tds-box-neutral">Loading local performance history…</div></div>`;

    html += `<div class="tds-section-label">Whole-company balanced optimiser</div>`;

    html += `<div class="tds-box tds-box-info">
      This optimiser starts from the current team and only recommends positive-EE moves that preserve protected <strong>role capacity</strong>.
      Core sales/revenue roles currently retain at least <strong>${(adaptiveAnalysis.adaptiveFloor * 100).toFixed(0)}%</strong> of estimated EE capacity
      (${adaptiveAnalysis.adaptive ? 'evidence-informed from this company\'s paired history' : 'default safety floor'});
      other Important roles retain at least <strong>70%</strong>.
      These are management safeguards, not official Torn staffing rules.
    </div>`;

    html += `<div class="tds-optimizer-summary">
      <div class="tds-optimizer-card">
        <div class="tds-optimizer-label">Current Total EE</div>
        <div class="tds-optimizer-value">${formatNumber(optimizer.currentTotalEE)}</div>
      </div>
      <div class="tds-optimizer-card">
        <div class="tds-optimizer-label">Projected Total EE</div>
        <div class="tds-optimizer-value">${formatNumber(optimizer.projectedTotalEE)}</div>
      </div>
      <div class="tds-optimizer-card">
        <div class="tds-optimizer-label">Potential Gain</div>
        <div class="tds-optimizer-value ${optimizer.totalGain > 0 ? 'tds-v-good' : ''}">
          ${optimizer.totalGain > 0 ? '+' : ''}${formatNumber(optimizer.totalGain)}
        </div>
      </div>
      <div class="tds-optimizer-card">
        <div class="tds-optimizer-label">Suggested Moves</div>
        <div class="tds-optimizer-value">${formatNumber(optimizer.appliedMoves.length)}</div>
      </div>
      <div class="tds-optimizer-card">
        <div class="tds-optimizer-label">Evidence Confidence</div>
        <div class="tds-optimizer-value">${escapeHtml(adaptiveEvidenceConfidence(adaptiveAnalysis))}</div>
      </div>
    </div>`;

    if (optimizer.protectedRoles.length) {
      html += `<div class="tds-box tds-box-neutral" style="margin-top:10px;"><strong>EE Capacity:</strong> Capacity values are Employee Effectiveness (EE) points, not revenue or customer capacity. The optimiser totals the estimated EE points assigned to each protected operational role and uses that total as a staffing-strength safety check.</div>`;
      html += `<div class="tds-section-label">Protected role EE capacity</div><div class="tds-card">`;

      for (const role of optimizer.protectedRoles) {
        html += `<div class="tds-row">
          <span class="tds-row-label"><strong>${escapeHtml(role.position.name)}</strong></span>
          <span class="tds-row-value">
            Staff ${formatNumber(role.current)} → ${formatNumber(role.projected)}
            · EE Capacity ${formatNumber(Math.round(role.currentCapacity))} → ${formatNumber(Math.round(role.projectedCapacity))} points
            · ${role.capacityRetained !== null ? `${role.capacityRetained.toFixed(1)}% EE retained` : '—'}
            · Safety Floor ${(role.retainRatio * 100).toFixed(0)}%
          </span>
        </div>`;
      }

      html += `</div>`;
    }

    if (!optimizer.appliedMoves.length) {
      html += `<div class="tds-box tds-box-neutral">
        No positive-EE moves were found that improve the team while preserving the protected operational coverage rules.
      </div>`;
    } else {
      html += `<div style="overflow-x:auto;">
        <table class="tds-table tds-optimize-table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Current Role</th>
              <th>Balanced Recommendation</th>
              <th>EE Merits</th>
              <th>Current EE</th>
              <th>Projected EE</th>
              <th>Gain</th>
              <th>Fit</th>
            </tr>
          </thead>
          <tbody>`;

      for (const move of optimizer.appliedMoves) {
        html += `<tr>
          <td><strong>${escapeHtml(move.employee.name)}</strong></td>
          <td>${escapeHtml(move.from || '—')}</td>
          <td class="tds-v-good"><strong>${escapeHtml(move.to)}</strong></td>
          <td>${formatEEMerits(move.employee.raw)}</td>
          <td>${typeof move.currentEE === 'number' ? formatNumber(move.currentEE) : '—'}</td>
          <td>${typeof move.newEE === 'number' ? formatNumber(move.newEE) : '—'}</td>
          <td class="tds-v-good"><strong>+${formatNumber(move.gain)}</strong></td>
          <td>${move.fit ? `${move.fit.coverage}%` : '—'}</td>
        </tr>`;
      }

      html += `</tbody></table></div>`;
    }

    html += `<div class="tds-section-label">Staged recommendation</div>`;

    if (!optimizer.stagedMoves.length) {
      html += `<div class="tds-box tds-box-neutral">
        No safe positive-EE moves are currently recommended under the capacity-retention rules.
      </div>`;
    } else {
      html += `<div class="tds-box tds-box-info">
        Apply these moves first, then reassess after the next company performance update before applying additional moves.
        This reduces the risk of making several staffing changes at once without observing their effect on customers/revenue.
      </div><div class="tds-card">`;

      optimizer.stagedMoves.forEach((move, index) => {
        html += `<div class="tds-row">
          <span class="tds-row-label">
            <strong>Phase ${index + 1}: ${escapeHtml(move.employee.name)}</strong>
          </span>
          <span class="tds-row-value tds-v-good">
            ${escapeHtml(move.from)} → ${escapeHtml(move.to)}
            · +${formatNumber(move.gain)} EE
          </span>
        </div>`;
      });

      html += `</div>`;
    }

    html += `<div class="tds-section-label">Recommended company layout</div>`;

    const finalAssignments = [...optimizer.assignments].sort((a, b) => {
      const aMove = a.assignedPosition !== a.currentPosition ? 1 : 0;
      const bMove = b.assignedPosition !== b.currentPosition ? 1 : 0;

      return (
        bMove - aMove ||
        String(a.assignedPosition || '').localeCompare(String(b.assignedPosition || '')) ||
        String(a.row.employee.name).localeCompare(String(b.row.employee.name))
      );
    });

    html += `<div style="overflow-x:auto;">
      <table class="tds-table tds-optimize-table">
        <thead>
          <tr>
            <th>Employee</th>
            <th>Current Role</th>
            <th>Recommended Role</th>
            <th>Action</th>
            <th>EE Merits</th>
            <th>Current EE</th>
            <th>Projected EE</th>
            <th>Change</th>
          </tr>
        </thead>
        <tbody>`;

    for (const assignment of finalAssignments) {
      const isMove = assignment.assignedPosition !== assignment.currentPosition;
      const change =
        typeof assignment.currentEE === 'number' &&
        typeof assignment.assignedEE === 'number'
          ? assignment.assignedEE - assignment.currentEE
          : null;

      const actionClass = isMove ? 'tds-v-good' : '';
      const changeClass =
        change === null
          ? ''
          : change > 0
            ? 'tds-v-good'
            : change < 0
              ? 'tds-v-bad'
              : '';

      html += `<tr data-employee-id="${escapeHtml(String(assignment.row.employee.id))}" data-employee-name="${escapeHtml(String(assignment.row.employee.name))}">
        <td><strong class="tds-employee-profile-link" data-employee-profile data-employee-id="${escapeHtml(String(assignment.row.employee.id))}" data-employee-name="${escapeHtml(String(assignment.row.employee.name))}" title="Open employee summary">${escapeHtml(assignment.row.employee.name)}</strong></td>
        <td>${escapeHtml(assignment.currentPosition || '—')}</td>
        <td class="${isMove ? 'tds-v-good' : ''}"><strong>${escapeHtml(assignment.assignedPosition || '—')}</strong></td>
        <td class="${actionClass}"><strong>${isMove ? 'MOVE' : 'KEEP'}</strong></td>
        <td>${formatEEMerits(assignment.row.employee.raw)}</td>
        <td>${typeof assignment.currentEE === 'number' ? formatNumber(assignment.currentEE) : '—'}</td>
        <td>${typeof assignment.assignedEE === 'number' ? formatNumber(assignment.assignedEE) : '—'}</td>
        <td class="${changeClass}">
          <strong>${change === null ? '—' : `${change > 0 ? '+' : ''}${formatNumber(change)}`}</strong>
        </td>
      </tr>`;
    }

    html += `</tbody></table></div>`;

    html += `<div class="tds-section-label">Role headcount plan</div><div class="tds-card">`;

    for (const position of positions) {
      const current = optimizer.currentCounts.get(position.name) || 0;
      const projected = optimizer.projectedCounts.get(position.name) || 0;

      if (current === 0 && projected === 0) continue;

      const cls =
        projected < current
          ? 'tds-v-bad'
          : projected > current
            ? 'tds-v-good'
            : '';

      html += `<div class="tds-row">
        <span class="tds-row-label"><strong>${escapeHtml(position.name)}</strong></span>
        <span class="tds-row-value ${cls}">
          ${formatNumber(current)} → ${formatNumber(projected)}
        </span>
      </div>`;
    }

    html += `</div>`;

    const moveCount = finalAssignments.filter(
      (assignment) => assignment.assignedPosition !== assignment.currentPosition
    ).length;
    const keepCount = finalAssignments.length - moveCount;

    html += `<div class="tds-box tds-box-neutral" style="margin-top:10px;">
      <strong>Plan summary:</strong>
      ${formatNumber(moveCount)} employee${moveCount === 1 ? '' : 's'} to move,
      ${formatNumber(keepCount)} to keep in their current role.
      This is the complete staffing layout produced by the balanced optimiser.
    </div>`;

    html += `<div class="tds-box tds-box-warn" style="margin-top:10px;">
      <strong>Do not move everyone from the Individual Best table.</strong>
      Use the <strong>Recommended Company Layout</strong> above for company-wide staffing decisions.
      The Individual Best table remains useful for understanding each employee's personal ceiling.
    </div>`;

    // Existing recommendation summary
    const rows = [...matrix].sort((a, b) => {
      const av = typeof a.ee?.total === 'number' ? a.ee.total : Number.POSITIVE_INFINITY;
      const bv = typeof b.ee?.total === 'number' ? b.ee.total : Number.POSITIVE_INFINITY;
      return av - bv;
    });

    html += `<div class="tds-section-label">Recommended positions — individual best</div>`;
    html += `<div style="overflow-x:auto;">
      <table class="tds-table tds-optimize-table">
        <thead>
          <tr>
            <th>Employee</th>
            <th>Current Position</th>
            <th>EE Merits</th>
            <th>Current EE</th>
            <th>Best Position</th>
            <th>Est. New EE</th>
            <th>Change</th>
            <th>Fit</th>
          </tr>
        </thead>
        <tbody>`;

    for (const row of rows) {
      const currentTotal = typeof row.ee?.total === 'number' ? row.ee.total : null;
      const estimatedTotal = row.best?.estimate?.total ?? null;
      const delta =
        currentTotal !== null && estimatedTotal !== null
          ? estimatedTotal - currentTotal
          : null;

      const deltaClass =
        delta === null
          ? ''
          : delta > 0
            ? 'tds-v-good'
            : delta < 0
              ? 'tds-v-bad'
              : '';

      html += `<tr data-employee-id="${escapeHtml(String(row.employee.id))}" data-employee-name="${escapeHtml(String(row.employee.name))}">
        <td><strong class="tds-employee-profile-link" data-employee-profile data-employee-id="${escapeHtml(String(row.employee.id))}" data-employee-name="${escapeHtml(String(row.employee.name))}" title="Open employee summary">${escapeHtml(row.employee.name)}</strong></td>
        <td>${escapeHtml(row.employee.position || '—')}</td>
        <td>${formatEEMerits(row.employee.raw)}</td>
        <td>${currentTotal !== null ? formatNumber(currentTotal) : '—'}</td>
        <td>${row.best ? escapeHtml(row.best.position.name) : '—'}</td>
        <td>${estimatedTotal !== null ? formatNumber(estimatedTotal) : '—'}</td>
        <td class="${deltaClass}"><strong>${delta === null ? '—' : `${delta > 0 ? '+' : ''}${formatNumber(delta)}`}</strong></td>
        <td>${row.best?.fit ? `${row.best.fit.coverage}%` : '—'}</td>
      </tr>`;
    }

    html += `</tbody></table></div>`;

    // Full position matrix
    html += `<div class="tds-section-label">Position matrix</div>`;
    html += `<div class="tds-box tds-box-neutral">
      Each cell shows <strong>Estimated Total EE</strong> for that employee in that position.
      The best estimated position for each employee is highlighted. Hovering/clicking is not required; the estimated EE is shown directly.
    </div>`;

    html += `<div style="overflow-x:auto;">
      <table class="tds-table tds-position-matrix">
        <thead><tr>
          <th>Employee</th>
          <th>Current</th>
          <th>EE Merits</th>`;

    for (const position of positions) {
      html += `<th>${escapeHtml(position.name)}</th>`;
    }

    html += `</tr></thead><tbody>`;

    for (const row of matrix) {
      html += `<tr data-employee-id="${escapeHtml(String(row.employee.id))}" data-employee-name="${escapeHtml(String(row.employee.name))}">
        <td><strong class="tds-employee-profile-link" data-employee-profile data-employee-id="${escapeHtml(String(row.employee.id))}" data-employee-name="${escapeHtml(String(row.employee.name))}" title="Open employee summary">${escapeHtml(row.employee.name)}</strong></td>
        <td>${escapeHtml(row.employee.position || '—')}</td>
        <td>${formatEEMerits(row.employee.raw)}</td>`;

      for (const cell of row.cells) {
        const estimated = cell.estimate?.total ?? null;
        const current = row.ee?.total ?? null;
        const delta =
          estimated !== null && typeof current === 'number'
            ? estimated - current
            : null;

        const isBest =
          row.best &&
          row.best.position &&
          row.best.position.name === cell.position.name;

        const cls = isBest
          ? 'tds-position-best tds-v-good'
          : (delta !== null && delta < 0 ? 'tds-v-bad' : '');

        const sub =
          delta === null
            ? ''
            : `<div class="tds-v-dim">${delta > 0 ? '+' : ''}${formatNumber(delta)}</div>`;

        html += `<td class="${cls}">
          <strong>${estimated !== null ? formatNumber(estimated) : '—'}</strong>
          ${sub}
        </td>`;
      }

      html += `</tr>`;
    }

    html += `</tbody></table></div>`;

    // Company-wide opportunity summary
    const improvements = matrix
      .map((row) => {
        const current = row.ee?.total ?? null;
        const best = row.best?.estimate?.total ?? null;
        const gain =
          typeof current === 'number' && typeof best === 'number'
            ? best - current
            : null;
        return { row, gain };
      })
      .filter((x) => typeof x.gain === 'number' && x.gain > 0)
      .sort((a, b) => b.gain - a.gain);

    html += `<div class="tds-section-label">Biggest opportunities</div>`;

    if (!improvements.length) {
      html += `<div class="tds-box tds-box-info">No employee currently has a higher estimated EE in another position using the available position requirements.</div>`;
    } else {
      html += `<div class="tds-card">`;
      improvements.slice(0, 8).forEach((entry) => {
        html += `<div class="tds-row">
          <span class="tds-row-label"><strong>${escapeHtml(entry.row.employee.name)}</strong></span>
          <span class="tds-row-value tds-v-good">
            ${escapeHtml(entry.row.employee.position || '—')} → ${escapeHtml(entry.row.best.position.name)}
            · +${formatNumber(entry.gain)} EE
          </span>
        </div>`;
      });
      html += `</div>`;
    }

    html += `<div class="tds-box tds-box-neutral" style="margin-top:10px;">
      <strong>Optimizer limitation:</strong> Core-role protection may adapt only when enough paired Sales EE + income/customer observations exist; otherwise it remains at the default 85%. Important roles remain at 70%. These are not official Torn minimum staffing requirements, and the suite does not claim that EE changes directly cause a specific revenue change.
    </div>`;

    el.innerHTML = html;
    bindEmployeeProfileLinks(panel);
    renderOptimizerPerformanceEvidence(el).catch((err) =>
      console.warn('[TDS] Performance evidence render failed:', err)
    );
  }

  // =======================================================================
  // TRAINING TAB
  // =======================================================================
  async function renderTrainingTab(panel) {
    const el = panel.querySelector('[data-tabpanel="training"]');
    const results = state.lastResults;
    if (!results) {
      el.innerHTML = `<div class="tds-box tds-box-neutral">Run Diagnostics first — Training reads the employee roster and training-history sources.</div>`;
      return;
    }

    const employeesRaw = findRaw(results, 'company', 'employees');
    const employees = extractEmployeesEntries(employeesRaw);
    const profile = findRaw(results, 'company', 'profile');
    const mode = state.trainingMode || 'priority';

    let html = `
      <div class="tds-segmented">
        <div class="tds-segment ${mode === 'priority' ? 'tds-segment-active' : ''}" data-trainmode="priority">PRIORITY</div>
        <div class="tds-segment ${mode === 'rotational' ? 'tds-segment-active' : ''}" data-trainmode="rotational">ROTATIONAL / DEBT</div>
        <div class="tds-segment ${mode === 'planner' ? 'tds-segment-active' : ''}" data-trainmode="planner">TRAINING PLANNER</div>
      </div>`;

    if (employees.length === 0) {
      html += `<div class="tds-box tds-box-danger">Employee roster unavailable, so there’s nothing to build a training queue from.</div>`;
      el.innerHTML = html;
      return;
    }

    if (mode !== 'priority' && !isDirectorAccess()) {
      html += directorFeatureNotice(
        mode === 'planner' ? 'Training Planner and Training Forecast' : 'Rotational / Debt'
      );
      el.innerHTML = html;
      bindTrainingModeButtons(panel);
      return;
    }

    const ratingValue = numericValue(findValueDeep(profile, ['rating', 'star_rating', 'stars']));
    html += `<div class="tds-box tds-box-neutral">
      ${ratingValue !== null ? `Current company rating: <strong>${escapeHtml(String(ratingValue))}★</strong>. ` : ''}
      Rotational debt below is based on <strong>observed trains actually given</strong>, not an assumed star-rating budget. This keeps the queue fair if ratings, staffing, saved trains or training-role bonuses changed during the period.
    </div>`;

    if (mode === 'priority') {
      html += `<div class="tds-box tds-box-info">
        Sorted by <strong>current effectiveness, lowest first</strong>. This is the EE-priority view. Use <strong>Training Planner</strong> for a forward-looking fair-rotation plan based on recorded training history.
      </div>`;

      const withEE = employees.map((e) => ({
        ...e,
        ee: findEffectivenessField(e.raw),
        eeMerits: getEmployeeEEMerits(e.raw)
      }));
      withEE.sort((a, b) => (a.ee?.value ?? Infinity) - (b.ee?.value ?? Infinity));

      html += '<div class="tds-section-label">Priority queue</div><div class="tds-card">';
      withEE.forEach((e, i) => {
        html += `
          <div class="tds-employee-row">
            <div class="tds-employee-top">
              <div>
                <div class="tds-employee-name tds-employee-profile-link" data-employee-profile data-employee-id="${escapeHtml(String(e.id))}" data-employee-name="${escapeHtml(String(e.name))}" title="Open employee summary">${i === 0 ? '▶ ' : ''}${escapeHtml(String(e.name))}</div>
                <div class="tds-employee-meta">${escapeHtml(String(e.position))}</div>
              </div>
              <div style="text-align:right;">
                <div class="tds-row-value">${e.ee ? formatNumber(e.ee.value) : '<span class="tds-v-dim">no EE field</span>'}</div>
                <div class="tds-v-dim" style="font-size:10px;">EE Merits: ${e.eeMerits !== null ? formatNumber(e.eeMerits) : '—'}</div>
              </div>
            </div>
          </div>`;
      });
      html += '</div>';
    } else {
      html += `<div class="tds-box tds-box-neutral" id="tds-training-loading">
        ${mode === 'planner'
          ? 'Reading Torn training history and building the training plan…'
          : 'Reading Torn training history and calculating fair-share debt…'}
      </div>`;
      el.innerHTML = html;
      bindTrainingModeButtons(panel);
      await renderRotationalDebt(panel, employees, results);
      return;
    }

    el.innerHTML = html;
    bindTrainingModeButtons(panel);
    bindEmployeeProfileLinks(panel);
  }

  function bindTrainingModeButtons(panel) {
    const el = panel.querySelector('[data-tabpanel="training"]');
    if (!el) return;

    el.querySelectorAll('[data-trainmode]').forEach((seg) => {
      seg.addEventListener('click', () => {
        state.trainingMode = seg.dataset.trainmode;
        el.querySelectorAll('[data-trainmode]').forEach((button) => {
          button.classList.toggle('tds-segment-active', button === seg);
        });
        renderTrainingTab(panel).catch((err) => {
          console.error('[TDS] Training tab render failed:', err);
        });
      });
    });
  }

  async function fetchTrainingHistorySources(results) {
    let newsRaw = findRaw(results, 'company', 'news');
    let logRaw = findRaw(results, 'user', 'log');

    // Diagnostics normally already has both selections. Only make an extra
    // request if one is absent, so opening Training does not needlessly use
    // additional API calls.
    if (!newsRaw) {
      try {
        newsRaw = await ApiClient.call('company', 'news');
      } catch (_) {
        newsRaw = null;
      }
    }

    if (!logRaw) {
      try {
        logRaw = await ApiClient.call('user', 'log');
      } catch (_) {
        logRaw = null;
      }
    }

    if (!newsRaw && !logRaw) {
      throw new Error('No readable company-news or user-log training history was returned.');
    }

    return { newsRaw, logRaw };
  }

  function flattenTrainingHistoryEntries(raw) {
    if (!raw) return [];

    const entries = [];
    const seen = new Set();

    for (const { value, path } of deepObjectEntries(raw)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;

      const timestamp = pickNumeric(value, [
        'timestamp', 'time', 'created_at', 'date', 'logtime'
      ]);
      if (!timestamp) continue;

      const text = pickText(value, [
        'text', 'news', 'message', 'description', 'event', 'title', 'log'
      ]) || '';

      const id = pickText(value, [
        'id', 'log_id', 'news_id', 'event_id'
      ]) || path.join('.');

      const key = `${id}|${timestamp}|${text}`;
      if (seen.has(key)) continue;
      seen.add(key);

      entries.push({
        id,
        timestamp: Number(timestamp),
        text: String(text || ''),
        raw: value
      });
    }

    return entries.sort((a, b) => b.timestamp - a.timestamp);
  }

  function matchTrainingEmployee(entry, employees) {
    const raw = entry.raw || {};

    const possibleId = pickText(raw, [
      'employee_id', 'user_id', 'player_id', 'target_id', 'member_id'
    ]);

    if (possibleId !== null && possibleId !== undefined) {
      const byId = employees.find((employee) =>
        String(employee.id) === String(possibleId)
      );
      if (byId) return byId;
    }

    const possibleName = pickText(raw, [
      'employee_name', 'user_name', 'player_name', 'target_name', 'name'
    ]);

    if (possibleName) {
      const normalized = normalizeFieldName(possibleName);
      const byName = employees.find((employee) =>
        normalizeFieldName(employee.name) === normalized
      );
      if (byName) return byName;
    }

    const text = String(entry.text || '').toLowerCase();
    if (!text) return null;

    // Longest name first avoids a short employee name accidentally matching
    // inside another employee's name.
    return [...employees]
      .filter((employee) => employee.name && !String(employee.name).startsWith('#'))
      .sort((a, b) => String(b.name).length - String(a.name).length)
      .find((employee) => text.includes(String(employee.name).toLowerCase())) || null;
  }

  function trainingQuantity(entry) {
    const raw = entry.raw || {};

    const structured = pickNumeric(raw, [
      'trains', 'train_count', 'traincount', 'quantity', 'qty', 'amount', 'count'
    ]);
    if (structured !== null && structured > 0 && structured <= 1000) {
      return Math.max(1, Math.floor(structured));
    }

    const text = String(entry.text || '');
    const patterns = [
      /(\d[\d,]*)\s+(?:company\s+)?trains?\b/i,
      /(?:trained|training)\s+(?:x\s*)?(\d[\d,]*)\b/i,
      /(\d[\d,]*)\s+times?\b/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (!match) continue;
      const value = Number(String(match[1]).replace(/,/g, ''));
      if (Number.isFinite(value) && value > 0 && value <= 1000) {
        return Math.floor(value);
      }
    }

    return 1;
  }

  function collectTrainingEvents(raw, employees) {
    const sourceEntries = flattenTrainingHistoryEntries(raw);
    const events = [];

    for (const entry of sourceEntries) {
      const text = String(entry.text || '');
      const rawObj = entry.raw || {};

      // Require an explicit training signal in either the visible text or
      // structured event/log fields. This deliberately avoids counting
      // unrelated employee events.
      const structuredSignal = Object.entries(rawObj).some(([key, value]) => {
        const k = normalizeFieldName(key);
        const v = typeof value === 'string' ? value.toLowerCase() : '';
        return /train/.test(k) || /train/.test(v);
      });

      if (!/\btrain(?:ed|ing|s)?\b/i.test(text) && !structuredSignal) continue;

      const employee = matchTrainingEmployee(entry, employees);
      if (!employee) continue;

      events.push({
        employeeId: String(employee.id),
        employeeName: String(employee.name),
        timestamp: Number(entry.timestamp),
        quantity: trainingQuantity(entry),
        sourceId: String(entry.id || ''),
        text
      });
    }

    return { events, sourceEntries };
  }

  function mergeTrainingEventSources(newsEvents, logEvents) {
    const merged = [];
    const seen = new Set();

    for (const event of [...(newsEvents || []), ...(logEvents || [])]) {
      // News and user log can describe the same train with slightly different
      // text/IDs. Employee + timestamp bucket + quantity is a stable enough
      // dedupe key without inventing additional events.
      const timeBucket = Math.floor(Number(event.timestamp || 0) / 5);
      const key = `${event.employeeId}|${timeBucket}|${event.quantity}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(event);
    }

    return merged.sort((a, b) => b.timestamp - a.timestamp);
  }

  function formatTrainingCoverage(coverageStart) {
    if (!coverageStart) return 'unknown returned history';
    const seconds = Math.max(0, Math.floor(Date.now() / 1000) - Number(coverageStart));
    const days = seconds / 86400;

    if (days < 1) return `${Math.max(1, Math.round(seconds / 3600))} hour(s)`;
    if (days < 60) return `${days.toFixed(1)} day(s)`;
    return `${(days / 30).toFixed(1)} month(s)`;
  }

  function calculateRotationalDebt(employees, events, coverageStart) {
    const nowSec = Math.floor(Date.now() / 1000);
    const historyStart = Number(coverageStart) || nowSec;
    const historyDays = Math.max(0, (nowSec - historyStart) / 86400);

    const eventMap = new Map();
    for (const event of events || []) {
      const key = String(event.employeeId);
      const list = eventMap.get(key) || [];
      list.push(event);
      eventMap.set(key, list);
    }

    const rows = employees.map((employee) => {
      const daysInCompany = Math.max(0, Number(employee.raw?.days_in_company) || 0);
      const eligibleCompanyDays = Math.max(0, daysInCompany - 3);
      const eligibleWeight = Math.min(historyDays, eligibleCompanyDays);

      const employeeEvents = eventMap.get(String(employee.id)) || [];
      const actual = employeeEvents.reduce(
        (sum, event) => sum + (Number(event.quantity) || 0),
        0
      );

      const cutoff7 = nowSec - 7 * 86400;
      const cutoff30 = nowSec - 30 * 86400;

      const trains7 = employeeEvents
        .filter((event) => Number(event.timestamp) >= cutoff7)
        .reduce((sum, event) => sum + (Number(event.quantity) || 0), 0);

      const trains30 = employeeEvents
        .filter((event) => Number(event.timestamp) >= cutoff30)
        .reduce((sum, event) => sum + (Number(event.quantity) || 0), 0);

      const lastTrain = employeeEvents.length
        ? Math.max(...employeeEvents.map((event) => Number(event.timestamp) || 0))
        : null;

      return {
        employee,
        eligibleWeight,
        actual,
        trains7,
        trains30,
        lastTrain,
        expected: 0,
        debt: 0
      };
    });

    const totalObserved = rows.reduce((sum, row) => sum + row.actual, 0);
    const totalWeight = rows.reduce((sum, row) => sum + row.eligibleWeight, 0);

    rows.forEach((row) => {
      row.expected = totalWeight > 0
        ? totalObserved * (row.eligibleWeight / totalWeight)
        : 0;
      row.debt = row.expected - row.actual;
    });

    rows.sort((a, b) => {
      if (b.debt !== a.debt) return b.debt - a.debt;
      return String(a.employee.name).localeCompare(String(b.employee.name));
    });

    return { rows, totalObserved, totalWeight };
  }

  function resolveAvailableCompanyTrains(results) {
    const sources = [
      findRaw(results, 'company', 'profile'),
      findRaw(results, 'company', 'detailed'),
    ].filter(Boolean);

    const aliases = [
      'trains_available', 'available_trains', 'trains', 'train_count',
      'trains_remaining', 'company_trains'
    ];

    for (const source of sources) {
      const value = numericValue(findValueDeep(source, aliases));
      if (value !== null && value >= 0) return Math.floor(value);
    }

    return null;
  }

  function buildRotationalTrainingPlan(debt, requestedCount) {
    const eligibleRows = (debt?.rows || [])
      .filter((row) => Number(row.eligibleWeight) > 0)
      .map((row) => ({
        employee: row.employee,
        eligibleWeight: Number(row.eligibleWeight) || 0,
        actual: Number(row.actual) || 0,
        planned: 0,
      }));

    const totalWeight = eligibleRows.reduce(
      (sum, row) => sum + row.eligibleWeight,
      0
    );
    const observedTotal = eligibleRows.reduce(
      (sum, row) => sum + row.actual,
      0
    );

    if (!eligibleRows.length || totalWeight <= 0 || requestedCount <= 0) {
      return { steps: [], allocations: [], count: 0 };
    }

    const steps = [];

    for (let i = 0; i < requestedCount; i += 1) {
      const projectedTotal = observedTotal + i + 1;

      const ranked = eligibleRows
        .map((row) => {
          const expectedAfterTrain =
            projectedTotal * (row.eligibleWeight / totalWeight);
          const receivedBeforeChoice = row.actual + row.planned;
          const projectedDebt = expectedAfterTrain - receivedBeforeChoice;

          return {
            row,
            projectedDebt,
            receivedBeforeChoice,
          };
        })
        .sort((a, b) => {
          if (b.projectedDebt !== a.projectedDebt) {
            return b.projectedDebt - a.projectedDebt;
          }

          const aLast = Number(
            debt.rows.find(
              (source) =>
                String(source.employee.id) === String(a.row.employee.id)
            )?.lastTrain || 0
          );
          const bLast = Number(
            debt.rows.find(
              (source) =>
                String(source.employee.id) === String(b.row.employee.id)
            )?.lastTrain || 0
          );

          if (aLast !== bLast) return aLast - bLast;

          return String(a.row.employee.name).localeCompare(
            String(b.row.employee.name)
          );
        });

      const chosen = ranked[0];
      if (!chosen) break;

      chosen.row.planned += 1;

      steps.push({
        number: i + 1,
        employee: chosen.row.employee,
        debtBefore: chosen.projectedDebt,
      });
    }

    const allocations = eligibleRows
      .filter((row) => row.planned > 0)
      .sort((a, b) => {
        if (b.planned !== a.planned) return b.planned - a.planned;
        return String(a.employee.name).localeCompare(
          String(b.employee.name)
        );
      });

    return {
      steps,
      allocations,
      count: steps.length,
    };
  }

  function calculateTrainingBalanceForecast(debt, tolerance = 1, maxTrains = 500) {
    const eligible = (debt?.rows || [])
      .filter((row) => Number(row.eligibleWeight) > 0)
      .map((row) => ({
        employee: row.employee,
        weight: Number(row.eligibleWeight) || 0,
        received: Number(row.actual) || 0,
      }));

    const totalWeight = eligible.reduce((sum, row) => sum + row.weight, 0);
    const startingTotal = eligible.reduce((sum, row) => sum + row.received, 0);
    if (!eligible.length || totalWeight <= 0) {
      return { trainsNeeded: null, balanced: false, maxDebt: null, simulated: 0 };
    }

    const debtFor = (row, total) =>
      total * (row.weight / totalWeight) - row.received;

    const currentMaxDebt = Math.max(...eligible.map((row) => debtFor(row, startingTotal)));
    if (currentMaxDebt <= tolerance) {
      return {
        trainsNeeded: 0,
        balanced: true,
        maxDebt: currentMaxDebt,
        simulated: 0,
      };
    }

    for (let step = 1; step <= maxTrains; step += 1) {
      const totalAfter = startingTotal + step;
      const chosen = [...eligible].sort((a, b) => {
        const debtA = debtFor(a, totalAfter);
        const debtB = debtFor(b, totalAfter);
        if (debtB !== debtA) return debtB - debtA;
        return String(a.employee.name).localeCompare(String(b.employee.name));
      })[0];

      chosen.received += 1;

      const maxDebt = Math.max(...eligible.map((row) => debtFor(row, totalAfter)));
      if (maxDebt <= tolerance) {
        return {
          trainsNeeded: step,
          balanced: true,
          maxDebt,
          simulated: step,
        };
      }
    }

    return {
      trainsNeeded: null,
      balanced: false,
      maxDebt: Math.max(...eligible.map((row) => debtFor(row, startingTotal + maxTrains))),
      simulated: maxTrains,
    };
  }

  function renderTrainingPlanner(debt, results) {
    const availableTrains = resolveAvailableCompanyTrains(results);

    // If Torn tells us the exact saved balance, plan that balance. Limit the
    // visible simulation to 50 trains so a very large saved pool does not
    // create an enormous mobile page. Without a readable balance, preview 5.
    const requestedCount =
      availableTrains !== null
        ? Math.min(Math.max(availableTrains, 0), 50)
        : 5;

    const plan = buildRotationalTrainingPlan(debt, requestedCount);
    const forecast = calculateTrainingBalanceForecast(debt, 1, 500);

    let html = `
      <div class="tds-section-label">Training Planner</div>
      <div class="tds-box tds-box-info">
        <strong>Fair Rotation Plan:</strong>
        this is a read-only forecast built from the same observed training
        history and eligibility weighting shown in the Rotational / Debt tab.
        After every planned train, the suite recalculates the queue before
        choosing the next employee.
      </div>`;

    html += `<div class="tds-section-label">Training Forecast</div>
      <div class="tds-training-plan">
        <div class="tds-training-plan-card">
          <div class="tds-stock-summary-label">Balance Target</div>
          <div class="tds-stock-summary-value">≤ 1.00 debt</div>
        </div>
        <div class="tds-training-plan-card">
          <div class="tds-stock-summary-label">Additional Trains Needed</div>
          <div class="tds-stock-summary-value">${forecast.trainsNeeded !== null ? formatNumber(forecast.trainsNeeded) : '500+'}</div>
        </div>
        <div class="tds-training-plan-card">
          <div class="tds-stock-summary-label">Current Balance</div>
          <div class="tds-stock-summary-value">${forecast.trainsNeeded === 0 ? 'Balanced' : 'In progress'}</div>
        </div>
      </div>
      <div class="tds-box tds-box-neutral">
        Forecast means the number of additional fair-rotation trains required until no eligible employee is more than
        <strong>1 train behind</strong> their calculated fair share. This is a simulation from observed history, not a promise about when new trains will become available.
        ${availableTrains !== null && forecast.trainsNeeded !== null
          ? `<br><strong>Current saved trains:</strong> ${formatNumber(availableTrains)} · ${availableTrains >= forecast.trainsNeeded ? 'enough to reach the balance target now.' : `${formatNumber(forecast.trainsNeeded - availableTrains)} more would still be required after using the current balance.`}`
          : ''}
      </div>`;

    if (availableTrains !== null) {
      html += `
        <div class="tds-training-plan">
          <div class="tds-training-plan-card">
            <div class="tds-stock-summary-label">Trains Available</div>
            <div class="tds-stock-summary-value">${formatNumber(availableTrains)}</div>
          </div>
          <div class="tds-training-plan-card">
            <div class="tds-stock-summary-label">Planned Now</div>
            <div class="tds-stock-summary-value">${formatNumber(plan.count)}</div>
          </div>
          <div class="tds-training-plan-card">
            <div class="tds-stock-summary-label">Eligible Staff</div>
            <div class="tds-stock-summary-value">${formatNumber(
              debt.rows.filter((row) => row.eligibleWeight > 0).length
            )}</div>
          </div>
        </div>`;

      if (availableTrains > 50) {
        html += `
          <div class="tds-box tds-box-neutral">
            You currently have ${formatNumber(availableTrains)} trains available.
            To keep the page manageable on PDA, the visible planner previews
            the first <strong>50</strong>. Reopening the planner after trains
            are assigned will recalculate from the latest history.
          </div>`;
      }
    } else {
      html += `
        <div class="tds-box tds-box-neutral">
          Torn did not expose a readable current train balance in the cached
          company data, so the planner is previewing the <strong>next 5</strong>
          fair-rotation assignments.
        </div>`;
    }

    if (!plan.steps.length) {
      html += `
        <div class="tds-box tds-box-neutral">
          ${availableTrains === 0
            ? 'There are currently no company trains available to plan.'
            : 'There is not enough eligible training-history data to build a queue yet.'}
        </div>`;
      return html;
    }

    html += `
      <div class="tds-card">
        <div class="tds-card-title">Planned train order</div>`;

    for (const step of plan.steps) {
      html += `
        <div class="tds-training-plan-step">
          <span>
            <span class="tds-training-plan-rank">#${step.number}</span>
            <strong>${escapeHtml(String(step.employee.name))}</strong>
            <span class="tds-v-dim"> · ${escapeHtml(String(step.employee.position || 'Employee'))} · EE Merits ${formatEEMerits(step.employee.raw)}</span>
          </span>
          <span class="tds-v-dim">
            debt before train ${step.debtBefore.toFixed(2)}
          </span>
        </div>`;
    }

    html += `</div>
      <div class="tds-section-label">Planned Allocation Summary</div>
      <div style="overflow-x:auto;">
        <table class="tds-table tds-training-debt-table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Position</th>
              <th>EE Merits</th>
              <th>Planned Trains</th>
            </tr>
          </thead>
          <tbody>`;

    for (const row of plan.allocations) {
      html += `
        <tr>
          <td><strong>${escapeHtml(String(row.employee.name))}</strong></td>
          <td>${escapeHtml(String(row.employee.position || '—'))}</td>
          <td>${formatEEMerits(row.employee.raw)}</td>
          <td>${formatNumber(row.planned)}</td>
        </tr>`;
    }

    html += `
          </tbody>
        </table>
      </div>
      <div class="tds-box tds-box-neutral">
        <strong>Planner scope:</strong> this planner optimises fairness of
        company-train distribution. It does not claim to predict the exact
        working-stat gain from a train, and it never performs a training action
        in Torn.
      </div>`;

    return html;
  }

  async function renderRotationalDebt(panel, employees, results) {
    const el = panel.querySelector('[data-tabpanel="training"]');
    if (!el || !['rotational', 'planner'].includes(state.trainingMode)) return;

    let sources;
    try {
      sources = await fetchTrainingHistorySources(results);
    } catch (err) {
      el.innerHTML += `<div class="tds-box tds-box-danger"><strong>Training history failed:</strong> ${escapeHtml(String(err.reason || err.message || err))}</div>`;
      return;
    }

    const newsParsed = collectTrainingEvents(sources.newsRaw, employees);
    const logParsed = collectTrainingEvents(sources.logRaw, employees);

    // Prefer the union but deduplicate mirrored news/log records.
    const events = mergeTrainingEventSources(newsParsed.events, logParsed.events);

    const allSourceEntries = [
      ...newsParsed.sourceEntries,
      ...logParsed.sourceEntries,
    ];
    const coverageStart = allSourceEntries.length
      ? Math.min(...allSourceEntries.map((entry) => Number(entry.timestamp)).filter(Number.isFinite))
      : null;

    const loading = el.querySelector('#tds-training-loading');
    if (loading) loading.remove();

    if (!events.length) {
      let detail = '';
      if (newsParsed.sourceEntries.length || logParsed.sourceEntries.length) {
        detail = `Torn history was readable (${formatNumber(newsParsed.sourceEntries.length + logParsed.sourceEntries.length)} entries inspected), but no employee-training events were recognised.`;
      } else {
        detail = 'No readable company-news or user-log history was returned.';
      }

      el.insertAdjacentHTML('beforeend', `
        <div class="tds-box tds-box-warn">
          <strong>No training events matched yet.</strong> ${escapeHtml(detail)}
          The parser deliberately refuses to invent train counts. If you have recently trained an employee, send me the Training tab after that action and we can map Torn’s exact live event wording/fields.
        </div>
        <div class="tds-card">
          <div class="tds-row"><span class="tds-row-label">Company-news entries inspected</span><span class="tds-row-value">${formatNumber(newsParsed.sourceEntries.length)}</span></div>
          <div class="tds-row"><span class="tds-row-label">User-log entries inspected</span><span class="tds-row-value">${formatNumber(logParsed.sourceEntries.length)}</span></div>
        </div>
      `);
      return;
    }

    const debt = calculateRotationalDebt(employees, events, coverageStart);
    const next = debt.rows.find((row) => row.eligibleWeight > 0) || null;

    if (state.trainingMode === 'planner') {
      el.insertAdjacentHTML('beforeend', renderTrainingPlanner(debt, results));
      bindEmployeeProfileLinks(panel);
      return;
    }

    let html = `
      <div class="tds-section-label">Rotational / Debt Evidence</div>
      <div class="tds-box tds-box-info">
        <strong>Rotational / Debt is live.</strong>
        It found <strong>${formatNumber(events.reduce((sum, event) => sum + event.quantity, 0))}</strong> train(s) across
        ${formatTrainingCoverage(coverageStart)} of returned history.
        Fair share is weighted by how long each current employee was eligible during that same history window.
      </div>`;

    if (next) {
      html += `
        <div class="tds-box ${next.debt > 0.05 ? 'tds-box-warn' : 'tds-box-info'}">
          <strong>Train next:</strong> ${escapeHtml(String(next.employee.name))}
          ${next.debt > 0.05 ? ` — approximately <strong>${next.debt.toFixed(2)}</strong> train(s) behind their fair share.` : ' — the rotation is currently close to balanced.'}
        </div>`;
    }

    html += `
      <div class="tds-card">
        <div class="tds-row"><span class="tds-row-label">Training events recognised</span><span class="tds-row-value">${formatNumber(events.length)}</span></div>
        <div class="tds-row"><span class="tds-row-label">Trains represented</span><span class="tds-row-value">${formatNumber(debt.totalObserved)}</span></div>
        <div class="tds-row"><span class="tds-row-label">History coverage</span><span class="tds-row-value">${escapeHtml(formatTrainingCoverage(coverageStart))}</span></div>
        <div class="tds-row"><span class="tds-row-label">Company-news entries inspected</span><span class="tds-row-value">${formatNumber(newsParsed.sourceEntries.length)}</span></div>
        <div class="tds-row"><span class="tds-row-label">User-log entries inspected</span><span class="tds-row-value">${formatNumber(logParsed.sourceEntries.length)}</span></div>
      </div>

      <div class="tds-section-label">Rotational queue</div>
      <div style="overflow-x:auto;">
        <table class="tds-table tds-training-debt-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Employee</th>
              <th>Position</th>
              <th>EE Merits</th>
              <th>Eligible Days*</th>
              <th>Received</th>
              <th>Fair Share</th>
              <th>Debt</th>
              <th>Last 7d</th>
              <th>Last 30d</th>
              <th>Last Train</th>
            </tr>
          </thead>
          <tbody>`;

    debt.rows.forEach((row, index) => {
      const debtClass = row.debt > 0.05
        ? 'tds-v-bad'
        : row.debt < -0.05
          ? 'tds-v-good'
          : '';

      const debtText = `${row.debt > 0 ? '+' : ''}${row.debt.toFixed(2)}`;
      const lastTrain = row.lastTrain ? formatTimestampRelative(row.lastTrain) : 'None in history';

      html += `
        <tr>
          <td>${index + 1}</td>
          <td><strong>${index === 0 ? '▶ ' : ''}${escapeHtml(String(row.employee.name))}</strong></td>
          <td>${escapeHtml(String(row.employee.position || '—'))}</td>
          <td>${formatEEMerits(row.employee.raw)}</td>
          <td>${row.eligibleWeight.toFixed(1)}</td>
          <td>${formatNumber(row.actual)}</td>
          <td>${row.expected.toFixed(2)}</td>
          <td class="${debtClass}"><strong>${debtText}</strong></td>
          <td>${formatNumber(row.trains7)}</td>
          <td>${formatNumber(row.trains30)}</td>
          <td>${escapeHtml(lastTrain)}</td>
        </tr>`;
    });

    html += `
          </tbody>
        </table>
      </div>

      <div class="tds-box tds-box-neutral" style="margin-top:10px;">
        <strong>How debt is calculated:</strong> actual trains observed in Torn history are distributed as a fair-share target across current employees, weighted by eligible time in the same returned history window. Employees are treated as training-eligible after their first 3 days. <strong>Debt = Fair Share − Received.</strong>
        Positive/red means owed trains; negative/green means ahead of the rotation.
        <br><br>
        *Eligible Days is limited to the history Torn actually returned — this is not presented as an all-time figure unless the returned history genuinely covers the employee’s full tenure.
      </div>`;

    el.insertAdjacentHTML('beforeend', html);
  }


  // =======================================================================
  // COMPARE TAB
  // =======================================================================
  const BENCHMARK_CACHE_TTL_MS = 4 * 60 * 60 * 1000;
  const BENCHMARK_PAGE_SIZE = 100;
  const BENCHMARK_MAX_PAGES = 10;

  function getOwnCompanyCompareInfo(profile, results) {
    if (!profile || typeof profile !== 'object') {
      return { id: null, name: null, typeId: null, typeName: null, rating: null };
    }

    // Prefer direct/wrapped company fields before doing a broad recursive
    // search; this avoids accidentally treating a director/player ID as the
    // company ID when Torn returns nested objects.
    const candidates = [profile];
    for (const key of ['company', 'profile', 'data']) {
      if (profile[key] && typeof profile[key] === 'object' && !Array.isArray(profile[key])) {
        candidates.push(profile[key]);
      }
    }

    let id = null;
    let name = null;
    let typeId = null;
    let typeName = null;
    let rating = null;

    for (const obj of candidates) {
      if (id === null) {
        id = numericValue(obj.id ?? obj.company_id ?? obj.companyId);
      }

      if (!name) {
        const nameValue = obj.name ?? obj.company_name ?? obj.companyName;
        if (nameValue !== null && nameValue !== undefined && String(nameValue).trim()) {
          name = String(nameValue).trim();
        }
      }

      if (rating === null) {
        rating = numericValue(obj.rating ?? obj.star_rating ?? obj.stars);
      }

      const typeValue = obj.company_type ?? obj.type_id ?? obj.companyType ?? obj.type;
      if (typeValue && typeof typeValue === 'object') {
        if (typeId === null) typeId = numericValue(typeValue.id ?? typeValue.type_id ?? typeValue.type);
        if (!typeName) typeName = typeValue.name ?? typeValue.type_name ?? null;
      } else if (typeId === null) {
        typeId = numericValue(typeValue);
      }
    }

    if (typeId === null) {
      typeId = numericValue(findValueDeep(profile, ['company_type', 'type_id', 'companyType']));
    }
    if (rating === null) {
      rating = numericValue(findValueDeep(profile, ['rating', 'star_rating', 'stars']));
    }

    if (!name) {
      const deepName = findValueDeep(profile, ['name', 'company_name', 'companyName']);
      if (deepName !== null && deepName !== undefined && String(deepName).trim()) {
        name = String(deepName).trim();
      }
    }

    if (typeId !== null && !typeName) {
      typeName = resolveCompanyTypeName(findRaw(results, 'torn', 'companies'), typeId);
    }

    return { id, name, typeId, typeName, rating };
  }

  function buildBenchmarkSearchFilters(typeId, tier, ownRating) {
    const filters = [`type:Equal:${typeId}`];

    if (tier === 'same' && ownRating !== null) {
      filters.push(`rating:=:${ownRating}`);
    } else if (tier === 'mid') {
      filters.push('rating:>=:3');
      filters.push('rating:<=:5');
    } else if (tier === 'top') {
      filters.push('rating:>=:8');
      filters.push('rating:<=:10');
    }

    return filters.join(',');
  }

  async function fetchBenchmarkCompaniesPage(typeId, offset = 0, tier = 'all', ownRating = null) {
    if (tier === 'all') {
      return ApiClient.callV2(`company/${encodeURIComponent(typeId)}/companies`, {
        limit: BENCHMARK_PAGE_SIZE,
        offset,
        striptags: 'true',
      });
    }

    return ApiClient.callV2('company/search', {
      filters: buildBenchmarkSearchFilters(typeId, tier, ownRating),
      limit: BENCHMARK_PAGE_SIZE,
      offset,
      striptags: 'true',
    });
  }

  function mergeBenchmarkPageData(pages) {
    const allRows = [];
    let firstData = null;

    for (const data of pages) {
      if (!firstData) firstData = data;
      const rows = extractCompareCompanies(data);
      allRows.push(...rows);
    }

    // Keep a simple common shape the existing renderer already understands.
    return {
      companies: allRows,
      _tdsPagination: {
        pagesFetched: pages.length,
        rowsFetched: allRows.length,
      },
      _tdsFirstResponse: firstData,
    };
  }

  async function fetchBenchmarkCompanies(typeId, tier = 'all', ownRating = null) {
    const pages = [];

    for (let page = 0; page < BENCHMARK_MAX_PAGES; page += 1) {
      const offset = page * BENCHMARK_PAGE_SIZE;
      const data = await fetchBenchmarkCompaniesPage(typeId, offset, tier, ownRating);
      pages.push(data);

      const rows = extractCompareCompanies(data);

      // Fewer than the requested page size means Torn has no next full page.
      if (rows.length < BENCHMARK_PAGE_SIZE) break;
    }

    return mergeBenchmarkPageData(pages);
  }

  function extractCompareCompanies(data) {
    if (!data || typeof data !== 'object') return [];

    if (Array.isArray(data.companies)) return data.companies;
    if (data.companies && typeof data.companies === 'object') {
      return Object.values(data.companies).filter((x) => x && typeof x === 'object');
    }

    // Defensive fallback for schema wrappers.
    const seen = new WeakSet();
    let found = null;
    function walk(value) {
      if (found || !value || typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);

      if (Array.isArray(value) && value.length && value.every((x) => x && typeof x === 'object')) {
        const keys = new Set(value.flatMap((x) => Object.keys(x)));
        if ([...keys].some((k) => /company|name|daily.*income|weekly.*income/i.test(k))) {
          found = value;
          return;
        }
      }

      for (const child of Object.values(value)) {
        if (child && typeof child === 'object') walk(child);
        if (found) return;
      }
    }
    walk(data);
    return found || [];
  }

  function compareField(row, names, pattern = null) {
    if (!row || typeof row !== 'object') return null;
    for (const name of names) {
      if (Object.prototype.hasOwnProperty.call(row, name) && row[name] !== null && row[name] !== undefined) {
        return row[name];
      }
    }
    if (pattern) {
      const entry = Object.entries(row).find(([k, v]) => pattern.test(k) && v !== null && v !== undefined);
      if (entry) return entry[1];
    }
    return null;
  }

  function renderBenchmarkTab(panel) {
    const el = panel.querySelector('[data-tabpanel="benchmark"]');
    const results = state.lastResults;
    const profile = results ? findRaw(results, 'company', 'profile') : null;
    const own = getOwnCompanyCompareInfo(profile, results);

    const typeLabel = own.typeName
      ? `${escapeHtml(String(own.typeName))} (${escapeHtml(String(own.typeId))})`
      : own.typeId !== null
        ? `Company type ${escapeHtml(String(own.typeId))}`
        : 'Not detected';

    let html = `
      <div class="tds-box tds-box-neutral">
                Compare automatically detects your company type and compares it with other companies of the same type. Rating filters are applied through Torn's company search data, and available financial/customer figures are enriched from the Company Snapshot.
      </div>

      <div class="tds-card">
        <div class="tds-row">
          <span class="tds-row-label">Detected company type</span>
          <span class="tds-row-value">${typeLabel}</span>
        </div>
        ${own.rating !== null ? `<div class="tds-row"><span class="tds-row-label">Your rating</span><span class="tds-row-value">${escapeHtml(String(own.rating))}★</span></div>` : ''}
      </div>

      <div class="tds-segmented">
        <div class="tds-segment ${state.benchmark.tier === 'same' ? 'tds-segment-active' : ''}" data-tier="same">SAME RATING${own.rating !== null ? ` (${own.rating}★)` : ''}</div>
        <div class="tds-segment ${state.benchmark.tier === 'mid' ? 'tds-segment-active' : ''}" data-tier="mid">3–5★</div>
        <div class="tds-segment ${state.benchmark.tier === 'top' ? 'tds-segment-active' : ''}" data-tier="top">8–10★ TOP</div>
        <div class="tds-segment ${state.benchmark.tier === 'all' ? 'tds-segment-active' : ''}" data-tier="all">ALL RATINGS</div>
      </div>

      <button class="tds-btn" id="tds-bench-reload">↻ Refresh Compare</button>
      <div id="tds-bench-results" style="margin-top:10px;"></div>
    `;
    el.innerHTML = html;

    el.querySelectorAll('[data-tier]').forEach((seg) => {
      seg.addEventListener('click', () => {
        state.benchmark.tier = seg.dataset.tier;

        // Update the visible selected button immediately instead of waiting
        // for the whole tab to be rebuilt.
        el.querySelectorAll('[data-tier]').forEach((button) => {
          button.classList.toggle('tds-segment-active', button === seg);
        });

        const cached = own.typeId !== null ? state.benchmark.cache[String(own.typeId)] : null;
        if (cached) {
          renderBenchmarkResults(panel, cached.data, own).catch((err) => console.error('[TDS] Compare render failed:', err));
        } else {
          runBenchmark(panel);
        }
      });
    });

    el.querySelector('#tds-bench-reload').addEventListener('click', () => runBenchmark(panel, { force: true }));

    if (own.typeId === null) {
      el.querySelector('#tds-bench-results').innerHTML =
        `<div class="tds-box tds-box-warn">I couldn't detect your company type ID from the current company/profile response. Run Diagnostics again; if this still appears, send me the Company profile fields shown in Diagnostics and I can map the live response shape.</div>`;
      return;
    }

    const cached = state.benchmark.cache[String(own.typeId)];
    if (cached && Date.now() - cached.timestamp < BENCHMARK_CACHE_TTL_MS) {
      renderBenchmarkResults(panel, cached.data, own).catch((err) => console.error('[TDS] Compare render failed:', err));
      return;
    }

    // Auto-load Compare when the tab is rendered. The cache prevents this
    // from repeatedly consuming API requests when switching tabs/tiers.
    setTimeout(() => runBenchmark(panel), 0);
  }

  async function runBenchmark(panel, { force = false } = {}) {
    const el = panel.querySelector('[data-tabpanel="benchmark"]');
    if (!el) return;

    const results = state.lastResults;
    const profile = results ? findRaw(results, 'company', 'profile') : null;
    const own = getOwnCompanyCompareInfo(profile, results);
    const resultsEl = el.querySelector('#tds-bench-results');

    if (own.typeId === null) {
      if (resultsEl) {
        resultsEl.innerHTML = `<div class="tds-box tds-box-warn">Company type could not be detected, so Compare cannot choose the correct Torn company-type endpoint.</div>`;
      }
      return;
    }

    const tier = state.benchmark.tier || 'same';
    const cacheKey = `${own.typeId}:${tier}:${tier === 'same' ? own.rating ?? 'unknown' : ''}`;
    const cached = state.benchmark.cache[cacheKey];
    if (!force && cached && Date.now() - cached.timestamp < BENCHMARK_CACHE_TTL_MS) {
      await renderBenchmarkResults(panel, cached.data, own).catch((err) => console.error('[TDS] Compare render failed:', err));
      return;
    }

    if (resultsEl) resultsEl.innerHTML = `<div class="tds-box tds-box-neutral">
      Fetching ${escapeHtml(String(own.typeName || `company type ${own.typeId}`))} comparison pages…
      This uses Torn's read-only API and may take a few seconds when several pages are available.
    </div>`;

    let data;

    try {
      data = await fetchBenchmarkCompanies(own.typeId, tier, own.rating);
      state.benchmark.cache[cacheKey] = { timestamp: Date.now(), data };
    } catch (err) {
      if (!resultsEl) return;

      const permissionHint = err.code === 16
        ? `<br><br><strong>Custom-key note:</strong> your current key does not include the Company → Companies selection. Open Settings → Create Custom API Key and generate the updated key, which now includes it.`
        : '';

      resultsEl.innerHTML =
        `<div class="tds-box tds-box-danger"><strong>Compare fetch failed:</strong> Torn error ${err.code ?? ''}: ${escapeHtml(String(err.reason || err.message || 'unknown'))}.${permissionHint}</div>`;
      return;
    }

    try {
      await renderBenchmarkResults(panel, data, own);
    } catch (err) {
      console.error('[TDS] Compare render failed:', err);

      if (resultsEl) {
        resultsEl.innerHTML =
          `<div class="tds-box tds-box-danger">
            <strong>Compare display failed:</strong>
            ${escapeHtml(String(err?.message || err?.reason || err || 'Unknown display error'))}
          </div>`;
      }
    }
  }

  function parseCompareCsvLine(line) {
    const values = [];
    let current = '';
    let quoted = false;

    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];

      if (ch === '"') {
        if (quoted && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          quoted = !quoted;
        }
      } else if (ch === ',' && !quoted) {
        values.push(current);
        current = '';
      } else {
        current += ch;
      }
    }

    values.push(current);
    return values;
  }

  function normalizeCompareCsvHeader(value) {
    return String(value || '')
      .replace(/^\uFEFF/, '')
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_');
  }

  function parseCompanySnapshotCsv(csvText) {
    const lines = String(csvText || '')
      .split(/\r?\n/)
      .filter((line) => line.trim());

    if (lines.length < 2) return [];

    const headers = parseCompareCsvLine(lines[0]).map(normalizeCompareCsvHeader);
    const rows = [];

    for (let i = 1; i < lines.length; i += 1) {
      const cells = parseCompareCsvLine(lines[i]);
      const row = {};
      headers.forEach((header, index) => {
        row[header] = cells[index] ?? '';
      });
      rows.push(row);
    }

    return rows;
  }

  function snapshotValue(row, names) {
    if (!row || typeof row !== 'object') return null;

    const wanted = new Set(
      (names || []).map((name) => normalizeFieldName(name))
    );

    for (const [key, value] of Object.entries(row)) {
      if (!wanted.has(normalizeFieldName(key))) continue;
      if (value === null || value === undefined) return null;

      const text = String(value).trim();
      return text === '' ? null : text;
    }

    return null;
  }

  function snapshotNumeric(row, names) {
    for (const name of names) {
      if (!row || !Object.prototype.hasOwnProperty.call(row, name)) continue;
      const raw = row[name];
      if (raw === '' || raw === null || raw === undefined) continue;

      const value = Number(String(raw).replace(/[$,\s]/g, ''));
      if (Number.isFinite(value)) return value;
    }
    return null;
  }

  function buildSnapshotFinancialMap(csvText) {
    const map = new Map();

    for (const row of parseCompanySnapshotCsv(csvText)) {
      const id = snapshotNumeric(row, ['id', 'company_id', 'companyid']);
      if (id === null) continue;

      const name =
        snapshotValue(row, ['name', 'company_name', 'companyname']) ??
        null;

      map.set(String(id), {
        id,
        name: name !== null && name !== undefined ? String(name).trim() : null,
        dailyIncome: snapshotNumeric(row, ['daily_income', 'dailyincome']),
        weeklyIncome: snapshotNumeric(row, ['weekly_income', 'weeklyincome']),
        dailyCustomers: snapshotNumeric(row, ['daily_customers', 'dailycustomers']),
        weeklyCustomers: snapshotNumeric(row, ['weekly_customers', 'weeklycustomers']),
      });
    }

    return map;
  }

  async function getCompareSnapshotFinancialMap({ force = false } = {}) {
    const cached = state.benchmark.snapshot;
    const ttl = 30 * 60 * 1000;

    if (!force && cached && Date.now() - cached.timestamp < ttl) {
      return cached.map;
    }

    const csv = await ApiClient.callV2Text('company/snapshot');
    const map = buildSnapshotFinancialMap(csv);

    state.benchmark.snapshot = {
      timestamp: Date.now(),
      map,
    };

    return map;
  }

  function mergeSnapshotFinancials(rows, snapshotMap) {
    if (!snapshotMap || !snapshotMap.size) return rows;

    return rows.map((row) => {
      if (row.id === null) return row;
      const snap = snapshotMap.get(String(row.id));
      if (!snap) return row;

      return {
        ...row,
        dailyIncome: row.dailyIncome ?? snap.dailyIncome,
        weeklyIncome: row.weeklyIncome ?? snap.weeklyIncome,
        dailyCustomers: row.dailyCustomers ?? snap.dailyCustomers,
        weeklyCustomers: row.weeklyCustomers ?? snap.weeklyCustomers,
      };
    });
  }

  function averageNumeric(values) {
    const nums = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
    if (!nums.length) return null;
    return nums.reduce((sum, value) => sum + value, 0) / nums.length;
  }

  function medianNumeric(values) {
    const nums = values
      .filter((v) => typeof v === 'number' && Number.isFinite(v))
      .sort((a, b) => a - b);
    if (!nums.length) return null;
    const mid = Math.floor(nums.length / 2);
    return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
  }

  function percentDiff(value, baseline) {
    if (typeof value !== 'number' || typeof baseline !== 'number' || baseline === 0) return null;
    return ((value - baseline) / baseline) * 100;
  }

  function signedPercent(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
    return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
  }

  function formatCompareBaseline(percentValue, baselineValue, { money = false, label = '' } = {}) {
    const pct = signedPercent(percentValue);

    if (typeof baselineValue !== 'number' || !Number.isFinite(baselineValue)) {
      return pct;
    }

    const baselineText = money
      ? formatMoney(baselineValue)
      : formatNumber(baselineValue);

    return `${pct} · ${label ? `${label} ` : ''}${baselineText}`;
  }

  function compareClass(value, baseline) {
    if (typeof value !== 'number' || typeof baseline !== 'number') return '';
    return value >= baseline ? 'tds-v-good' : 'tds-v-bad';
  }

  function rankForMetric(rows, own, metric) {
    const ranked = rows
      .filter((row) => typeof row[metric] === 'number')
      .sort((a, b) => b[metric] - a[metric]);

    const index = ranked.findIndex((row) => isOwnCompareCompany(row, own));

    return {
      rows: ranked,
      rank: index >= 0 ? index + 1 : null,
      total: ranked.length,
      ownIndex: index,
      ownRow: index >= 0 ? ranked[index] : null,
    };
  }

  function metricTargetGap(rankedRows, ownValue, targetIndex) {
    if (!Array.isArray(rankedRows) || targetIndex < 0 || targetIndex >= rankedRows.length) return null;
    if (typeof ownValue !== 'number') return null;

    const targetValue = rankedRows[targetIndex];
    if (typeof targetValue !== 'number') return null;

    return Math.max(0, targetValue - ownValue + 1);
  }

  function revenuePerCustomer(income, customers) {
    if (typeof income !== 'number' || typeof customers !== 'number' || customers <= 0) return null;
    return income / customers;
  }

  function normalizeCompareCompanyName(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  function isOwnCompareCompany(row, own) {
    if (!row || !own) return false;

    if (own.id !== null && row.id !== null &&
        String(row.id) === String(own.id)) {
      return true;
    }

    const ownName = normalizeCompareCompanyName(own.name);
    const rowName = normalizeCompareCompanyName(row.name);

    return Boolean(ownName && rowName && ownName === rowName);
  }

  function compareMetricDefinition(label, metric, value, average, median, rankInfo, money = false) {
    const medianPct = percentDiff(value, median);
    const averagePct = percentDiff(value, average);

    return {
      label,
      metric,
      value,
      average,
      median,
      rankInfo,
      money,
      medianPct,
      averagePct,
      percentile:
        rankInfo?.rank !== null &&
        rankInfo?.rank !== undefined &&
        rankInfo?.total > 0
          ? ((rankInfo.total - rankInfo.rank + 1) / rankInfo.total) * 100
          : null,
    };
  }

  function compareMetricStrengthScore(item) {
    if (!item || typeof item.value !== 'number') return null;

    // Prefer rank percentile when available because it is directly tied to
    // the returned comparison set. Fall back to median difference otherwise.
    if (typeof item.percentile === 'number' && Number.isFinite(item.percentile)) {
      return item.percentile;
    }

    if (typeof item.medianPct === 'number' && Number.isFinite(item.medianPct)) {
      return 50 + Math.max(-50, Math.min(50, item.medianPct));
    }

    return null;
  }

  function compareGapToTop(item) {
    if (!item?.rankInfo?.rows?.length || typeof item.value !== 'number') return null;

    const top = item.rankInfo.rows.find((row) =>
      typeof row[item.metric] === 'number' &&
      Number.isFinite(row[item.metric])
    );

    if (!top) return null;

    const topValue = top[item.metric];
    return {
      topValue,
      absolute: Math.max(0, topValue - item.value),
      percent:
        item.value !== 0
          ? ((topValue - item.value) / Math.abs(item.value)) * 100
          : null,
    };
  }

  function formatCompareMetricValue(item, value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
    return item.money ? formatMoney(value) : formatNumber(value);
  }


  const STAFFING_BENCHMARK_MAX_COMPANIES = 25;
  const STAFFING_BENCHMARK_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h persistent local cache

  function staffingPositionName(value) {
    if (value === null || value === undefined) return 'Unassigned';

    if (typeof value === 'string' || typeof value === 'number') {
      const text = String(value).trim();
      return text || 'Unassigned';
    }

    if (typeof value !== 'object' || Array.isArray(value)) {
      return 'Unknown Position';
    }

    // Torn's public company/{id}/employees response may represent position
    // as an object rather than the plain string used by some company payloads.
    const directKeys = [
      'name',
      'title',
      'position',
      'position_name',
      'positionName',
      'role',
      'role_name',
      'roleName',
      'job',
      'job_title',
      'jobTitle',
    ];

    for (const key of directKeys) {
      const candidate = value[key];
      if (
        candidate !== null &&
        candidate !== undefined &&
        typeof candidate !== 'object'
      ) {
        const text = String(candidate).trim();
        if (text) return text;
      }
    }

    // Defensive one-level fallback for wrapped shapes such as
    // { position: { name: "Sales Assistant" } }.
    for (const child of Object.values(value)) {
      if (!child || typeof child !== 'object' || Array.isArray(child)) continue;

      for (const key of directKeys) {
        const candidate = child[key];
        if (
          candidate !== null &&
          candidate !== undefined &&
          typeof candidate !== 'object'
        ) {
          const text = String(candidate).trim();
          if (text) return text;
        }
      }
    }

    console.warn('[TDS] Staffing benchmark could not resolve position object:', value);
    return 'Unknown Position';
  }

  function positionCountsFromEmployees(employees) {
    const counts = new Map();

    for (const employee of employees || []) {
      const position = staffingPositionName(employee?.position);
      counts.set(position, (counts.get(position) || 0) + 1);
    }

    return counts;
  }

  function serializeStaffingBenchmarkData(data) {
    if (!data || typeof data !== 'object') return data;

    return {
      ...data,
      companies: (data.companies || []).map((company) => ({
        ...company,
        positions:
          company?.positions instanceof Map
            ? Object.fromEntries(company.positions)
            : (company?.positions && typeof company.positions === 'object'
                ? company.positions
                : {}),
      })),
    };
  }

  function rehydrateStaffingBenchmarkData(data) {
    if (!data || typeof data !== 'object') return data;

    return {
      ...data,
      companies: (data.companies || []).map((company) => {
        let positions = company?.positions;

        if (positions instanceof Map) {
          return company;
        }

        if (Array.isArray(positions)) {
          try {
            positions = new Map(positions);
          } catch (_) {
            positions = new Map();
          }
        } else if (positions && typeof positions === 'object') {
          positions = new Map(
            Object.entries(positions).map(([position, count]) => [
              position,
              Number(count) || 0,
            ])
          );
        } else {
          positions = new Map();
        }

        return {
          ...company,
          positions,
        };
      }),
    };
  }

  function loadPersistentStaffingCache() {
    const raw = GM_getValue(STORAGE_KEY_STAFFING_BENCHMARK_CACHE, {});
    return raw && typeof raw === 'object' ? raw : {};
  }

  function savePersistentStaffingCache(cache) {
    try {
      GM_setValue(STORAGE_KEY_STAFFING_BENCHMARK_CACHE, cache || {});
    } catch (err) {
      console.warn('[TDS] Could not persist staffing benchmark cache:', err);
    }
  }

  function prunePersistentStaffingCache(cache) {
    const now = Date.now();
    const next = {};

    for (const [key, entry] of Object.entries(cache || {})) {
      if (
        entry &&
        typeof entry === 'object' &&
        Number(entry.timestamp) > 0 &&
        now - Number(entry.timestamp) < STAFFING_BENCHMARK_CACHE_TTL_MS
      ) {
        next[key] = entry;
      }
    }

    return next;
  }

  function staffingCacheKey(companies) {
    return (companies || [])
      .map((row) => row?.id)
      .filter((id) => id !== null && id !== undefined)
      .map(String)
      .sort()
      .join(',');
  }

  async function fetchPublicCompanyStaffing(company) {
    if (!company || company.id === null || company.id === undefined) {
      throw new Error('Company ID unavailable');
    }

    const data = await ApiClient.callV2(
      `company/${encodeURIComponent(company.id)}/employees`
    );

    const employees = extractEmployeesEntries(data);

    return {
      id: company.id,
      name: company.name || `#${company.id}`,
      rating: company.rating ?? null,
      dailyIncome: company.dailyIncome ?? null,
      weeklyIncome: company.weeklyIncome ?? null,
      employeeCount: employees.length,
      positions: positionCountsFromEmployees(employees),
    };
  }

  async function buildStaffingBenchmark(companies, onProgress = null) {
    const candidates = [];
    const seen = new Set();

    for (const company of companies || []) {
      if (company?.id === null || company?.id === undefined) continue;
      const key = String(company.id);
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(company);
      if (candidates.length >= STAFFING_BENCHMARK_MAX_COMPANIES) break;
    }

    const key = staffingCacheKey(candidates);

    let cached = state.benchmark.staffingCache[key];

    if (
      !cached ||
      Date.now() - Number(cached.timestamp || 0) >= STAFFING_BENCHMARK_CACHE_TTL_MS
    ) {
      let persistent = prunePersistentStaffingCache(
        loadPersistentStaffingCache()
      );

      cached = persistent[key] || null;

      // Save back the pruned cache so stale benchmark payloads do not
      // accumulate indefinitely in userscript storage.
      savePersistentStaffingCache(persistent);

      if (cached) {
        cached = {
          ...cached,
          data: rehydrateStaffingBenchmarkData(cached.data),
        };
        state.benchmark.staffingCache[key] = cached;
      }
    }

    if (
      cached &&
      Date.now() - Number(cached.timestamp || 0) < STAFFING_BENCHMARK_CACHE_TTL_MS
    ) {
      return { ...cached.data, fromCache: true };
    }

    const companiesWithStaffing = [];
    const errors = [];

    for (let index = 0; index < candidates.length; index += 1) {
      const company = candidates[index];

      onProgress?.({
        complete: index,
        total: candidates.length,
        company,
      });

      try {
        const staffing = await fetchPublicCompanyStaffing(company);
        companiesWithStaffing.push(staffing);
      } catch (err) {
        errors.push({
          company,
          reason: String(err?.reason || err?.message || err || 'Unknown error'),
        });
      }
    }

    onProgress?.({
      complete: candidates.length,
      total: candidates.length,
      company: null,
    });

    const result = {
      requested: candidates.length,
      companies: companiesWithStaffing,
      errors,
      fromCache: false,
    };

    const cacheEntry = {
      timestamp: Date.now(),
      data: result,
    };

    state.benchmark.staffingCache[key] = cacheEntry;

    const persistent = prunePersistentStaffingCache(
      loadPersistentStaffingCache()
    );

    persistent[key] = {
      timestamp: cacheEntry.timestamp,
      data: serializeStaffingBenchmarkData(result),
    };

    savePersistentStaffingCache(persistent);

    return result;
  }

  function summarizeStaffingBenchmark(result, own) {
    const companies = result?.companies || [];
    const totalCompanies = companies.length;
    const positions = new Map();

    for (const company of companies) {
      const positionEntries =
        company?.positions instanceof Map
          ? company.positions.entries()
          : Object.entries(company?.positions || {});

      for (const [position, count] of positionEntries) {
        if (!positions.has(position)) {
          positions.set(position, {
            position,
            companiesUsing: 0,
            totalAssigned: 0,
          });
        }

        const row = positions.get(position);
        if (count > 0) row.companiesUsing += 1;
        row.totalAssigned += count;
      }
    }

    const ownCompany =
      companies.find((company) =>
        (own?.id !== null && own?.id !== undefined &&
          String(company.id) === String(own.id)) ||
        normalizeCompareCompanyName(company.name) ===
          normalizeCompareCompanyName(own?.name)
      ) || null;

    // If our company wasn't in the public benchmark fetch, use the locally
    // available employee roster so "Yours" still works for employee users.
    let ownPositions = ownCompany?.positions || null;
    let ownEmployeeCount = ownCompany?.employeeCount ?? null;

    if (!ownPositions && state.lastResults) {
      const localEmployees = extractEmployeesEntries(
        findRaw(state.lastResults, 'company', 'employees')
      );
      if (localEmployees.length) {
        ownPositions = positionCountsFromEmployees(localEmployees);
        ownEmployeeCount = localEmployees.length;
      }
    }

    const rows = [...positions.values()]
      .map((row) => {
        const usagePct =
          totalCompanies > 0
            ? (row.companiesUsing / totalCompanies) * 100
            : 0;

        const averagePerCompany =
          totalCompanies > 0
            ? row.totalAssigned / totalCompanies
            : 0;

        const yours = ownPositions
          ? (ownPositions.get(row.position) || 0)
          : null;

        return {
          ...row,
          usagePct,
          averagePerCompany,
          yours,
        };
      })
      .sort((a, b) =>
        b.usagePct - a.usagePct ||
        b.averagePerCompany - a.averagePerCompany ||
        a.position.localeCompare(b.position)
      );

    return {
      totalCompanies,
      averageEmployees:
        totalCompanies > 0
          ? companies.reduce((sum, company) => sum + company.employeeCount, 0) /
            totalCompanies
          : null,
      ownEmployeeCount,
      rows,
    };
  }

  function staffingObservation(row) {
    if (!row || row.position === 'Unknown Position') return null;
    if (typeof row?.yours !== 'number') return null;

    if (row.yours === 0 && row.usagePct >= 50) {
      return {
        cls: 'tds-v-warn',
        label: 'Missing common role',
      };
    }

    if (
      row.averagePerCompany >= 1 &&
      row.yours > 0 &&
      row.yours < row.averagePerCompany * 0.60
    ) {
      return {
        cls: 'tds-v-warn',
        label: 'Below benchmark',
      };
    }

    if (
      row.averagePerCompany > 0 &&
      row.yours > Math.max(2, row.averagePerCompany * 1.60)
    ) {
      return {
        cls: 'tds-v-dim',
        label: 'Above benchmark',
      };
    }

    return null;
  }

  function rosterRoleComparisonStyle(position, theirCount, ownPositions) {
    if (!ownPositions || typeof ownPositions.get !== 'function') {
      return {
        cls: '',
        title: `${position}: comparison unavailable`,
        you: null,
        difference: null,
      };
    }

    const yourCount = ownPositions.get(position) || 0;
    const difference = yourCount - theirCount;

    let cls = 'tds-v-warn';

    if (yourCount === 0) {
      cls = 'tds-v-bad';
    } else if (yourCount === theirCount) {
      cls = 'tds-v-good';
    }

    return {
      cls,
      title:
        `${position} — You: ${yourCount} · They: ${theirCount} · ` +
        `Difference: ${difference > 0 ? '+' : ''}${difference}`,
      you: yourCount,
      difference,
    };
  }

  function renderStaffingBenchmarkHtml(result, own, primaryMetric = 'weeklyIncome') {
    const summary = summarizeStaffingBenchmark(result, own);

    let ownPositions = null;

    const ownStaffingCompany = (result?.companies || []).find((company) =>
      (own?.id !== null && own?.id !== undefined &&
        String(company.id) === String(own.id)) ||
      normalizeCompareCompanyName(company.name) ===
        normalizeCompareCompanyName(own?.name)
    );

    if (ownStaffingCompany?.positions) {
      ownPositions = ownStaffingCompany.positions;
    } else if (state.lastResults) {
      const localEmployees = extractEmployeesEntries(
        findRaw(state.lastResults, 'company', 'employees')
      );
      if (localEmployees.length) {
        ownPositions = positionCountsFromEmployees(localEmployees);
      }
    }

    if (!summary.totalCompanies) {
      return `<div class="tds-box tds-box-warn">
        No public employee rosters could be read for the fetched comparison companies.
      </div>`;
    }

    let html = `<div class="tds-box tds-box-info">
      Staffing benchmark built from <strong>${formatNumber(summary.totalCompanies)}</strong>
      public company employee roster${summary.totalCompanies === 1 ? '' : 's'}.
      ${result.fromCache ? 'Loaded from the 6-hour local cache.' : ''}
      Only public position/headcount data is used.
    </div>`;

    html += `<div class="tds-card">
      <div class="tds-row">
        <span class="tds-row-label">Companies analysed</span>
        <span class="tds-row-value">${formatNumber(summary.totalCompanies)}</span>
      </div>
      <div class="tds-row">
        <span class="tds-row-label">Average total employees</span>
        <span class="tds-row-value">${summary.averageEmployees !== null ? summary.averageEmployees.toFixed(1) : '—'}</span>
      </div>
      <div class="tds-row">
        <span class="tds-row-label">Your total employees</span>
        <span class="tds-row-value">${summary.ownEmployeeCount !== null ? formatNumber(summary.ownEmployeeCount) : '—'}</span>
      </div>
      <div class="tds-row">
        <span class="tds-row-label">Roster fetch errors</span>
        <span class="tds-row-value ${result.errors?.length ? 'tds-v-warn' : 'tds-v-good'}">${formatNumber(result.errors?.length || 0)}</span>
      </div>
    </div>`;

    const observations = summary.rows
      .map((row) => ({ row, observation: staffingObservation(row) }))
      .filter((item) => item.observation);

    if (observations.length) {
      html += `<div class="tds-section-label">Staffing observations</div><div class="tds-card">`;
      observations.slice(0, 8).forEach(({ row, observation }) => {
        html += `<div class="tds-row">
          <span class="tds-row-label ${observation.cls}">${escapeHtml(observation.label)}</span>
          <span class="tds-row-value">
            ${escapeHtml(row.position)} · you ${formatNumber(row.yours)}
            · avg ${row.averagePerCompany.toFixed(1)}
            · used by ${row.usagePct.toFixed(0)}%
          </span>
        </div>`;
      });
      html += `</div>`;
    }

    html += `<div class="tds-section-label">Position benchmark</div>`;
    html += `<div style="overflow-x:auto;"><table class="tds-table tds-compare-table">
      <thead><tr>
        <th>Position</th>
        <th>Usage</th>
        <th>Avg / Co.</th>
        <th>Yours</th>
        <th>Comparison</th>
      </tr></thead><tbody>`;

    summary.rows.forEach((row) => {
      const observation = staffingObservation(row);
      const yoursText =
        typeof row.yours === 'number'
          ? formatNumber(row.yours)
          : '—';

      let comparison = '—';
      let comparisonCls = '';

      if (typeof row.yours === 'number') {
        const delta = row.yours - row.averagePerCompany;
        comparison =
          `${delta > 0 ? '+' : ''}${delta.toFixed(1)} vs avg`;
        comparisonCls =
          delta > 0.25
            ? 'tds-v-good'
            : delta < -0.25
              ? 'tds-v-warn'
              : '';
      }

      html += `<tr class="company-data-row">
        <td class="${row.position === 'Unknown Position' ? 'tds-v-warn' : ''}">
          <strong>${escapeHtml(row.position)}</strong>
          ${row.position === 'Unknown Position'
            ? '<div class="tds-v-warn" style="font-size:10px;">Unrecognised Torn position shape</div>'
            : observation
              ? `<div class="${observation.cls}" style="font-size:10px;">${escapeHtml(observation.label)}</div>`
              : ''}
        </td>
        <td>${row.usagePct.toFixed(0)}% (${formatNumber(row.companiesUsing)}/${formatNumber(summary.totalCompanies)})</td>
        <td>${row.averagePerCompany.toFixed(1)}</td>
        <td>${yoursText}</td>
        <td class="${comparisonCls}">${comparison}</td>
      </tr>`;
    });

    html += `</tbody></table></div>`;

    const rankedCompanies = [...(result.companies || [])]
      .filter((company) => typeof company[primaryMetric] === 'number')
      .sort((a, b) => b[primaryMetric] - a[primaryMetric])
      .slice(0, 5);

    if (rankedCompanies.length) {
      const incomeLabel =
        primaryMetric === 'weeklyIncome'
          ? 'Weekly Income'
          : 'Daily Income';

      html += `<div class="tds-section-label">Top earner rosters</div>
        <div class="tds-box tds-box-neutral">
          Exact public position composition for the top ${formatNumber(rankedCompanies.length)}
          earners among the companies successfully analysed.
          <div style="margin-top:8px;">
            <div><span class="tds-v-good"><strong>Green</strong></span> = exact role-count match.</div>
            <div><span class="tds-v-warn"><strong>Amber</strong></span> = you have the role, but the quantity differs.</div>
            <div><span class="tds-v-bad"><strong>Red</strong></span> = you do not currently have that role.</div>
          </div>
          <div style="margin-top:8px;">Hover a role to see the exact count comparison.</div>
        </div>`;

      rankedCompanies.forEach((company, index) => {
        const companyPositionEntries =
          company?.positions instanceof Map
            ? [...company.positions.entries()]
            : Object.entries(company?.positions || {});

        const tags = companyPositionEntries
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .map(([position, count]) => {
            const comparison = rosterRoleComparisonStyle(
              position,
              count,
              ownPositions
            );

            const border =
              comparison.cls === 'tds-v-good'
                ? 'rgba(61,220,132,.55)'
                : comparison.cls === 'tds-v-bad'
                  ? 'rgba(255,92,92,.55)'
                  : comparison.cls === 'tds-v-warn'
                    ? 'rgba(245,166,35,.55)'
                    : 'var(--tds-border-strong,#4a4a4a)';

            const background =
              comparison.cls === 'tds-v-good'
                ? 'rgba(61,220,132,.08)'
                : comparison.cls === 'tds-v-bad'
                  ? 'rgba(255,92,92,.08)'
                  : comparison.cls === 'tds-v-warn'
                    ? 'rgba(245,166,35,.08)'
                    : 'transparent';

            return `<span
              class="${comparison.cls}"
              title="${escapeHtml(comparison.title)}"
              style="display:inline-block;margin:2px 4px 2px 0;padding:3px 6px;border:1px solid ${border};background:${background};border-radius:5px;cursor:help;"
            >${formatNumber(count)}× ${escapeHtml(position)}</span>`;
          })
          .join('');

        html += `<div class="tds-card">
          <div class="tds-row">
            <span class="tds-row-label"><strong>#${index + 1} — ${escapeHtml(company.name)}</strong></span>
            <span class="tds-row-value">${company.rating !== null ? `${company.rating}★ · ` : ''}${formatCompareMetricValue({ money: true }, company[primaryMetric])}</span>
          </div>
          <div class="tds-v-dim" style="margin-bottom:6px;">${escapeHtml(incomeLabel)} · ${formatNumber(company.employeeCount)} employees</div>
          <div>${tags || 'No positions returned'}</div>
        </div>`;
      });
    }

    html += `<div class="tds-box tds-box-neutral">
      Position counts are descriptive benchmarks only. A common roster is not automatically the best roster for your company,
      and this section does not recommend staffing changes based on headcount alone.
    </div>`;

    return html;
  }

  async function renderBenchmarkResults(panel, data, own) {
    const el = panel.querySelector('[data-tabpanel="benchmark"] #tds-bench-results');
    if (!el) return;

    const ownId = own?.id ?? null;
    const ownRating = own?.rating ?? null;

    let rows = [];
    if (Array.isArray(data)) {
      rows = data;
    } else if (data?.companies && Array.isArray(data.companies)) {
      rows = data.companies;
    } else if (data?.companies && typeof data.companies === 'object') {
      rows = Object.values(data.companies);
    } else if (data && typeof data === 'object') {
      const arr = Object.values(data).find((v) => Array.isArray(v));
      if (arr) rows = arr;
    }

    if (!rows.length) {
      el.innerHTML = `<div class="tds-box tds-box-warn">No comparison companies were returned.</div>`;
      return;
    }

    let normalized = rows.map((row) => ({
      raw: row,
      id: numericValue(compareField(row, ['id', 'company_id', 'companyId'], /^id$|company.*id/i)),
      name: compareField(row, ['name', 'company_name', 'companyName'], /^name$|company.*name/i),
      rating: numericValue(compareField(row, ['rating', 'stars', 'star_rating'], /rating|stars/i)),
      dailyIncome: numericValue(compareField(row, ['daily_income', 'dailyIncome'], /daily.*income/i)),
      weeklyIncome: numericValue(compareField(row, ['weekly_income', 'weeklyIncome'], /weekly.*income/i)),
      dailyCustomers: numericValue(compareField(row, ['daily_customers', 'dailyCustomers'], /daily.*customer/i)),
      weeklyCustomers: numericValue(compareField(row, ['weekly_customers', 'weeklyCustomers'], /weekly.*customer/i)),
    }));

    let snapshotUsed = false;
    let snapshotError = null;

    const needsSnapshot = normalized.some((row) =>
      row.dailyIncome === null ||
      row.weeklyIncome === null ||
      row.dailyCustomers === null ||
      row.weeklyCustomers === null
    );

    if (needsSnapshot) {
      try {
        const snapshotMap = await getCompareSnapshotFinancialMap();
        normalized = mergeSnapshotFinancials(normalized, snapshotMap);
        snapshotUsed = true;
      } catch (err) {
        snapshotError = err;
        console.warn('[TDS] Compare Snapshot enrichment failed:', err);
      }
    }

    const tier = state.benchmark.tier || 'same';

    // Rating-specific requests are filtered by Torn server-side. Keep a light
    // defensive filter only when rating values are actually present.
    let filtered = normalized.filter((row) => {
      if (tier === 'all') return true;
      if (row.rating === null) return true;
      if (tier === 'same') return ownRating !== null ? row.rating === ownRating : true;
      if (tier === 'mid') return row.rating >= 3 && row.rating <= 5;
      if (tier === 'top') return row.rating >= 8 && row.rating <= 10;
      return true;
    });

    const hasWeeklyIncome = filtered.some((r) => r.weeklyIncome !== null);
    const hasDailyIncome = filtered.some((r) => r.dailyIncome !== null);
    const hasWeeklyCustomers = filtered.some((r) => r.weeklyCustomers !== null);
    const hasDailyCustomers = filtered.some((r) => r.dailyCustomers !== null);

    const metric = hasWeeklyIncome ? 'weeklyIncome' : (hasDailyIncome ? 'dailyIncome' : null);
    const metricLabel = metric === 'weeklyIncome' ? 'Weekly Income' : (metric === 'dailyIncome' ? 'Daily Income' : 'Company');

    const sorted = [...filtered].sort((a, b) => {
      if (!metric) return String(a.name || '').localeCompare(String(b.name || ''));
      return (b[metric] ?? -1) - (a[metric] ?? -1);
    });

    const ownIndex = sorted.findIndex((row) => isOwnCompareCompany(row, own));
    let ownRow = ownIndex >= 0 ? sorted[ownIndex] : null;

    if (!ownRow) {
      const currentResults = state.lastResults;
      const ownProfile = currentResults ? findRaw(currentResults, 'company', 'profile') : null;
      const ownDetailed = currentResults ? findRaw(currentResults, 'company', 'detailed') : null;
      const ownCombined = { ...(ownProfile || {}), ...(ownDetailed || {}) };

      ownRow = {
        id: own.id,
        name: own.name,
        rating: own.rating,
        dailyIncome: numericValue(findValueDeep(ownCombined, ['daily_income', 'dailyIncome'])),
        weeklyIncome: numericValue(findValueDeep(ownCombined, ['weekly_income', 'weeklyIncome'])),
        dailyCustomers: numericValue(findValueDeep(ownCombined, ['daily_customers', 'dailyCustomers'])),
        weeklyCustomers: numericValue(findValueDeep(ownCombined, ['weekly_customers', 'weeklyCustomers'])),
      };

      // Fill missing own-company financials from Snapshot too.
      try {
        const snapshotMap = await getCompareSnapshotFinancialMap();
        const snap = own.id !== null ? snapshotMap.get(String(own.id)) : null;
        if (snap) {
          ownRow.dailyIncome = ownRow.dailyIncome ?? snap.dailyIncome;
          ownRow.weeklyIncome = ownRow.weeklyIncome ?? snap.weeklyIncome;
          ownRow.dailyCustomers = ownRow.dailyCustomers ?? snap.dailyCustomers;
          ownRow.weeklyCustomers = ownRow.weeklyCustomers ?? snap.weeklyCustomers;
        }
      } catch (_) {}

      const hasOwnData =
        ownRow.dailyIncome !== null ||
        ownRow.weeklyIncome !== null ||
        ownRow.dailyCustomers !== null ||
        ownRow.weeklyCustomers !== null;

      if (!hasOwnData) ownRow = null;
    }

    const avgWeeklyIncome = averageNumeric(sorted.map((r) => r.weeklyIncome));
    const medianWeeklyIncome = medianNumeric(sorted.map((r) => r.weeklyIncome));
    const avgDailyIncome = averageNumeric(sorted.map((r) => r.dailyIncome));
    const avgWeeklyCustomers = averageNumeric(sorted.map((r) => r.weeklyCustomers));
    const avgDailyCustomers = averageNumeric(sorted.map((r) => r.dailyCustomers));

    const weeklyRpcRows = sorted
      .map((r) => ({ row: r, value: revenuePerCustomer(r.weeklyIncome, r.weeklyCustomers) }))
      .filter((x) => typeof x.value === 'number')
      .sort((a, b) => b.value - a.value);
    const avgWeeklyRpc = averageNumeric(weeklyRpcRows.map((x) => x.value));

    const dailyIncomeRank = rankForMetric(sorted, own, 'dailyIncome');
    const dailyCustomersRank = rankForMetric(sorted, own, 'dailyCustomers');
    const weeklyIncomeRank = rankForMetric(sorted, own, 'weeklyIncome');
    const weeklyCustomersRank = rankForMetric(sorted, own, 'weeklyCustomers');

    const medianDailyCustomers = medianNumeric(sorted.map((r) => r.dailyCustomers));
    const medianWeeklyCustomers = medianNumeric(sorted.map((r) => r.weeklyCustomers));

    function resolveRankFromValue(rankInfo, ownValue, metricName) {
      if (rankInfo.rank !== null || typeof ownValue !== 'number') return rankInfo;
      const rows = [...rankInfo.rows].sort((a, b) => b[metricName] - a[metricName]);
      let index = rows.findIndex((row) => typeof row[metricName] === 'number' && row[metricName] <= ownValue);
      if (index < 0) index = rows.length;
      return {
        ...rankInfo,
        rows,
        rank: index + 1,
        total: rows.length + 1,
        ownIndex: index,
        ownRow,
      };
    }

    const resolvedDailyIncomeRank = ownRow
      ? resolveRankFromValue(dailyIncomeRank, ownRow.dailyIncome, 'dailyIncome')
      : dailyIncomeRank;
    const resolvedDailyCustomersRank = ownRow
      ? resolveRankFromValue(dailyCustomersRank, ownRow.dailyCustomers, 'dailyCustomers')
      : dailyCustomersRank;
    const resolvedWeeklyIncomeRank = ownRow
      ? resolveRankFromValue(weeklyIncomeRank, ownRow.weeklyIncome, 'weeklyIncome')
      : weeklyIncomeRank;
    const resolvedWeeklyCustomersRank = ownRow
      ? resolveRankFromValue(weeklyCustomersRank, ownRow.weeklyCustomers, 'weeklyCustomers')
      : weeklyCustomersRank;

    const compareMetrics = ownRow
      ? [
          compareMetricDefinition(
            'Daily Income',
            'dailyIncome',
            ownRow.dailyIncome,
            avgDailyIncome,
            medianNumeric(sorted.map((r) => r.dailyIncome)),
            resolvedDailyIncomeRank,
            true
          ),
          compareMetricDefinition(
            'Daily Customers',
            'dailyCustomers',
            ownRow.dailyCustomers,
            avgDailyCustomers,
            medianDailyCustomers,
            resolvedDailyCustomersRank,
            false
          ),
          compareMetricDefinition(
            'Weekly Income',
            'weeklyIncome',
            ownRow.weeklyIncome,
            avgWeeklyIncome,
            medianWeeklyIncome,
            resolvedWeeklyIncomeRank,
            true
          ),
          compareMetricDefinition(
            'Weekly Customers',
            'weeklyCustomers',
            ownRow.weeklyCustomers,
            avgWeeklyCustomers,
            medianWeeklyCustomers,
            resolvedWeeklyCustomersRank,
            false
          ),
        ].filter((item) => typeof item.value === 'number')
      : [];

    const scoredCompareMetrics = compareMetrics
      .map((item) => ({
        ...item,
        strengthScore: compareMetricStrengthScore(item),
        topGap: compareGapToTop(item),
      }))
      .filter((item) => typeof item.strengthScore === 'number');

    const strongestMetric = scoredCompareMetrics.length
      ? [...scoredCompareMetrics].sort((a, b) => b.strengthScore - a.strengthScore)[0]
      : null;

    const weakestMetric = scoredCompareMetrics.length
      ? [...scoredCompareMetrics].sort((a, b) => a.strengthScore - b.strengthScore)[0]
      : null;

    const tierLabel =
      tier === 'same'
        ? (ownRating !== null ? `Same Rating (${ownRating}★)` : 'Same Rating')
        : tier === 'mid'
          ? '3–5★'
          : tier === 'top'
            ? '8–10★'
            : 'All Ratings';

    const pagination = data?._tdsPagination || null;

    let html = `<div class="tds-box tds-box-neutral">
      ${tier === 'all'
        ? 'Source: company type list.'
        : 'Source: Torn company/search with the selected rating band applied server-side.'}
    </div><div class="tds-card">`;
    html += `<div class="tds-row"><span class="tds-row-label">Selected rating</span><span class="tds-row-value">${escapeHtml(tierLabel)}</span></div>`;
    html += `<div class="tds-row"><span class="tds-row-label">Companies returned</span><span class="tds-row-value">${formatNumber(sorted.length)}</span></div>`;
    if (pagination) {
      html += `<div class="tds-row"><span class="tds-row-label">API pages fetched</span><span class="tds-row-value">${formatNumber(pagination.pagesFetched)}</span></div>`;
    }
    if (ownRow && metric) {
      const topRankInfo = metric === 'weeklyIncome'
        ? resolvedWeeklyIncomeRank
        : resolvedDailyIncomeRank;
      if (topRankInfo.rank !== null) {
        html += `<div class="tds-row"><span class="tds-row-label">Your rank by ${metricLabel}</span><span class="tds-row-value">#${topRankInfo.rank} / ${topRankInfo.total}</span></div>`;
      }
    }
    html += `</div>`;

    if (ownRow && compareMetrics.length) {
      html += `<div class="tds-section-label">Compare Insights</div>`;

      const primaryMetric =
        metric === 'weeklyIncome'
          ? compareMetrics.find((item) => item.metric === 'weeklyIncome')
          : compareMetrics.find((item) => item.metric === 'dailyIncome');

      html += `<div class="tds-optimizer-summary">`;

      if (primaryMetric?.rankInfo?.rank !== null) {
        html += `<div class="tds-optimizer-card">
          <div class="tds-optimizer-label">Your Rank</div>
          <div class="tds-optimizer-value">#${primaryMetric.rankInfo.rank} / ${primaryMetric.rankInfo.total}</div>
          <div class="tds-v-dim">${escapeHtml(primaryMetric.label)}</div>
        </div>`;
      }

      if (primaryMetric && typeof primaryMetric.medianPct === 'number') {
        html += `<div class="tds-optimizer-card">
          <div class="tds-optimizer-label">vs Median</div>
          <div class="tds-optimizer-value ${primaryMetric.medianPct >= 0 ? 'tds-v-good' : 'tds-v-bad'}">${signedPercent(primaryMetric.medianPct)}</div>
          <div class="tds-v-dim">${escapeHtml(primaryMetric.label)} · Median ${formatCompareMetricValue(primaryMetric, primaryMetric.median)}</div>
        </div>`;
      }

      if (primaryMetric?.topGap) {
        html += `<div class="tds-optimizer-card">
          <div class="tds-optimizer-label">Gap to #1</div>
          <div class="tds-optimizer-value">${formatCompareMetricValue(primaryMetric, primaryMetric.topGap.absolute)}</div>
          <div class="tds-v-dim">${typeof primaryMetric.topGap.percent === 'number' ? `${primaryMetric.topGap.percent.toFixed(1)}%` : ''}</div>
        </div>`;
      }

      if (strongestMetric) {
        html += `<div class="tds-optimizer-card">
          <div class="tds-optimizer-label">Strongest Metric</div>
          <div class="tds-optimizer-value tds-v-good" style="font-size:13px;">${escapeHtml(strongestMetric.label)}</div>
          <div class="tds-v-dim">${strongestMetric.rankInfo?.rank !== null
            ? `#${strongestMetric.rankInfo.rank} / ${strongestMetric.rankInfo.total}`
            : formatCompareBaseline(strongestMetric.medianPct, strongestMetric.median, { money: strongestMetric.money, label: 'Median' })}</div>
        </div>`;
      }

      if (weakestMetric) {
        html += `<div class="tds-optimizer-card">
          <div class="tds-optimizer-label">Weakest Metric</div>
          <div class="tds-optimizer-value ${weakestMetric.strengthScore < 50 ? 'tds-v-bad' : ''}" style="font-size:13px;">${escapeHtml(weakestMetric.label)}</div>
          <div class="tds-v-dim">${weakestMetric.rankInfo?.rank !== null
            ? `#${weakestMetric.rankInfo.rank} / ${weakestMetric.rankInfo.total}`
            : formatCompareBaseline(weakestMetric.medianPct, weakestMetric.median, { money: weakestMetric.money, label: 'Median' })}</div>
        </div>`;
      }

      html += `</div>`;

      html += `<div class="tds-card">`;

      if (strongestMetric) {
        html += `<div class="tds-row">
          <span class="tds-row-label">Strongest measurable area</span>
          <span class="tds-row-value tds-v-good">
            ${escapeHtml(strongestMetric.label)}
            ${typeof strongestMetric.medianPct === 'number'
              ? ` · ${signedPercent(strongestMetric.medianPct)} vs median (${formatCompareMetricValue(strongestMetric, strongestMetric.median)})`
              : ''}
          </span>
        </div>`;
      }

      if (weakestMetric) {
        html += `<div class="tds-row">
          <span class="tds-row-label">Weakest measurable area</span>
          <span class="tds-row-value ${typeof weakestMetric.medianPct === 'number' && weakestMetric.medianPct < 0 ? 'tds-v-bad' : ''}">
            ${escapeHtml(weakestMetric.label)}
            ${typeof weakestMetric.medianPct === 'number'
              ? ` · ${signedPercent(weakestMetric.medianPct)} vs median (${formatCompareMetricValue(weakestMetric, weakestMetric.median)})`
              : ''}
          </span>
        </div>`;
      }

      if (primaryMetric?.topGap) {
        html += `<div class="tds-row">
          <span class="tds-row-label">Top performer (${escapeHtml(primaryMetric.label)})</span>
          <span class="tds-row-value">
            ${formatCompareMetricValue(primaryMetric, primaryMetric.topGap.topValue)}
          </span>
        </div>`;
        html += `<div class="tds-row">
          <span class="tds-row-label">Difference to top performer</span>
          <span class="tds-row-value">
            ${formatCompareMetricValue(primaryMetric, primaryMetric.topGap.absolute)}
            ${typeof primaryMetric.topGap.percent === 'number' ? ` (${primaryMetric.topGap.percent.toFixed(1)}%)` : ''}
          </span>
        </div>`;
      }

      html += `</div>`;

      html += `<div class="tds-box tds-box-neutral">
        Insights use only the companies and measurable fields returned in this Compare fetch.
        They describe relative position within this fetched group and do not infer hidden Torn mechanics.
      </div>`;
    }

    if (ownRow) {
      html += `<div class="tds-section-label">Performance summary</div>`;
      html += `<div style="overflow-x:auto;"><table class="tds-table tds-compare-table"><thead><tr>
        <th>Metric</th>
        <th>Your Value</th>
        <th>vs Average</th>
        <th>vs Median</th>
        <th>Rank</th>
      </tr></thead><tbody>`;

      const performanceRows = [
        {
          label: 'Daily Income',
          value: ownRow.dailyIncome,
          average: avgDailyIncome,
          median: medianNumeric(sorted.map((r) => r.dailyIncome)),
          rank: resolvedDailyIncomeRank,
          money: true,
        },
        {
          label: 'Daily Customers',
          value: ownRow.dailyCustomers,
          average: avgDailyCustomers,
          median: medianDailyCustomers,
          rank: resolvedDailyCustomersRank,
          money: false,
        },
        {
          label: 'Weekly Income',
          value: ownRow.weeklyIncome,
          average: avgWeeklyIncome,
          median: medianWeeklyIncome,
          rank: resolvedWeeklyIncomeRank,
          money: true,
        },
        {
          label: 'Weekly Customers',
          value: ownRow.weeklyCustomers,
          average: avgWeeklyCustomers,
          median: medianWeeklyCustomers,
          rank: resolvedWeeklyCustomersRank,
          money: false,
        },
      ];

      performanceRows.forEach((item) => {
        if (item.value === null || item.value === undefined) return;
        const valueText = item.money ? formatMoney(item.value) : formatNumber(item.value);
        const avgText = formatCompareBaseline(
          percentDiff(item.value, item.average),
          item.average,
          { money: item.money, label: 'Avg' }
        );
        const medianText = formatCompareBaseline(
          percentDiff(item.value, item.median),
          item.median,
          { money: item.money, label: 'Median' }
        );
        const rankText = item.rank.rank !== null
          ? `#${item.rank.rank} / ${item.rank.total}`
          : '—';

        html += `<tr class="company-data-row">
          <td><strong>${item.label}</strong></td>
          <td class="${compareClass(item.value, item.average)}"><strong>${valueText}</strong></td>
          <td class="${compareClass(item.value, item.average)}">${avgText}</td>
          <td class="${compareClass(item.value, item.median)}">${medianText}</td>
          <td>${rankText}</td>
        </tr>`;
      });

      html += `</tbody></table></div>`;

      html += `<div class="tds-section-label">Your company</div><div class="tds-card">`;

      if (ownRow.weeklyIncome !== null) {
        html += `<div class="tds-row"><span class="tds-row-label">Weekly income</span><span class="tds-row-value ${compareClass(ownRow.weeklyIncome, avgWeeklyIncome)}">${formatMoney(ownRow.weeklyIncome)}</span></div>`;
        html += `<div class="tds-row"><span class="tds-row-label">vs weekly average</span><span class="tds-row-value ${compareClass(ownRow.weeklyIncome, avgWeeklyIncome)}">${formatCompareBaseline(percentDiff(ownRow.weeklyIncome, avgWeeklyIncome), avgWeeklyIncome, { money: true, label: 'Avg' })}</span></div>`;
        html += `<div class="tds-row"><span class="tds-row-label">vs weekly median</span><span class="tds-row-value ${compareClass(ownRow.weeklyIncome, medianWeeklyIncome)}">${formatCompareBaseline(percentDiff(ownRow.weeklyIncome, medianWeeklyIncome), medianWeeklyIncome, { money: true, label: 'Median' })}</span></div>`;
      }

      if (ownRow.dailyIncome !== null) {
        html += `<div class="tds-row"><span class="tds-row-label">Daily income</span><span class="tds-row-value ${compareClass(ownRow.dailyIncome, avgDailyIncome)}">${formatMoney(ownRow.dailyIncome)}</span></div>`;
      }

      if (ownRow.weeklyCustomers !== null) {
        html += `<div class="tds-row"><span class="tds-row-label">Weekly customers</span><span class="tds-row-value ${compareClass(ownRow.weeklyCustomers, avgWeeklyCustomers)}">${formatNumber(ownRow.weeklyCustomers)}</span></div>`;
      }

      if (ownRow.dailyCustomers !== null) {
        html += `<div class="tds-row"><span class="tds-row-label">Daily customers</span><span class="tds-row-value ${compareClass(ownRow.dailyCustomers, avgDailyCustomers)}">${formatNumber(ownRow.dailyCustomers)}</span></div>`;
      }

      const ownRpc = revenuePerCustomer(ownRow.weeklyIncome, ownRow.weeklyCustomers);
      if (ownRpc !== null) {
        html += `<div class="tds-row"><span class="tds-row-label">Weekly revenue / customer</span><span class="tds-row-value ${compareClass(ownRpc, avgWeeklyRpc)}">${formatMoney(ownRpc)}</span></div>`;
      }

      html += `</div>`;

      html += `<div class="tds-section-label">Targets</div><div class="tds-card">`;

      const targetMetrics = [
        { label: 'Weekly Income', metric: 'weeklyIncome', rankInfo: resolvedWeeklyIncomeRank, money: true },
        { label: 'Weekly Customers', metric: 'weeklyCustomers', rankInfo: resolvedWeeklyCustomersRank, money: false },
        { label: 'Daily Income', metric: 'dailyIncome', rankInfo: resolvedDailyIncomeRank, money: true },
        { label: 'Daily Customers', metric: 'dailyCustomers', rankInfo: resolvedDailyCustomersRank, money: false },
      ];

      targetMetrics.forEach((targetMetric) => {
        const ownValue = ownRow[targetMetric.metric];
        const info = targetMetric.rankInfo;

        if (typeof ownValue !== 'number' || !info.rows.length) return;

        html += `<div class="tds-section-label" style="margin-top:8px;">${targetMetric.label}</div>`;

        const targetRows = [
          { label: 'Next position', index: info.ownIndex > 0 ? info.ownIndex - 1 : null },
          { label: 'Top 10', index: info.rows.length >= 10 ? 9 : null },
          { label: 'Top 5', index: info.rows.length >= 5 ? 4 : null },
          { label: '#1', index: info.rows.length >= 1 ? 0 : null },
        ];

        targetRows.forEach((target) => {
          if (target.index === null || target.index < 0 || target.index >= info.rows.length) return;

          if (info.ownIndex >= 0 && info.ownIndex <= target.index) {
            html += `<div class="tds-row"><span class="tds-row-label">${target.label}</span><span class="tds-row-value tds-v-good">Achieved</span></div>`;
            return;
          }

          const targetValue = info.rows[target.index][targetMetric.metric];
          const needed = metricTargetGap(
            info.rows.map((row) => row[targetMetric.metric]),
            ownValue,
            target.index
          );

          if (needed === null) return;

          const neededText = targetMetric.money
            ? formatMoney(needed)
            : formatNumber(Math.ceil(needed));

          const pctNeeded = ownValue > 0 ? (needed / ownValue) * 100 : null;

          html += `<div class="tds-row">
            <span class="tds-row-label">${target.label}</span>
            <span class="tds-row-value">${neededText}${pctNeeded !== null ? ` (${pctNeeded.toFixed(1)}%)` : ''}</span>
          </div>`;
        });
      });

      html += `</div>`;
}

    const financialFieldCount = [
      hasDailyIncome,
      hasWeeklyIncome,
      hasDailyCustomers,
      hasWeeklyCustomers,
    ].filter(Boolean).length;

    if (snapshotUsed && financialFieldCount > 0) {
      html += `<div class="tds-box tds-box-info">
        <strong>Company Snapshot financials active.</strong>
        Missing income/customer values from the company-list response were filled from Torn's daily Snapshot by Company ID.
      </div>`;
    } else if (snapshotError && financialFieldCount === 0) {
      html += `<div class="tds-box tds-box-warn">
        <strong>Snapshot financial enrichment unavailable.</strong>
        ${escapeHtml(String(snapshotError.reason || snapshotError.message || 'Unknown error'))}
        Company comparison still works without invented financial values.
      </div>`;
    }

    html += `<div class="tds-section-label">Staffing Benchmark</div>
      <div id="tds-staffing-benchmark">
        <div class="tds-box tds-box-neutral">
          Compare public employee-position structures across up to
          <strong>${STAFFING_BENCHMARK_MAX_COMPANIES}</strong> of the fetched companies.
          This is loaded only when requested because each company roster requires a separate read-only Torn API request.
        </div>
        <button class="tds-btn" id="tds-load-staffing-benchmark">
          Load Staffing Benchmark
        </button>
        <div id="tds-staffing-progress" class="tds-v-dim" style="margin-top:8px;"></div>
        <div id="tds-staffing-results" style="margin-top:10px;"></div>
      </div>`;

    html += `<div class="tds-section-label">Comparison table</div>`;
    html += `<div style="overflow-x:auto;"><table class="tds-table tds-compare-table"><thead><tr>
      <th>#</th><th>Company</th><th>★</th>
      ${hasDailyIncome ? '<th>Daily Income</th>' : ''}
      ${hasDailyCustomers ? '<th>Daily Customers</th>' : ''}
      ${hasWeeklyIncome ? '<th>Weekly Income</th>' : ''}
      ${hasWeeklyCustomers ? '<th>Weekly Customers</th>' : ''}
    </tr></thead><tbody>`;

    sorted.slice(0, 25).forEach((row, i) => {
      const isYou = isOwnCompareCompany(row, own);
      html += `<tr class="company-data-row" style="${isYou ? 'color:var(--tds-accent,#3ddc84);font-weight:700;' : ''}">
        <td>${i + 1}</td>
        <td>${escapeHtml(String(row.name ?? `#${row.id ?? '?'}`))}${isYou ? ' (you)' : ''}</td>
        <td>${row.rating !== null ? `${row.rating}★` : '—'}</td>
        ${hasDailyIncome ? `<td>${row.dailyIncome !== null ? formatMoney(row.dailyIncome) : '—'}</td>` : ''}
        ${hasDailyCustomers ? `<td>${row.dailyCustomers !== null ? formatNumber(row.dailyCustomers) : '—'}</td>` : ''}
        ${hasWeeklyIncome ? `<td>${row.weeklyIncome !== null ? formatMoney(row.weeklyIncome) : '—'}</td>` : ''}
        ${hasWeeklyCustomers ? `<td>${row.weeklyCustomers !== null ? formatNumber(row.weeklyCustomers) : '—'}</td>` : ''}
      </tr>`;
    });

    html += `</tbody></table></div>`;

    if (sorted.length > 25) {
      html += `<div class="tds-box tds-box-neutral" style="margin-top:10px;">
        Showing <strong>25 companies</strong> in the table for readability.
        Rankings, averages, medians and targets use all <strong>${formatNumber(sorted.length)}</strong> companies fetched across
        <strong>${formatNumber(pagination?.pagesFetched || 1)}</strong> API page(s).
      </div>`;
    }

    if (pagination?.pagesFetched >= BENCHMARK_MAX_PAGES) {
      html += `<div class="tds-box tds-box-warn" style="margin-top:10px;">
        Compare reached the safety cap of <strong>${BENCHMARK_MAX_PAGES}</strong> API pages
        (${formatNumber(BENCHMARK_MAX_PAGES * BENCHMARK_PAGE_SIZE)} possible rows).
        Results are still valid for the companies fetched, but additional matches may exist beyond this cap.
      </div>`;
    }

    el.innerHTML = html;

    const staffingButton = el.querySelector('#tds-load-staffing-benchmark');
    const staffingProgress = el.querySelector('#tds-staffing-progress');
    const staffingResults = el.querySelector('#tds-staffing-results');

    if (staffingButton && staffingResults) {
      const staffingCandidates = sorted
        .filter((row) => row.id !== null && row.id !== undefined)
        .slice(0, STAFFING_BENCHMARK_MAX_COMPANIES);

      const primaryStaffingMetric =
        hasWeeklyIncome
          ? 'weeklyIncome'
          : hasDailyIncome
            ? 'dailyIncome'
            : 'weeklyIncome';

      const staffingKey = staffingCacheKey(staffingCandidates);

      let staffingCached = state.benchmark.staffingCache[staffingKey];

      if (
        !staffingCached ||
        Date.now() - Number(staffingCached.timestamp || 0) >= STAFFING_BENCHMARK_CACHE_TTL_MS
      ) {
        const persistent = prunePersistentStaffingCache(
          loadPersistentStaffingCache()
        );

        staffingCached = persistent[staffingKey] || null;

        if (staffingCached) {
          staffingCached = {
            ...staffingCached,
            data: rehydrateStaffingBenchmarkData(staffingCached.data),
          };
          state.benchmark.staffingCache[staffingKey] = staffingCached;
        }

        savePersistentStaffingCache(persistent);
      }

      if (
        staffingCached &&
        Date.now() - Number(staffingCached.timestamp || 0) < STAFFING_BENCHMARK_CACHE_TTL_MS
      ) {
        const ageMinutes = Math.max(
          0,
          Math.floor((Date.now() - Number(staffingCached.timestamp)) / 60000)
        );

        staffingButton.textContent = 'Refresh Staffing Benchmark';

        staffingResults.innerHTML = renderStaffingBenchmarkHtml(
          { ...staffingCached.data, fromCache: true },
          own,
          primaryStaffingMetric
        );

        if (staffingProgress) {
          staffingProgress.textContent =
            `Loaded from local cache · ${formatNumber(ageMinutes)} minute${ageMinutes === 1 ? '' : 's'} old · no roster API calls made.`;
        }
      }

      staffingButton.addEventListener('click', async () => {
        staffingButton.disabled = true;
        staffingButton.textContent = 'Loading Staffing…';

        if (staffingProgress) {
          staffingProgress.textContent =
            `Starting public roster comparison for up to ${formatNumber(staffingCandidates.length)} companies…`;
        }

        try {
          // Explicit refresh intentionally bypasses both the in-memory and
          // persistent cache for this comparison set.
          delete state.benchmark.staffingCache[staffingKey];

          const persistent = prunePersistentStaffingCache(
            loadPersistentStaffingCache()
          );
          delete persistent[staffingKey];
          savePersistentStaffingCache(persistent);

          const staffing = await buildStaffingBenchmark(
            staffingCandidates,
            (progress) => {
              if (!staffingProgress) return;

              staffingProgress.textContent =
                progress.company
                  ? `Reading roster ${formatNumber(progress.complete + 1)} / ${formatNumber(progress.total)} · ${progress.company.name || `#${progress.company.id}`}`
                  : `Roster requests complete · ${formatNumber(progress.total)} checked`;
            }
          );

          staffingResults.innerHTML = renderStaffingBenchmarkHtml(
            staffing,
            own,
            primaryStaffingMetric
          );

          if (staffingProgress) {
            staffingProgress.textContent =
              `${formatNumber(staffing.companies.length)} company roster(s) loaded · ${formatNumber(staffing.errors.length)} error(s).`;
          }

          staffingButton.textContent = 'Refresh Staffing Benchmark';
        } catch (err) {
          staffingResults.innerHTML = `<div class="tds-box tds-box-danger">
            <strong>Staffing benchmark failed:</strong>
            ${escapeHtml(String(err?.reason || err?.message || err || 'Unknown error'))}
          </div>`;

          if (staffingProgress) staffingProgress.textContent = '';
          staffingButton.textContent = 'Retry Staffing Benchmark';
        } finally {
          staffingButton.disabled = false;
        }
      });
    }
  }


  let footerTicker = null;

  function formatElapsed(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    if (total < 60) return `${total}s`;
    const minutes = Math.floor(total / 60);
    const secs = total % 60;
    if (minutes < 60) return `${minutes}:${String(secs).padStart(2, '0')}`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  function updateFooter(panel) {
    const status = panel.querySelector('#tds-footer-status');
    if (!status) return;

    if (!state.lastRunAt) {
      status.textContent = 'Last run: Never';
      return;
    }

    const secs = Math.floor((Date.now() - state.lastRunAt) / 1000);
    status.textContent = `Last run: ${formatElapsed(secs)}`;
  }

  function startFooterTicker(panel) {
    if (footerTicker) clearInterval(footerTicker);
    updateFooter(panel);
    footerTicker = setInterval(() => updateFooter(panel), 1000);
  }

  async function loadPersistedDiagnostic(panel) {
    try {
      let latest = null;
      try {
        latest = await LocalDB.getLatest('diagnostics');
      } catch (err) {
        console.warn('[TDS] IndexedDB diagnostic restore failed; trying fallback cache:', err);
      }

      let results = latest?.results;
      let timestamp = Number(latest?.timestamp) || 0;

      if (!Array.isArray(results) || !results.length) {
        const cached = GM_getValue(STORAGE_KEY_LAST_RESULTS, null);
        if (Array.isArray(cached) && cached.length) {
          results = cached;
          timestamp = Number(GM_getValue(STORAGE_KEY_LAST_RUN_AT, 0)) || Date.now();
        }
      }

      if (!Array.isArray(results) || !results.length) return false;

      // Rebuild the verdict from the current diagnostic results so wording
      // from older cached versions cannot reappear after an update.
      const verdict = classifyAccess(results);
      GM_setValue(STORAGE_KEY_LAST_VERDICT, verdict);

      state.lastResults = results;
      state.lastVerdict = verdict;
      state.lastRunAt = timestamp || Number(GM_getValue(STORAGE_KEY_LAST_RUN_AT, 0)) || null;

      if (state.lastRunAt) GM_setValue(STORAGE_KEY_LAST_RUN_AT, state.lastRunAt);

      renderOverviewTab(panel, results, verdict);
      renderDiagnosticsTab(panel, results);

      try { await renderFinanceTab(panel); } catch (err) { console.warn('[TDS] Finance restore failed:', err); }
      try { await renderStockTab(panel); } catch (err) { console.warn('[TDS] Stock restore failed:', err); }

      renderTrainingTab(panel).catch((err) => console.error('[TDS] Training render failed:', err));

      try { renderBenchmarkTab(panel); } catch (err) { console.warn('[TDS] Compare restore failed:', err); }
      renderOptimizeTab(panel).catch((err) => console.warn('[TDS] Effectiveness restore failed:', err));

      startFooterTicker(panel);

      checkLicense(panel).catch((err) => console.warn('[TDS] License restore check failed:', err));
      return true;
    } catch (err) {
      console.warn('[TDS] Could not load persisted diagnostics:', err);
      return false;
    }
  }

  async function runFullDiagnostic(panel, { force = false } = {}) {
    if (state.diagnosticRunning) return;

    const apiKey = GM_getValue(STORAGE_KEY_APIKEY, '');
    if (!apiKey) {
      const footer = panel.querySelector('#tds-footer-status');
      if (footer) footer.textContent = 'Last run: Never';
      switchTab(panel, 'settings');
      return;
    }

    state.diagnosticRunning = true;
    const footer = panel.querySelector('#tds-footer-status');
    if (footer) footer.textContent = 'Running diagnostic…';

    try {
      const results = await runDiagnostic();
      const verdict = classifyAccess(results);
      const completedAt = Date.now();

      try {
        await takeSnapshotFromDiagnostic(results);
      } catch (err) {
        console.warn('[TDS] Snapshot save failed, continuing with diagnostic data:', err);
      }

      try {
        await LocalDB.put('diagnostics', {
          timestamp: completedAt,
          results,
          verdict,
        });
      } catch (err) {
        console.warn('[TDS] IndexedDB diagnostic save failed; fallback cache will be used:', err);
      }

      GM_setValue(STORAGE_KEY_LAST_RESULTS, results);
      GM_setValue(STORAGE_KEY_LAST_VERDICT, verdict);
      GM_setValue(STORAGE_KEY_LAST_RUN_AT, completedAt);

      state.lastResults = results;
      state.lastVerdict = verdict;
      state.lastRunAt = completedAt;

      state.diagnosticRunning = false;
      startFooterTicker(panel);

      renderOverviewTab(panel, results, verdict);
      renderDiagnosticsTab(panel, results);

      try { await renderFinanceTab(panel); } catch (err) { console.error('[TDS] Finance render after diagnostic failed:', err); }
      try { await renderStockTab(panel); } catch (err) { console.error('[TDS] Stock render after diagnostic failed:', err); }

      renderTrainingTab(panel).catch((err) => console.error('[TDS] Training render failed:', err));

      try { renderBenchmarkTab(panel); } catch (err) { console.error('[TDS] Compare render after diagnostic failed:', err); }
      renderOptimizeTab(panel).catch((err) => console.error('[TDS] Effectiveness render after diagnostic failed:', err));

      checkLicense(panel, { force }).catch((err) => console.warn('[TDS] License check after diagnostic failed:', err));
    } catch (err) {
      console.error('[TDS] Diagnostic failed:', err);

      const restored = await loadPersistedDiagnostic(panel).catch(() => false);
      if (!restored) {
        state.lastRunAt = Number(GM_getValue(STORAGE_KEY_LAST_RUN_AT, 0)) || state.lastRunAt || null;
        updateFooter(panel);
      }

      throw err;
    } finally {
      state.diagnosticRunning = false;
      if (state.lastRunAt) startFooterTicker(panel);
      else updateFooter(panel);
    }
  }

  // ---------------------------------------------------------------------
  // 6. BOOT \u2014 the Management Suite lives only inside Torn's Jobs page.
  // Torn uses joblist.php with hash routes for the company/employment views.
  // We therefore watch route/DOM changes so the suite survives Torn's SPA-style
  // navigation without creating duplicate panels.
  //
  // Startup no longer relies on a separate "diagnostics completed" flag \u2014
  // whether a diagnostic has run is read directly from the persisted
  // IndexedDB record (the actual source of truth), which is simpler and
  // can't drift out of sync with what's really stored.
  // ---------------------------------------------------------------------
  let jobsBootTimer = null;
  let jobsObserver = null;

  async function bootJobsPage() {
    if (!isJobsPage()) {
      removePanel();
      return;
    }

    if (document.getElementById('tds-panel')) return;

    const mount = findJobsMount();
    if (!mount) return;

    detectTornColours();
    const panel = buildPanel(mount);

    // Hydrate the UI from the last persisted diagnostic first. This means a
    // Torn navigation/refresh does not trigger another API diagnostic.
    const hydrated = await loadPersistedDiagnostic(panel);
    if (hydrated) return;

    if (GM_getValue(STORAGE_KEY_APIKEY, '')) {
      try {
        await runFullDiagnostic(panel);
      } catch (err) {
        const status = panel.querySelector('#tds-footer-status');
        if (status) status.textContent = 'Last run: Never';
        console.error('[TDS] Automatic startup run failed:', err);
      }
    } else {
      updateFooter(panel);
      switchTab(panel, 'settings');
    }
  }

  function scheduleJobsBoot() {
    clearTimeout(jobsBootTimer);
    jobsBootTimer = setTimeout(() => {
      bootJobsPage().catch((err) => console.error('[TDS] Jobs page boot failed:', err));
    }, 80);
  }

  function startJobsNavigationWatcher() {
    const routeEvents = ['hashchange', 'popstate'];
    routeEvents.forEach((eventName) => window.addEventListener(eventName, scheduleJobsBoot));

    if (!jobsObserver) {
      jobsObserver = new MutationObserver(() => {
        if (isJobsPage() && !document.getElementById('tds-panel')) scheduleJobsBoot();
        if (!isJobsPage() && document.getElementById('tds-panel')) removePanel();
      });
      jobsObserver.observe(document.body, { childList: true, subtree: true });
    }

    scheduleJobsBoot();
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    injectStyles();
    startJobsNavigationWatcher();
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      injectStyles();
      startJobsNavigationWatcher();
    });
  }
})();