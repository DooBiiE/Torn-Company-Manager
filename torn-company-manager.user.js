// ==UserScript==
// @name         Torn Company Management Suite
// @namespace    torn-company-management-suite
// @version      1.1.2
// @description  Local-only company management dashboard for Torn directors, embedded in the Jobs page. No company data ever leaves your browser; only your Torn User ID is checked against a public license list.
// @author       you
// @match        https://www.torn.com/*
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
 * TABS THAT ARE STUBBED (LOCKED), NOT FAKED:
 *   Optimize needs each employee's raw working stats in a role they don't
 *   currently hold -- Torn does not expose that to a director's key. Rather
 *   than fake it, it stays locked until an opt-in flow exists.
 *
 * REQUIRED API KEY LEVEL:
 *   Full Access (or a Custom key covering company: profile/employees/
 *   detailed/stock/applications and user: basic/workstats/log) is needed for
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
  // UI version is read directly from the userscript @version metadata, so
  // the header and footer always stay in sync with one version source.
  const TDS_VERSION = (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version)
    ? GM_info.script.version
    : 'unknown';
  const STORAGE_KEY_APIKEY = 'tds_api_key';
  const STORAGE_KEY_LAST_RUN_AT = 'tds_last_run_at';
  const STORAGE_KEY_THEME = 'tds_theme';
  const STORAGE_KEY_LICENSE_CACHE = 'tds_license_cache';
  const MIN_CALL_INTERVAL_MS = 800; // ~75 req/min ceiling, well under Torn's 100/min cap
  const DB_NAME = 'torn_director_system';
  const DB_VERSION = 1;

  // Public list of licensed Torn User IDs. Only the numeric User ID (read
  // from user/basic, EXACT) is compared against this -- no API key or
  // company data is ever sent here. Expected shape (propose this to whoever
  // maintains the file if it isn't already in this form):
  //   [ { "userId": 4237873, "status": "active" }, { "userId": 1234567, "status": "expired" } ]
  // A "status" of anything other than "active"/"expired" (or a User ID not
  // present in the list at all) is treated as not licensed -- this never
  // guesses a license into existence.
  const LICENSE_JSON_URL = 'https://raw.githubusercontent.com/DooBiiE/Torn-Company-Manager/refs/heads/main/licensed-users.json';
  const LICENSE_CACHE_TTL_MS = 60 * 60 * 1000; // 1h -- avoids hitting GitHub raw on every page load/navigation

  // Torn's Custom Key Builder deep-link format. The ONLY publicly confirmed
  // working example uses `user`, `faction`, and `torn` as section params —
  // nobody has published a working example using `company` this way, and a
  // real test of an earlier version of this link (with `company=...` added)
  // came back "Wrong format". Rather than guess at the right company
  // selection tokens a second time, this link now only includes the parts
  // that match the confirmed pattern (title + user + torn). The company
  // selections (Profile, Employees, Detailed, Stock, Applications) have to
  // be ticked manually on the page this opens — see the instructions next
  // to the button in Settings.
  const CUSTOM_KEY_TITLE = 'Torn Company Management Suite';
  const CUSTOM_KEY_SECTIONS = {
    user: 'basic,workstats,log',
    torn: 'companies',
  };
  function buildCustomKeyUrl() {
    const params = [`title=${encodeURIComponent(CUSTOM_KEY_TITLE)}`];
    for (const [section, selections] of Object.entries(CUSTOM_KEY_SECTIONS)) {
      params.push(`${section}=${encodeURIComponent(selections)}`);
    }
    return `https://www.torn.com/preferences.php#tab=api?step=addNewKey&${params.join('&')}`;
  }

  const PROBE_PLAN = [
    { section: 'company', selections: 'profile', label: 'Company profile' },
    { section: 'company', selections: 'employees', label: 'Employee roster' },
    { section: 'company', selections: 'detailed', label: 'Company financials' },
    { section: 'company', selections: 'stock', label: 'Company stock' },
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

    return { call };
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

  const MAX_SNAPSHOTS = 120; // matches the "120 max stored locally" retention policy

  async function pruneSnapshots() {
    const all = await LocalDB.getAll('snapshots');
    if (all.length <= MAX_SNAPSHOTS) return;
    all.sort((a, b) => a.timestamp - b.timestamp);
    const toRemove = all.slice(0, all.length - MAX_SNAPSHOTS);
    for (const row of toRemove) await LocalDB.deleteKey('snapshots', row.id);
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
    const snapshot = { timestamp: Date.now(), source: 'api' };
    for (const r of results) {
      if (r.status === 'ok') snapshot[`${r.section}_${r.selections}`] = r.raw;
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
        headline: 'Director-level access confirmed',
        detail: 'company/detailed, company/stock, and company/applications all returned real data. This key can drive the full system.',
      };
    }
    if (roster?.status === 'ok' && directorOkCount === 0 && directorBlockedCount > 0) {
      return {
        level: 'employee',
        headline: 'Employee-level access only',
        detail: 'Roster is visible, but financials/stock/applications are blocked (' +
          directorSignals.map((r) => `${r.selections}: ${r.reason || 'blocked'}`).join('; ') +
          '). This is a role check (are you the director of this company), not a key-tier limit — ' +
          'a higher-access key on the same non-director account will not unlock these.',
      };
    }
    if (directorOkCount > 0 && directorOkCount < directorSignals.length) {
      return {
        level: 'partial',
        headline: 'Partial / custom access',
        detail: 'Some director-level selections succeeded, others didn\u2019t \u2014 looks like a Custom key missing a selection, not a role limit.',
      };
    }
    return {
      level: 'unknown',
      headline: 'Access level unclear',
      detail: 'Not enough successful probes to classify yet. Check the Diagnostics tab.',
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
    benchmark: { tier: 'same', cache: {} }, // cache keyed by categoryId -> { timestamp, data }
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
          <span class="tds-brand-subtitle">Company Director Dashboard</span>
        </div>
        <div id="tds-header-icons">
          <button data-action="refresh" title="Run Diagnostics Again">\u27f3</button>
          <button data-action="tab-settings" title="Settings">\u2699</button>
        </div>
      </div>
      <div id="tds-tabs">
        <button class="tds-tab tds-tab-active" data-tab="overview">OVERVIEW</button>
        <button class="tds-tab" data-tab="finance">FINANCE</button>
        <button class="tds-tab" data-tab="training">TRAINING</button>
        <button class="tds-tab" data-tab="benchmark">BENCHMARK</button>
        <button class="tds-tab tds-tab-locked" data-tab="optimize" title="Needs a resolved position-fit formula (see tab)">OPTIMIZE</button>
        <button class="tds-tab" data-tab="settings">SETTINGS</button>
        <button class="tds-tab" data-tab="diagnostics">DIAGNOSTICS</button>
      </div>
      <div id="tds-body">
        <div class="tds-tabpanel" data-tabpanel="overview"></div>
        <div class="tds-tabpanel" data-tabpanel="finance" hidden></div>
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
    renderLockedTabs(panel);
    renderFinanceTab(panel);
    renderTrainingTab(panel);
    renderBenchmarkTab(panel);
    switchTab(panel, 'overview');

    return panel;
  }

  function switchTab(panel, tabName) {
    panel.querySelectorAll('.tds-tab').forEach((b) => b.classList.toggle('tds-tab-active', b.dataset.tab === tabName));
    panel.querySelectorAll('.tds-tabpanel').forEach((p) => {
      p.hidden = p.dataset.tabpanel !== tabName;
    });
  }

  function renderLockedTabs(panel) {
    const lockedHtml = (label, reason) => `
      <div class="tds-box tds-box-neutral">
        <strong>${label} is locked.</strong> ${reason}
      </div>`;
    panel.querySelector('[data-tabpanel="optimize"]').innerHTML = lockedHtml(
      'Optimize',
      'This needs each employee\u2019s raw working stats (manual/intelligence/endurance) to compute their effectiveness in a <em>different</em> position \u2014 Torn does not expose other employees\u2019 raw stats to the director\u2019s key, only their effectiveness in their <em>current</em> role. This tab will support employees who opt in with a scoped read-only key of their own. Not built yet.'
    );
  }

  function renderSettingsTab(panel) {
    const el = panel.querySelector('[data-tabpanel="settings"]');
    const currentTheme = GM_getValue(STORAGE_KEY_THEME, 'green');

    el.innerHTML = `
      <div class="tds-section-label">API Key</div>
      <div class="tds-box tds-box-neutral">Stored only in this browser (Tampermonkey local storage). Never sent anywhere except api.torn.com.</div>
      <div class="tds-box tds-box-warn">
        <strong>What actually gates each selection</strong> (confirmed by testing a real key at both Limited
        and Full Access, not assumed):
        <ul style="margin:6px 0 0 18px; padding:0;">
          <li><code>company: detailed, stock, applications</code> \u2014 gated by <strong>being the company
            director</strong>, not by key tier. These returned BLOCKED (Torn error 7, "Incorrect ID-entity
            relation") even with a Full Access key belonging to a non-director. No key upgrade fixes this;
            only the director's own key gets real data here.</li>
          <li><code>user: log</code> (training history) \u2014 <strong>is</strong> tier-gated: BLOCKED at Limited
            (error 16, "access level not high enough"), ACCESSIBLE at Full.</li>
          <li><code>company: profile, employees</code> and <code>user: basic, workstats</code> \u2014 worked at
            Limited already.</li>
        </ul>
      </div>
      <div class="tds-box tds-box-neutral">
        Rather than handing out a broad Full Access key, use Torn's Custom Key Builder to request only what
        this suite uses. The button below opens it with your key title and the <code>user</code>/<code>torn</code>
        selections pre-filled \u2014 that part is confirmed working. The <code>company</code> selections
        <strong>could not be reliably pre-filled</strong> (an earlier attempt at this produced a "Wrong format"
        error, and there's no confirmed example of doing this for the company section), so tick these five
        boxes yourself once the page opens: <strong>Profile, Employees, Detailed, Stock, Applications</strong>
        (exact on-page wording may differ slightly \u2014 look for the closest match under "Company").
      </div>
      <button class="tds-btn-ghost" id="tds-custom-key-link">Open Custom Key Builder \u2197</button>
      <input class="tds-input" id="tds-keyinput" type="text" placeholder="Paste API key here" style="margin-top:8px;" />
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
    keyInput.value = GM_getValue(STORAGE_KEY_APIKEY, '');

    // Opens Torn's own key-creation page pre-filled with exactly the
    // selections this suite uses. This is a plain outbound link the user
    // clicks themselves — nothing here submits anything on their behalf.
    el.querySelector('#tds-custom-key-link').addEventListener('click', () => {
      window.open(buildCustomKeyUrl(), '_blank', 'noopener');
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

  function renderOverviewTab(panel, results, verdict) {
    const el = panel.querySelector('[data-tabpanel="overview"]');
    if (!results || !verdict) {
      el.innerHTML = `<div class="tds-box tds-box-neutral">No data yet. Add your API key in Settings, then run Diagnostics.</div>`;
      return;
    }

    let html = '';
    const boxClass = verdict.level === 'director' ? 'tds-box-info' : verdict.level === 'unknown' ? 'tds-box-danger' : 'tds-box-warn';
    html += `<div class="tds-box ${boxClass}"><strong>${escapeHtml(verdict.headline)}</strong><br>${escapeHtml(verdict.detail)}</div>`;

    const profile = findRaw(results, 'company', 'profile');
    if (profile) {
      html += '<div class="tds-section-label">Company</div><div class="tds-card">';
      Object.entries(profile).slice(0, 12).forEach(([k, v]) => {
        if (v && typeof v === 'object') return;
        html += `<div class="tds-row"><span class="tds-row-label">${escapeHtml(String(k))}</span><span class="tds-row-value">${escapeHtml(String(v))}</span></div>`;
      });
      html += '</div>';
    }

    const employeesRaw = findRaw(results, 'company', 'employees');
    const employees = extractEmployeesEntries(employeesRaw);

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

        const statusText = status?.description || status?.state || lastAction?.status || '—';
        const location = status?.description?.match(/^Traveling from Torn to (.+)$/i)?.[1]
          || status?.location
          || '—';

        // <details>/<summary> gives free, accessible, keyboard-operable
        // collapse behaviour with no extra JS or state tracking needed —
        // the name/position/status row is always visible; everything below
        // it only renders open when the director clicks to expand it.
        html += `
          <details class="tds-employee-row">
            <summary class="tds-employee-summary">
              <div class="tds-employee-top">
                <div>
                  <div class="tds-employee-name">${escapeHtml(String(employee.name))}</div>
                  <div class="tds-employee-meta">${escapeHtml(String(employee.position || 'Employee'))}</div>
                </div>
                <div style="display:flex; align-items:center; gap:8px;">
                  <span class="tds-badge tds-badge-neutral">${escapeHtml(String(statusText))}</span>
                  <span class="tds-employee-chevron">\u25b8</span>
                </div>
              </div>
            </summary>

            <div class="tds-card" style="margin:8px 0 0;">
              <div class="tds-row"><span class="tds-row-label">Days employed</span><span class="tds-row-value">${formatNumber(emp.days_in_company)}</span></div>
              <div class="tds-section-label" style="margin-top:10px;">Working Stats</div>
              <div class="tds-row"><span class="tds-row-label">Manual Labor</span><span class="tds-row-value">${formatNumber(emp.manual_labor)}</span></div>
              <div class="tds-row"><span class="tds-row-label">Intelligence</span><span class="tds-row-value">${formatNumber(emp.intelligence)}</span></div>
              <div class="tds-row"><span class="tds-row-label">Endurance</span><span class="tds-row-value">${formatNumber(emp.endurance)}</span></div>

              ${effectiveness ? `
                <div class="tds-section-label" style="margin-top:10px;">Effectiveness</div>
                <div class="tds-row"><span class="tds-row-label">Working Stats</span><span class="tds-row-value">${formatNumber(effectiveness.working_stats)}</span></div>
                <div class="tds-row"><span class="tds-row-label">Settled In</span><span class="tds-row-value">${formatNumber(effectiveness.settled_in)}</span></div>
                <div class="tds-row"><span class="tds-row-label">Director Education</span><span class="tds-row-value">${formatNumber(effectiveness.director_education)}</span></div>
                <div class="tds-row"><span class="tds-row-label">Addiction</span><span class="tds-row-value">${formatNumber(effectiveness.addiction)}</span></div>
                <div class="tds-row"><span class="tds-row-label">Total</span><span class="tds-row-value">${formatNumber(effectiveness.total)}</span></div>
              ` : ''}

              ${status || lastAction ? `
                <div class="tds-section-label" style="margin-top:10px;">Status</div>
                <div class="tds-row"><span class="tds-row-label">Status</span><span class="tds-row-value">${escapeHtml(String(statusText))}</span></div>
                <div class="tds-row"><span class="tds-row-label">State</span><span class="tds-row-value">${escapeHtml(String(status?.state || '—'))}</span></div>
                <div class="tds-row"><span class="tds-row-label">Location</span><span class="tds-row-value">${escapeHtml(String(location))}</span></div>
                <div class="tds-row"><span class="tds-row-label">Last action</span><span class="tds-row-value">${escapeHtml(String(lastAction?.relative || formatTimestampRelative(lastAction?.timestamp)))}</span></div>
              ` : ''}
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
  const LICENSE_GATED_TABS = ['overview', 'finance', 'training', 'benchmark'];

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

  function licenseStatusMeta(status) {
    switch (status) {
      case 'active': return { label: 'ACTIVE', cls: 'tds-v-good' };
      case 'expired': return { label: 'EXPIRED', cls: 'tds-v-bad' };
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
      const rawStatus = String(entry?.status ?? entry?.flag ?? entry?.state ?? '').toLowerCase();
      const status = !entry ? 'unlicensed'
        : rawStatus === 'active' ? 'active'
        : rawStatus === 'expired' ? 'expired'
        : 'unknown';
      state.license = { status, checkedAt: Date.now(), userId, source: 'github' };
      if (status === 'unknown' && entry) {
        state.license.reason = `Entry found but status field ("${entry.status ?? entry.flag ?? entry.state}") wasn\u2019t "active" or "expired".`;
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
    const reasonRow = el.querySelector('#tds-license-reason-row');
    const reasonEl = el.querySelector('#tds-license-reason');
    if (!idEl || !statusEl || !checkedEl) return;

    const license = state.license;
    if (!license) {
      idEl.textContent = '\u2014';
      statusEl.textContent = 'Not checked yet';
      statusEl.className = 'tds-row-value tds-v-dim';
      checkedEl.textContent = '\u2014';
      if (reasonRow) reasonRow.style.display = 'none';
      return;
    }

    idEl.textContent = license.userId ?? '\u2014';
    const meta = licenseStatusMeta(license.status);
    statusEl.textContent = meta.label;
    statusEl.className = `tds-row-value ${meta.cls}`;
    checkedEl.textContent = license.checkedAt ? formatTimestampRelative(license.checkedAt) : '\u2014';

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

  function findEffectivenessField(emp) {
    if (!emp || typeof emp !== 'object') return null;
    const key = Object.keys(emp).find((k) => /effectiveness|^ee$/i.test(k) && typeof emp[k] === 'number');
    return key ? { key, value: emp[key] } : null;
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

    // Income-shaped fields can live on EITHER company/profile or
    // company/detailed depending on your key's access level and how Torn
    // has split that data — searching only one was the bug that made Gross
    // show "unavailable" even when the field existed on the other response.
    // Merging is safe: a field name collision would mean the same field
    // appearing in both, not conflicting values.
    const combined = { ...(profile || {}), ...(detailed || {}) };
    const incomeFields = Object.entries(combined).filter(([k, v]) => typeof v === 'number' && /profit|income/i.test(k));
    const dailyField = incomeFields.find(([k]) => /daily/i.test(k));
    const weeklyField = incomeFields.find(([k]) => /weekly/i.test(k));

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

    const todayGross = dailyField ? dailyField[1] : null;
    const todayNet = todayGross !== null && totalSalary !== null ? todayGross - totalSalary : null;

    // --- Today snapshot card ---
    html += '<div class="tds-section-label">Today</div><div class="tds-card">';
    html += `<div class="tds-row"><span class="tds-row-label">Gross${dailyField ? ` (${dailyField[0]})` : ''}</span><span class="tds-row-value">${todayGross !== null ? formatMoney(todayGross) : '<span class="tds-v-dim">unavailable</span>'}</span></div>`;
    html += `<div class="tds-row"><span class="tds-row-label">Salaries${salaryFieldName ? ` (${salaryFieldName})` : ''}</span><span class="tds-row-value tds-v-bad">${totalSalary !== null ? '-' + formatMoney(totalSalary) : '<span class="tds-v-dim">no wage field in this key\u2019s response</span>'}</span></div>`;
    html += `<div class="tds-row"><span class="tds-row-label">Net (DERIVED)</span><span class="tds-row-value ${todayNet !== null ? (todayNet >= 0 ? 'tds-v-good' : 'tds-v-bad') : ''}">${todayNet !== null ? formatMoney(todayNet) : '<span class="tds-v-dim">needs gross + salary above</span>'}</span></div>`;
    if (weeklyField) {
      html += `<div class="tds-row"><span class="tds-row-label">Weekly (${weeklyField[0]})</span><span class="tds-row-value">${formatMoney(weeklyField[1])}</span></div>`;
    }
    html += '</div>';
    if (todayGross === null) {
      html += `<div class="tds-box tds-box-warn">No field on <em>company/profile</em> or <em>company/detailed</em> looked like a profit/income number. Fields actually present \u2014 profile: ${profile ? Object.keys(profile).join(', ') : (blockedProfile || 'blocked')}; detailed: ${detailed ? Object.keys(detailed).join(', ') : (blockedDetailed || 'blocked')}. If one of these is the real income field under a name I didn\u2019t recognize, tell me the name and I\u2019ll wire it in directly instead of guessing.</div>`;
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

    // --- Historical comparison from local snapshots ---
    // Snapshots store profile and detailed under separate keys (matching how
    // they were fetched), so merge them per-snapshot the same way as above —
    // otherwise a snapshot taken when only "detailed" held the income field
    // would silently be treated as having no income data at all.
    function snapshotIncomeFields(snap) {
      return { ...(snap.company_profile || {}), ...(snap.company_detailed || {}) };
    }
    function findDailyIncome(snap) {
      const merged = snapshotIncomeFields(snap);
      return Object.entries(merged).find(([k, v]) => typeof v === 'number' && /daily/i.test(k) && /profit|income/i.test(k));
    }

    const allSnapshots = await getSnapshotsSorted();
    const withIncomeData = allSnapshots.filter((s) => s.company_profile || s.company_detailed);
    const daily = collapseToDaily(withIncomeData);

    html += '<div class="tds-section-label">Today vs Yesterday <span class="tds-v-dim" style="font-weight:400;">(HISTORICAL \u2014 from local snapshots only)</span></div>';
    if (daily.length < 2) {
      html += `<div class="tds-box tds-box-neutral">Insufficient data \u2014 only ${daily.length} day${daily.length === 1 ? '' : 's'} of local snapshots so far. This starts filling in from tomorrow\u2019s first run onward; nothing here is backfilled or estimated.</div>`;
    } else {
      const todaySnap = daily[daily.length - 1];
      const ySnap = daily[daily.length - 2];
      const gField = findDailyIncome(todaySnap);
      const yField = gField ? [gField[0], snapshotIncomeFields(ySnap)[gField[0]]] : null;
      html += '<div class="tds-card">';
      if (gField && yField && typeof yField[1] === 'number') {
        const change = gField[1] - yField[1];
        const pct = yField[1] !== 0 ? (change / Math.abs(yField[1])) * 100 : null;
        html += `<div class="tds-row"><span class="tds-row-label">Today</span><span class="tds-row-value">${formatMoney(gField[1])}</span></div>`;
        html += `<div class="tds-row"><span class="tds-row-label">Yesterday (last snapshot that day)</span><span class="tds-row-value">${formatMoney(yField[1])}</span></div>`;
        html += `<div class="tds-row"><span class="tds-row-label">Change</span><span class="tds-row-value ${change >= 0 ? 'tds-v-good' : 'tds-v-bad'}">${change >= 0 ? '+' : ''}${formatMoney(change)}${pct !== null ? ` (${change >= 0 ? '\u2191' : '\u2193'} ${Math.abs(pct).toFixed(1)}%)` : ''}</span></div>`;
      } else {
        html += `<div class="tds-row-label">Couldn\u2019t match a comparable income field between the two snapshots.</div>`;
      }
      html += '</div>';

      // Sparkline of last up to 7 local daily snapshots
      const recent = daily.slice(-7);
      const values = recent.map((s) => {
        const f = findDailyIncome(s);
        return f ? f[1] : null;
      }).filter((v) => v !== null);
      if (values.length >= 2) {
        const maxAbs = Math.max(...values.map((v) => Math.abs(v)), 1);
        html += `<div class="tds-section-label">Last ${values.length} days <span class="tds-v-dim" style="font-weight:400;">(local snapshots)</span></div><div class="tds-card"><div class="tds-spark">`;
        recent.forEach((s) => {
          const f = findDailyIncome(s);
          const v = f ? f[1] : 0;
          const h = Math.max(2, Math.round((Math.abs(v) / maxAbs) * 40));
          const cls = v >= 0 ? 'tds-bar-pos' : 'tds-bar-neg';
          const d = new Date(s.timestamp);
          html += `<div class="tds-spark-col"><div class="tds-spark-bar ${cls}" style="height:${h}px" title="${formatMoney(v)}"></div><div class="tds-spark-label">${d.getMonth() + 1}/${d.getDate()}</div></div>`;
        });
        html += '</div></div>';
      }
    }

    html += `<div class="tds-box tds-box-neutral" style="margin-top:10px;">One snapshot is taken per diagnostic run, up to ${MAX_SNAPSHOTS} kept locally (oldest pruned first). Run Diagnostics Again when you want a fresh snapshot.</div>`;

    el.innerHTML = html;
  }

  // =======================================================================
  // TRAINING TAB
  // =======================================================================
  function renderTrainingTab(panel) {
    const el = panel.querySelector('[data-tabpanel="training"]');
    const results = state.lastResults;
    if (!results) {
      el.innerHTML = `<div class="tds-box tds-box-neutral">Run the diagnostic first \u2014 Training reads the employee roster and, where accessible, your event log.</div>`;
      return;
    }

    const employeesRaw = findRaw(results, 'company', 'employees');
    const employees = extractEmployeesEntries(employeesRaw);
    const profile = findRaw(results, 'company', 'profile');
    const logRaw = findRaw(results, 'user', 'log');
    const logBlockedReason = findBlockedReason(results, 'user', 'log');
    const mode = state.trainingMode || 'priority';

    let html = '';
    html += `
      <div class="tds-segmented">
        <div class="tds-segment ${mode === 'priority' ? 'tds-segment-active' : ''}" data-trainmode="priority">PRIORITY</div>
        <div class="tds-segment ${mode === 'rotational' ? 'tds-segment-active' : ''}" data-trainmode="rotational">ROTATIONAL / DEBT</div>
      </div>`;

    if (employees.length === 0) {
      html += `<div class="tds-box tds-box-danger">Employee roster unavailable, so there\u2019s nothing to build a queue from.</div>`;
      el.innerHTML = html;
      return;
    }

    const ratingField = profile && Object.entries(profile).find(([k, v]) => typeof v === 'number' && /rating/i.test(k));
    html += `<div class="tds-box tds-box-neutral">Daily train budget is commonly understood to equal your company\u2019s star rating${ratingField ? ` (rating: ${ratingField[1]}\u2605, so \u2248${ratingField[1]}/day)` : ''}, with unused trains banking up to a cap \u2014 this is a <strong>community-documented mechanic, not an official Torn publication</strong>, so treat the exact cap as ESTIMATED.</div>`;

    if (mode === 'priority') {
      html += `<div class="tds-box tds-box-info">Sorted by <strong>current effectiveness, lowest first</strong> \u2014 a defensible proxy for \u201cneeds training most,\u201d used because Torn does not publish the exact EE numbers that mark each tier boundary. I won\u2019t invent \u201cN trains to next tier\u201d numbers without a verified threshold table. If you have one you trust (e.g. from the reference tool), share it and I\u2019ll wire in the real \u201ctrains to next tier\u201d calculation.</div>`;
      const withEE = employees.map((e) => ({ ...e, ee: findEffectivenessField(e.raw) }));
      withEE.sort((a, b) => (a.ee?.value ?? Infinity) - (b.ee?.value ?? Infinity));
      html += '<div class="tds-section-label">Priority queue</div><div class="tds-card">';
      withEE.forEach((e, i) => {
        html += `
          <div class="tds-employee-row">
            <div class="tds-employee-top">
              <div>
                <div class="tds-employee-name">${i === 0 ? '\u25b6 ' : ''}${escapeHtml(String(e.name))}</div>
                <div class="tds-employee-meta">${escapeHtml(String(e.position))}</div>
              </div>
              <div class="tds-row-value">${e.ee ? e.ee.value : '<span class="tds-v-dim">no EE field</span>'}</div>
            </div>
          </div>`;
      });
      html += '</div>';
    } else {
      html += `<div class="tds-section-label">Training log access</div>`;
      if (logRaw) {
        const sampleCount = Array.isArray(logRaw) ? logRaw.length : (logRaw.log ? Object.keys(logRaw.log).length : Object.keys(logRaw).length);
        html += `<div class="tds-box tds-box-info"><strong>Log selection is accessible</strong> \u2014 fields returned: ${Object.keys(logRaw).join(', ')}${sampleCount ? `, ~${sampleCount} entries in this response` : ''}. This is <em>your own</em> event log, not the whole company\u2019s. The specific log type ID for \u201ctrained an employee\u201d still needs to be identified from real entries before debt numbers can be trusted \u2014 not implemented yet rather than guessed.</div>`;
      } else {
        html += `<div class="tds-box tds-box-danger"><strong>Log not accessible with this key.</strong> ${logBlockedReason || 'Blocked.'} Rotational/debt mode needs each trainer\u2019s own log to count real training events \u2014 without it, any \u201cowed training\u201d number would be fabricated, so this stays empty rather than showing something misleading.</div>`;
      }
      html += `<div class="tds-box tds-box-neutral">Once log access + the training log-type ID are confirmed, this view becomes: expected trainings since joining (from <code>days_in_company</code>, EXACT) minus actual trainings received (from the log, EXACT, deduplicated by log ID) = training debt per employee, sorted highest-debt-first. The full algorithm is already designed \u2014 it\u2019s wired up as soon as the data source is verified live.</div>`;
    }

    el.innerHTML = html;

    el.querySelectorAll('[data-trainmode]').forEach((seg) => {
      seg.addEventListener('click', () => {
        state.trainingMode = seg.dataset.trainmode;
        renderTrainingTab(panel);
      });
    });
  }

  // =======================================================================
  // BENCHMARK TAB
  // =======================================================================
  const BENCHMARK_CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours, matches reference tool's own stated caching

  async function fetchBenchmarkCompanies(categoryId) {
    // Param name for filtering `company -> companies` by type is confirmed
    // to exist (Torn's own changelog: "pass a specific category, only 1 per
    // request") but the exact query key isn't independently verified here —
    // try the documented wording first, fall back once, and surface the
    // real error rather than silently mis-filtering if neither works.
    try {
      return await ApiClient.call('company', 'companies', '', { category: categoryId });
    } catch (err) {
      if (err.code === 4 || err.code === 6) {
        return await ApiClient.call('company', 'companies', '', { cat: categoryId });
      }
      throw err;
    }
  }

  function renderBenchmarkTab(panel) {
    const el = panel.querySelector('[data-tabpanel="benchmark"]');
    const results = state.lastResults;
    const profile = results ? findRaw(results, 'company', 'profile') : null;

    const ownType = profile && Object.entries(profile).find(([k]) => /company_type|type/i.test(k))?.[1];
    const ownId = profile && Object.entries(profile).find(([k]) => /^id$/i.test(k))?.[1];
    const ownRatingEntry = profile && Object.entries(profile).find(([k, v]) => typeof v === 'number' && /rating/i.test(k));
    const ownRating = ownRatingEntry ? ownRatingEntry[1] : null;

    let html = `
      <div class="tds-box tds-box-neutral">
        Uses <code>company/companies</code>, filtered to one category (your company type) and sorted by income \u2014 this is <strong>public data, works for any key</strong>, not director-only. Cached ${BENCHMARK_CACHE_TTL_MS / 3600000}h locally. Costs 1 API call per reload.
      </div>
      <div class="tds-row" style="margin-bottom:8px;">
        <span class="tds-row-label">Company type (category ID)</span>
        <input class="tds-input" style="width:90px;" id="tds-bench-category" type="number" value="${ownType ?? ''}" placeholder="e.g. 20" />
      </div>
      <div class="tds-segmented">
        <div class="tds-segment ${state.benchmark.tier === 'same' ? 'tds-segment-active' : ''}" data-tier="same">SAME RATING${ownRating ? ` (${ownRating}\u2605)` : ''}</div>
        <div class="tds-segment ${state.benchmark.tier === 'mid' ? 'tds-segment-active' : ''}" data-tier="mid">3\u20135\u2605</div>
        <div class="tds-segment ${state.benchmark.tier === 'top' ? 'tds-segment-active' : ''}" data-tier="top">8\u201310\u2605 TOP</div>
      </div>
      <button class="tds-btn" id="tds-bench-reload">\u21bb Reload</button>
      <div id="tds-bench-results" style="margin-top:10px;"></div>
    `;
    el.innerHTML = html;

    el.querySelectorAll('[data-tier]').forEach((seg) => {
      seg.addEventListener('click', () => {
        state.benchmark.tier = seg.dataset.tier;
        renderBenchmarkTab(panel);
      });
    });

    el.querySelector('#tds-bench-reload').addEventListener('click', () => runBenchmark(panel));

    // Auto-render from cache if we have one for the current category, so
    // switching tiers doesn't force a fresh API call.
    const categoryId = el.querySelector('#tds-bench-category').value;
    const cached = categoryId && state.benchmark.cache[categoryId];
    if (cached) renderBenchmarkResults(panel, cached.data, ownId, ownRating);
  }

  async function runBenchmark(panel) {
    const el = panel.querySelector('[data-tabpanel="benchmark"]');
    const categoryId = el.querySelector('#tds-bench-category').value;
    const resultsEl = el.querySelector('#tds-bench-results');
    if (!categoryId) {
      resultsEl.innerHTML = `<div class="tds-box tds-box-warn">Enter a company type/category ID first \u2014 it should prefill automatically once the diagnostic has read your own company/profile.</div>`;
      return;
    }

    const cached = state.benchmark.cache[categoryId];
    if (cached && Date.now() - cached.timestamp < BENCHMARK_CACHE_TTL_MS) {
      const profile = state.lastResults ? findRaw(state.lastResults, 'company', 'profile') : null;
      const ownId = profile && Object.entries(profile).find(([k]) => /^id$/i.test(k))?.[1];
      const ownRatingEntry = profile && Object.entries(profile).find(([k, v]) => typeof v === 'number' && /rating/i.test(k));
      renderBenchmarkResults(panel, cached.data, ownId, ownRatingEntry ? ownRatingEntry[1] : null);
      return;
    }

    resultsEl.innerHTML = `<div class="tds-box tds-box-neutral">Fetching\u2026</div>`;
    try {
      const data = await fetchBenchmarkCompanies(categoryId);
      state.benchmark.cache[categoryId] = { timestamp: Date.now(), data };
      const profile = state.lastResults ? findRaw(state.lastResults, 'company', 'profile') : null;
      const ownId = profile && Object.entries(profile).find(([k]) => /^id$/i.test(k))?.[1];
      const ownRatingEntry = profile && Object.entries(profile).find(([k, v]) => typeof v === 'number' && /rating/i.test(k));
      renderBenchmarkResults(panel, data, ownId, ownRatingEntry ? ownRatingEntry[1] : null);
    } catch (err) {
      resultsEl.innerHTML = `<div class="tds-box tds-box-danger"><strong>Fetch failed:</strong> Torn error ${err.code ?? ''}: ${err.reason || 'unknown'}. If this is a "wrong fields" style error, the category parameter name for this selection needs manual verification against Torn's current Swagger spec \u2014 I tried the two most likely names and both failed.</div>`;
    }
  }

  function renderBenchmarkResults(panel, data, ownId, ownRating) {
    const el = panel.querySelector('[data-tabpanel="benchmark"] #tds-bench-results');
    if (!el) return;

    const listKey = Object.keys(data).find((k) => Array.isArray(data[k]) || typeof data[k] === 'object');
    const raw = listKey ? data[listKey] : data;
    const rows = Array.isArray(raw) ? raw : Object.values(raw || {});

    if (!rows.length || typeof rows[0] !== 'object') {
      el.innerHTML = `<div class="tds-box tds-box-warn">Response didn\u2019t look like a company list (fields: ${Object.keys(data).join(', ')}). Not rendering a ranking against an unverified shape \u2014 paste this back and I\u2019ll fix the parsing.</div>`;
      return;
    }

    const ratingKey = Object.keys(rows[0]).find((k) => /rating/i.test(k));
    const incomeKey = Object.keys(rows[0]).find((k) => /daily.*profit|daily.*income/i.test(k)) ||
      Object.keys(rows[0]).find((k) => /weekly.*profit|weekly.*income/i.test(k));
    const nameKey = Object.keys(rows[0]).find((k) => /^name$/i.test(k));
    const idKey = Object.keys(rows[0]).find((k) => /^id$/i.test(k));

    if (!incomeKey) {
      el.innerHTML = `<div class="tds-box tds-box-warn">Couldn\u2019t find an income field on these entries (fields present: ${Object.keys(rows[0]).join(', ')}). Ranking needs one \u2014 tell me the real field name and I\u2019ll wire it in.</div>`;
      return;
    }

    const tier = state.benchmark.tier;
    const filtered = rows.filter((r) => {
      const rating = ratingKey ? r[ratingKey] : null;
      if (rating === null) return true;
      if (tier === 'same') return ownRating !== null ? rating === ownRating : true;
      if (tier === 'mid') return rating >= 3 && rating <= 5;
      if (tier === 'top') return rating >= 8;
      return true;
    });

    const sorted = [...filtered].sort((a, b) => (b[incomeKey] || 0) - (a[incomeKey] || 0));
    const capped = rows.length >= 100;

    let html = '';
    html += `<div class="tds-card">`;
    html += `<div class="tds-row"><span class="tds-row-label">Companies fetched (this category)</span><span class="tds-row-value">${rows.length}${capped ? '+' : ''}</span></div>`;
    html += `<div class="tds-row"><span class="tds-row-label">Matching this tier</span><span class="tds-row-value">${filtered.length}</span></div>`;
    if (ownId !== null && ownId !== undefined) {
      const rank = sorted.findIndex((r) => idKey && String(r[idKey]) === String(ownId));
      html += `<div class="tds-row"><span class="tds-row-label">Your rank (by ${incomeKey})</span><span class="tds-row-value">${rank >= 0 ? `#${rank + 1} / ${sorted.length}` : '<span class="tds-v-dim">not found in this fetch</span>'}</span></div>`;
    }
    html += '</div>';

    if (capped) {
      html += `<div class="tds-box tds-box-warn">This category returned the API\u2019s 100-row cap \u2014 there may be more companies beyond what\u2019s shown. Ranking below is only within these ${rows.length}.</div>`;
    }

    html += `<div class="tds-section-label">Top ${Math.min(10, sorted.length)} by ${incomeKey}</div>`;
    html += '<table class="tds-table"><thead><tr><th>#</th><th>Company</th>' + (ratingKey ? '<th>\u2605</th>' : '') + `<th>${incomeKey}</th></tr></thead><tbody>`;
    sorted.slice(0, 10).forEach((r, i) => {
      const isYou = idKey && String(r[idKey]) === String(ownId);
      html += `<tr style="${isYou ? 'color:var(--tds-accent,#3ddc84);font-weight:700;' : ''}"><td>${i + 1}</td><td>${escapeHtml(String(nameKey ? r[nameKey] : r[idKey] ?? '?'))}${isYou ? ' (you)' : ''}</td>${ratingKey ? `<td>${r[ratingKey]}</td>` : ''}<td class="tds-num">${formatMoney(r[incomeKey])}</td></tr>`;
    });
    html += '</tbody></table>';

    el.innerHTML = html;
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
      const latest = await LocalDB.getLatest('diagnostics');
      if (!latest?.results?.length) return false;

      const results = latest.results;
      const verdict = classifyAccess(results);
      state.lastResults = results;
      state.lastVerdict = verdict;
      state.lastRunAt = Number(latest.timestamp) || Number(GM_getValue(STORAGE_KEY_LAST_RUN_AT, 0)) || null;

      if (state.lastRunAt) GM_setValue(STORAGE_KEY_LAST_RUN_AT, state.lastRunAt);

      renderOverviewTab(panel, results, verdict);
      renderDiagnosticsTab(panel, results);
      await renderFinanceTab(panel);
      renderTrainingTab(panel);
      renderBenchmarkTab(panel);
      startFooterTicker(panel);
      await checkLicense(panel);
      return true;
    } catch (err) {
      console.warn('[TDS] Could not load persisted diagnostics:', err);
      return false;
    }
  }

  async function runFullDiagnostic(panel, { force = false } = {}) {
    if (state.diagnosticRunning) return;

    if (force) {
      GM_deleteValue(STORAGE_KEY_LAST_RUN_AT);
      try {
        // Remove only the diagnostic capability records. Historical snapshots
        // remain intact so the Finance trend is not destroyed by a rerun.
        await LocalDB.clear('diagnostics');
      } catch (err) {
        console.warn('[TDS] Could not clear previous diagnostic state:', err);
      }
    }

    const apiKey = GM_getValue(STORAGE_KEY_APIKEY, '');
    if (!apiKey) {
      panel.querySelector('#tds-footer-status').textContent = 'Last run: Never';
      switchTab(panel, 'settings');
      return;
    }

    state.diagnosticRunning = true;
    panel.querySelector('#tds-footer-status').textContent = 'Running diagnostic\u2026';

    try {
      const results = await runDiagnostic();
      const verdict = classifyAccess(results);
      await takeSnapshotFromDiagnostic(results);

      state.lastResults = results;
      state.lastVerdict = verdict;
      state.lastRunAt = Date.now();

      GM_setValue(STORAGE_KEY_LAST_RUN_AT, state.lastRunAt);

      renderOverviewTab(panel, results, verdict);
      renderDiagnosticsTab(panel, results);
      await renderFinanceTab(panel);
      renderTrainingTab(panel);
      renderBenchmarkTab(panel);
      startFooterTicker(panel);
      await checkLicense(panel, { force });
    } finally {
      state.diagnosticRunning = false;
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
