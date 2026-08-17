// ==UserScript==
// @name         Torn Company Director System
// @namespace    torn-director-system
// @version      0.6.0
// @description  Local-only company management dashboard for Torn directors. One script for Torn PDA and PC.
// @author       you
// @match        https://www.torn.com/*
// @match        https://torn.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.deleteValue
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @connect      api.torn.com
// @run-at       document-idle
// @noframes
// ==/UserScript==
 
/**
 * ============================================================================
 * TORN COMPANY DIRECTOR SYSTEM — v0.6.0 "Torn PDA + PC Compatibility Build"
 * ============================================================================
 *
 * WHAT THIS VERSION DOES:
 *   1. Stores your API key ONLY in this browser (Tampermonkey's local storage,
 *      via GM_setValue). It is never sent anywhere except https://api.torn.com.
 *   2. Runs a live "capability diagnostic" against every selection this system
 *      will eventually use, and shows you — with the REAL error code/message
 *      Torn returns — exactly what your current key can and can't access.
 *   3. For whatever succeeds, renders a read-only overview panel and takes a
 *      local snapshot (IndexedDB) so history starts accumulating from today.
 *   4. Everything is tagged with its accuracy classification:
 *        EXACT = straight from a Torn API field this session
 *        DERIVED = computed purely from EXACT values
 *        HISTORICAL = from a locally stored earlier snapshot
 *        BLOCKED = this key/role cannot access this data (shown, not hidden)
 *
 * TABS THAT ARE STUBBED (LOCKED), NOT FAKED:
 *   Finance, Training, Optimize, Benchmark, Stock, Projections all need
 *   director-level data (financials/stock/wages) or a fuller field-name
 *   verification pass than an employee key allows. Rather than mock them up
 *   with invented numbers to match a reference design, they show a plain
 *   "locked until director access + Phase 4 build" state. They'll be built
 *   for real once the Diagnostics tab confirms director access.
 *
 * INSTALL: Tampermonkey/Violentmonkey on PC, or Torn PDA Custom User Scripts on mobile. This build keeps one code path for both.
 * Torn PDA can inject the user API key through ###PDA-APIKEY### and can use PDA_httpGet().
 * ============================================================================
 */
 
(function () {
  'use strict';
 
  // ---------------------------------------------------------------------
  // 0. CONSTANTS
  // ---------------------------------------------------------------------
  const API_BASE = 'https://api.torn.com';
  const STORAGE_KEY_APIKEY = 'tds_api_key';
  const STORAGE_KEY_THEME = 'tds_theme';
  const STORAGE_KEY_PINNED = 'tds_pinned';
  const STORAGE_KEY_TOGGLE_POS = 'tds_toggle_pos'; // { left, top } in px, clamped to viewport on load
  const STORAGE_KEY_PANEL_POS = 'tds_panel_pos'; // { left, top } in px, clamped to viewport on load
  // Torn PDA replaces this exact token with the user's configured API key.
  // On PC it remains the literal token and is ignored.
  const PDA_API_KEY = '###PDA-APIKEY###';
  const DRAG_CLICK_THRESHOLD_PX = 6; // movement below this = treated as a click, not a drag
  const MIN_CALL_INTERVAL_MS = 800; // ~75 req/min ceiling, well under Torn's 100/min cap
  const DB_NAME = 'torn_director_system';
  const DB_VERSION = 1;

  // ---------------------------------------------------------------------
  // 0b. CROSS-MANAGER COMPATIBILITY (Tampermonkey/Violentmonkey/Torn PDA)
  // ---------------------------------------------------------------------
  // Torn PDA implements a userscript/GM compatibility layer, but its exact
  // exposed GM globals can differ from desktop managers. Keep all storage and
  // network access behind these adapters so this remains one script everywhere.
  const Compat = (() => {
    const hasLegacyGet = typeof GM_getValue === 'function';
    const hasLegacySet = typeof GM_setValue === 'function';
    const hasLegacyDelete = typeof GM_deleteValue === 'function';
    const hasLegacyXHR = typeof GM_xmlhttpRequest === 'function';
    const hasModernXHR = typeof GM !== 'undefined' && typeof GM.xmlHttpRequest === 'function';
    const LOCAL_PREFIX = 'tds_compat_';

    function localGet(key, fallback) {
      try {
        const raw = localStorage.getItem(LOCAL_PREFIX + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (_) {
        return fallback;
      }
    }

    function localSet(key, value) {
      try { localStorage.setItem(LOCAL_PREFIX + key, JSON.stringify(value)); } catch (_) {}
    }

    function localDelete(key) {
      try { localStorage.removeItem(LOCAL_PREFIX + key); } catch (_) {}
    }

    function get(key, fallback = null) {
      if (key === STORAGE_KEY_APIKEY && PDA_API_KEY !== '###PDA-APIKEY###' && PDA_API_KEY) return PDA_API_KEY;
      if (hasLegacyGet) return GM_getValue(key, fallback);
      if (typeof GM !== 'undefined' && typeof GM.getValue === 'function') {
        // GM.getValue is async in modern managers; callers in this script are
        // intentionally synchronous, so use localStorage unless legacy API exists.
        return localGet(key, fallback);
      }
      return localGet(key, fallback);
    }

    function set(key, value) {
      if (hasLegacySet) return GM_setValue(key, value);
      if (typeof GM !== 'undefined' && typeof GM.setValue === 'function') {
        try { GM.setValue(key, value); } catch (_) { localSet(key, value); }
        return;
      }
      localSet(key, value);
    }

    function del(key) {
      if (hasLegacyDelete) return GM_deleteValue(key);
      if (typeof GM !== 'undefined' && typeof GM.deleteValue === 'function') {
        try { GM.deleteValue(key); } catch (_) { localDelete(key); }
        return;
      }
      localDelete(key);
    }

    function request(details) {
      // Torn PDA's native HTTP bridge avoids browser CORS restrictions.
      if (typeof PDA_httpGet === 'function' && (details.method || 'GET').toUpperCase() === 'GET') {
        return requestPDA(details);
      }
      if (hasLegacyXHR) return requestLegacy(details);
      if (hasModernXHR) return requestModern(details);
      return requestFetch(details);
    }

    async function requestPDA(details) {
      try {
        const res = await PDA_httpGet(details.url, details.headers || {});
        details.onload?.(res);
        return res;
      } catch (err) {
        details.onerror?.(err);
        throw err;
      }
    }

    function requestLegacy(details) {
      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (fn, value) => {
          if (settled) return;
          settled = true;
          fn(value);
        };
        try {
          GM_xmlhttpRequest({
            ...details,
            onload: (res) => {
              details.onload?.(res);
              finish(resolve, res);
            },
            onerror: (err) => {
              details.onerror?.(err);
              finish(reject, err);
            },
            ontimeout: (err) => {
              details.ontimeout?.(err);
              finish(reject, err);
            },
          });
        } catch (err) {
          finish(reject, err);
        }
      });
    }

    function requestModern(details) {
      return GM.xmlHttpRequest(details);
    }

    async function requestFetch(details) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), details.timeout || 15000);
      try {
        const res = await fetch(details.url, {
          method: details.method || 'GET',
          headers: details.headers || undefined,
          body: details.data || undefined,
          credentials: 'omit',
          mode: 'cors',
          signal: controller.signal,
        });
        const responseText = await res.text();
        const result = {
          status: res.status,
          statusText: res.statusText,
          responseText,
          finalUrl: res.url,
        };
        details.onload?.(result);
        if (!res.ok) throw result;
        return result;
      } catch (err) {
        details.onerror?.(err);
        throw err;
      } finally {
        clearTimeout(timer);
      }
    }

    return { get, set, del, request };
  })();
 
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
      const key = Compat.get(STORAGE_KEY_APIKEY, '');
      if (!key) return Promise.reject({ blocked: true, reason: 'No API key configured yet.' });
 
      const path = id ? `${section}/${id}` : section;
      const params = new URLSearchParams({ selections, key, ...extraParams });
      const url = `${API_BASE}/${path}?${params.toString()}`;
 
      return new Promise((resolve, reject) => {
        Compat.request({
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
        }).catch(() => {
          // The callbacks above already turn the failure into a useful Torn/PDA message.
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
 
    return { put, getAll, deleteKey };
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
          '). Expected for a non-director key.',
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
      #tds-toggle {
        position: fixed; z-index: 99999;
        background: #10131a; color: var(--tds-accent, #3ddc84); border: 1px solid #232838;
        border-radius: 8px; padding: 9px 14px; font: 600 12px/1.2 -apple-system, 'Segoe UI', sans-serif;
        letter-spacing: .03em; cursor: grab; box-shadow: 0 4px 14px rgba(0,0,0,0.45);
        user-select: none; touch-action: none;
      }
      #tds-toggle.tds-dragging { cursor: grabbing; opacity: 0.85; transition: none; }
      #tds-toggle .tds-drag-hint {
        position: absolute; top: -18px; left: 50%; transform: translateX(-50%);
        font-size: 9px; color: #5c6373; white-space: nowrap; pointer-events: none;
        opacity: 0; transition: opacity .15s;
      }
      #tds-toggle:hover .tds-drag-hint { opacity: 1; }
      #tds-panel {
        position: fixed; width: min(420px, calc(100vw - 12px)); max-height: min(86vh, calc(100dvh - 12px));
        display: none; flex-direction: column;
        background: #0b0d12; color: #d7dae0; border: 1px solid #1c202a;
        border-radius: 10px; z-index: 99999; font: 13px/1.45 -apple-system, 'Segoe UI', sans-serif;
        box-shadow: 0 10px 34px rgba(0,0,0,0.6); overflow: hidden;
      }
      #tds-panel.tds-pinned { display: flex; }
      #tds-panel.tds-dragging { opacity: 0.92; }
 
      #tds-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 10px 12px; background: #0d1017; border-bottom: 1px solid #1c202a;
        cursor: grab; touch-action: none; user-select: none;
      }
      #tds-header.tds-dragging { cursor: grabbing; }
      #tds-header .tds-brand { display: flex; align-items: baseline; gap: 6px; pointer-events: none; }
      #tds-header .tds-brand-dot { color: var(--tds-accent, #3ddc84); font-size: 13px; }
      #tds-header .tds-brand-name {
        color: var(--tds-accent, #3ddc84); font-weight: 700; font-size: 13px; letter-spacing: .04em;
      }
      #tds-header .tds-brand-version { color: #4a5062; font-size: 10.5px; }
      #tds-header-icons { display: flex; gap: 6px; }
      #tds-header-icons button {
        width: 26px; height: 26px; display: flex; align-items: center; justify-content: center;
        background: transparent; color: #8b93a1; border: 1px solid #232838; border-radius: 6px;
        cursor: pointer; font-size: 12px; padding: 0;
      }
      #tds-header-icons button:hover { background: #161a22; color: #d7dae0; }
      #tds-header-icons button.tds-active {
        border-color: var(--tds-accent, #3ddc84); color: var(--tds-accent, #3ddc84);
        background: var(--tds-accent-dim, rgba(61,220,132,.14));
      }
 
      #tds-tabs {
        display: flex; flex-wrap: wrap; gap: 2px; padding: 8px 10px 0 10px;
        border-bottom: 1px solid #1c202a; background: #0b0d12;
      }
      .tds-tab {
        background: transparent; border: none; color: #5c6373; font: 700 10.5px/1 -apple-system, sans-serif;
        letter-spacing: .05em; padding: 0 4px 10px 4px; margin-right: 12px; cursor: pointer;
        border-bottom: 2px solid transparent;
      }
      .tds-tab:hover { color: #9aa0a6; }
      .tds-tab.tds-tab-active { color: var(--tds-accent, #3ddc84); border-bottom-color: var(--tds-accent, #3ddc84); }
      .tds-tab.tds-tab-locked { color: #3a3f4a; cursor: default; }
      .tds-tab.tds-tab-locked:hover { color: #3a3f4a; }
 
      #tds-body { flex: 1; overflow-y: auto; padding: 14px 14px 8px 14px; }
      .tds-tabpanel[hidden] { display: none; }
 
      .tds-section-label {
        font: 700 10.5px/1 -apple-system, sans-serif; letter-spacing: .08em; color: #565d6d;
        text-transform: uppercase; margin: 16px 0 8px 0;
      }
      .tds-section-label:first-child { margin-top: 0; }
 
      .tds-card {
        background: #10131a; border: 1px solid #1c202a; border-radius: 8px;
        padding: 12px 14px; margin-bottom: 10px;
      }
      .tds-card-title { color: #8b93a1; font-size: 11.5px; margin-bottom: 6px; }
      .tds-row { display: flex; justify-content: space-between; align-items: center; padding: 3px 0; gap: 10px; }
      .tds-row-label { color: #9aa0a6; }
      .tds-row-value { font-weight: 700; color: #e6e8ec; }
      .tds-v-good { color: #3ddc84 !important; }
      .tds-v-bad { color: #ff5c5c !important; }
      .tds-v-warn { color: #f5a623 !important; }
      .tds-v-dim { color: #5c6373 !important; font-weight: 400 !important; }
 
      .tds-box {
        border-radius: 7px; padding: 10px 12px; margin-bottom: 10px; font-size: 12px; line-height: 1.5;
      }
      .tds-box-info { background: rgba(61,220,132,0.07); border: 1px solid rgba(61,220,132,0.28); color: #a9e8c1; }
      .tds-box-warn { background: rgba(245,166,35,0.09); border: 1px solid rgba(245,166,35,0.3); color: #f0c584; }
      .tds-box-danger { background: rgba(255,92,92,0.08); border: 1px solid rgba(255,92,92,0.3); color: #ffb3b3; }
      .tds-box-neutral { background: #10131a; border: 1px solid #1c202a; color: #9aa0a6; }
      .tds-box strong { color: inherit; }
 
      .tds-badge {
        display: inline-flex; align-items: center; font: 700 10px/1 -apple-system, sans-serif;
        padding: 3px 7px; border-radius: 5px; white-space: nowrap; letter-spacing: .02em;
      }
      .tds-badge-ok { background: rgba(61,220,132,0.14); color: #3ddc84; border: 1px solid rgba(61,220,132,0.3); }
      .tds-badge-blocked { background: rgba(255,92,92,0.12); color: #ff8b8b; border: 1px solid rgba(255,92,92,0.28); }
      .tds-badge-neutral { background: #191d26; color: #8b93a1; border: 1px solid #232838; }
 
      .tds-employee-row { padding: 9px 0; border-bottom: 1px solid #161922; }
      .tds-employee-row:last-child { border-bottom: none; }
      .tds-employee-top { display: flex; justify-content: space-between; align-items: flex-start; }
      .tds-employee-name { font-weight: 700; color: #e6e8ec; font-size: 13px; }
      .tds-employee-meta { color: #5c6373; font-size: 11px; margin-top: 1px; }
      .tds-employee-raw { color: #4a5062; font-size: 10.5px; margin-top: 3px; word-break: break-all; }
 
      .tds-diag-row { display: flex; justify-content: space-between; align-items: flex-start; padding: 8px 0; border-bottom: 1px solid #161922; gap: 10px; }
      .tds-diag-row:last-child { border-bottom: none; }
      .tds-diag-label { color: #c7ccd1; font-size: 12px; }
      .tds-diag-reason { color: #5c6373; font-size: 11px; margin-top: 2px; }
 
      .tds-btn {
        background: var(--tds-accent, #3ddc84); color: #06110a; border: none; border-radius: 6px;
        padding: 8px 12px; font: 700 12px/1 -apple-system, sans-serif; cursor: pointer; letter-spacing: .02em;
      }
      .tds-btn:hover { filter: brightness(1.08); }
      .tds-btn-ghost {
        background: transparent; color: #9aa0a6; border: 1px solid #232838; border-radius: 6px;
        padding: 8px 12px; font: 600 12px/1 -apple-system, sans-serif; cursor: pointer;
      }
      .tds-btn-ghost:hover { background: #161a22; color: #d7dae0; }
 
      .tds-input {
        width: 100%; background: #0b0d12; color: #e6e8ec; border: 1px solid #232838;
        border-radius: 6px; padding: 8px 9px; box-sizing: border-box; font: 12.5px monospace;
      }
      .tds-input:focus { outline: none; border-color: var(--tds-accent, #3ddc84); }
 
      .tds-swatches { display: flex; gap: 8px; margin-top: 8px; }
      .tds-swatch {
        width: 26px; height: 26px; border-radius: 50%; cursor: pointer; border: 2px solid transparent;
      }
      .tds-swatch.tds-swatch-active { border-color: #fff; }
 
      .tds-segmented { display: flex; gap: 4px; margin-bottom: 10px; flex-wrap: wrap; }
      .tds-segment {
        flex: 1; min-width: 90px; text-align: center; background: #10131a; color: #8b93a1;
        border: 1px solid #232838; border-radius: 6px; padding: 8px 6px; font: 700 10.5px/1 -apple-system, sans-serif;
        letter-spacing: .03em; cursor: pointer;
      }
      .tds-segment:hover { background: #161a22; }
      .tds-segment.tds-segment-active {
        background: var(--tds-accent-dim, rgba(61,220,132,.14)); color: var(--tds-accent, #3ddc84);
        border-color: var(--tds-accent, #3ddc84);
      }
 
      .tds-table { width: 100%; border-collapse: collapse; font-size: 12px; }
      .tds-table th {
        text-align: left; color: #565d6d; font-size: 10px; letter-spacing: .05em; text-transform: uppercase;
        padding: 4px 6px; border-bottom: 1px solid #1c202a;
      }
      .tds-table td { padding: 5px 6px; border-bottom: 1px solid #161922; color: #d7dae0; }
      .tds-table tr:last-child td { border-bottom: none; }
      .tds-table td.tds-num { text-align: right; font-variant-numeric: tabular-nums; }
 
      .tds-spark { display: flex; align-items: flex-end; gap: 4px; height: 46px; margin: 6px 0; }
      .tds-spark-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; }
      .tds-spark-bar { width: 100%; border-radius: 2px 2px 0 0; min-height: 2px; }
      .tds-spark-bar.tds-bar-pos { background: var(--tds-accent, #3ddc84); }
      .tds-spark-bar.tds-bar-neg { background: #ff5c5c; }
      .tds-spark-label { font-size: 9px; color: #4a5062; }
 
      .tds-progress { height: 5px; background: #191d26; border-radius: 3px; overflow: hidden; margin-top: 4px; }
      .tds-progress-fill { height: 100%; background: var(--tds-accent, #3ddc84); }
      .tds-progress-fill.tds-fill-warn { background: #f5a623; }
 
      #tds-footer {
        display: flex; justify-content: space-between; align-items: center;
        padding: 7px 12px; border-top: 1px solid #1c202a; background: #0d1017;
        font-size: 10.5px; color: #4a5062;
      }
      #tds-footer .tds-footer-status { color: var(--tds-accent, #3ddc84); }

      /* Torn PDA / narrow-screen layout. Desktop keeps the original 420px panel. */
      @media (max-width: 600px) {
        #tds-panel {
          width: calc(100vw - 12px);
          max-width: none;
          max-height: calc(100dvh - 12px);
          border-radius: 9px;
        }
        #tds-header { padding: 9px 10px; }
        #tds-tabs { padding-left: 8px; padding-right: 8px; overflow-x: auto; flex-wrap: nowrap; scrollbar-width: none; }
        #tds-tabs::-webkit-scrollbar { display: none; }
        .tds-tab { flex: 0 0 auto; margin-right: 8px; }
        #tds-body { padding: 12px 10px 8px; }
        #tds-toggle { padding: 9px 11px; }
        #tds-header-icons button { width: 30px; height: 30px; }
        .tds-input { font-size: 16px; } /* prevents iOS zoom on focus */
      }
      @media (max-width: 380px) {
        #tds-header .tds-brand-version { display: none; }
        #tds-header-icons { gap: 3px; }
        #tds-header-icons button { width: 28px; height: 28px; }
        .tds-tab { font-size: 10px; margin-right: 6px; }
      }
    `;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
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
    benchmark: { tier: 'same', cache: {} }, // cache keyed by categoryId -> { timestamp, data }
  };
 
  // ---------------------------------------------------------------------
  // 5a. DRAGGABLE ELEMENTS — position persisted locally per browser.
  //     Shared by the toggle bubble and the panel (dragged by its header).
  // ---------------------------------------------------------------------
  function clampToViewport(left, top, el) {
    // offsetWidth/Height are 0 while the panel is display:none (e.g. before
    // first open) — fall back to the CSS-computed width/height, which is
    // still resolvable even when not rendered, so first placement clamps
    // correctly instead of assuming a wrong (too-narrow) size.
    const w = el.offsetWidth || parseFloat(getComputedStyle(el).width) || 150;
    const h = el.offsetHeight || parseFloat(getComputedStyle(el).height) || 36;
    const maxLeft = Math.max(0, window.innerWidth - w - 4);
    const maxTop = Math.max(0, window.innerHeight - h - 4);
    return {
      left: Math.min(Math.max(4, left), maxLeft),
      top: Math.min(Math.max(4, top), maxTop),
    };
  }
 
  function placeToggle(toggle) {
    const saved = Compat.get(STORAGE_KEY_TOGGLE_POS, null);
    let left, top;
    if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') {
      ({ left, top } = saved);
    } else {
      // Default spot: bottom-right, clear of Torn's own chat bubbles
      // which usually live bottom-left.
      left = window.innerWidth - 166;
      top = window.innerHeight - 60;
    }
    const clamped = clampToViewport(left, top, toggle);
    toggle.style.left = `${clamped.left}px`;
    toggle.style.top = `${clamped.top}px`;
    toggle.style.right = 'auto';
    toggle.style.bottom = 'auto';
  }
 
  function placePanel(panel) {
    const saved = Compat.get(STORAGE_KEY_PANEL_POS, null);
    let left, top;
    if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') {
      ({ left, top } = saved);
    } else {
      // Default spot: matches the original top:40 / right:16 layout.
      left = window.innerWidth - (panel.offsetWidth || 420) - 16;
      top = 40;
    }
    const clamped = clampToViewport(left, top, panel);
    panel.style.left = `${clamped.left}px`;
    panel.style.top = `${clamped.top}px`;
    panel.style.right = 'auto';
  }
 
  /**
   * Generic drag wiring: pointerdown/move/up on `handleEl`, moving `moveEl`.
   * `onDragEnd(rect)` fires only on a real drag (past the click threshold),
   * so callers can persist position and suppress the trailing click.
   * `shouldIgnore(e)` lets a handle exclude sub-elements (e.g. header icon
   * buttons) from starting a drag.
   */
  function wireDrag(handleEl, moveEl, { onDragEnd, shouldIgnore, dragClass } = {}) {
    let dragging = false;
    let startX = 0, startY = 0;
    let originLeft = 0, originTop = 0;
    let moved = 0;
 
    handleEl.addEventListener('pointerdown', (e) => {
      if (shouldIgnore && shouldIgnore(e)) return;
      dragging = true;
      moved = 0;
      startX = e.clientX;
      startY = e.clientY;
      const rect = moveEl.getBoundingClientRect();
      originLeft = rect.left;
      originTop = rect.top;
      if (dragClass) { handleEl.classList.add(dragClass); moveEl.classList.add(dragClass); }
      handleEl.setPointerCapture(e.pointerId);
    });
 
    handleEl.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      moved = Math.max(moved, Math.abs(dx), Math.abs(dy));
      const clamped = clampToViewport(originLeft + dx, originTop + dy, moveEl);
      moveEl.style.left = `${clamped.left}px`;
      moveEl.style.top = `${clamped.top}px`;
      moveEl.style.right = 'auto';
      moveEl.style.bottom = 'auto';
    });
 
    function endDrag(e) {
      if (!dragging) return;
      dragging = false;
      if (dragClass) { handleEl.classList.remove(dragClass); moveEl.classList.remove(dragClass); }
      if (moved > DRAG_CLICK_THRESHOLD_PX) {
        const rect = moveEl.getBoundingClientRect();
        onDragEnd?.(rect, true);
      } else {
        onDragEnd?.(null, false);
      }
    }
 
    handleEl.addEventListener('pointerup', endDrag);
    handleEl.addEventListener('pointercancel', endDrag);
  }
 
  function makeToggleDraggable(toggle) {
    wireDrag(toggle, toggle, {
      dragClass: 'tds-dragging',
      onDragEnd: (rect, didDrag) => {
        if (!didDrag) return;
        Compat.set(STORAGE_KEY_TOGGLE_POS, { left: rect.left, top: rect.top });
        // Suppress the click that fires right after release so dragging
        // the bubble doesn't also toggle the panel open/closed.
        toggle.dataset.justDragged = '1';
      },
    });
 
    window.addEventListener('resize', () => {
      const rect = toggle.getBoundingClientRect();
      const clamped = clampToViewport(rect.left, rect.top, toggle);
      toggle.style.left = `${clamped.left}px`;
      toggle.style.top = `${clamped.top}px`;
    });
  }
 
  function makePanelDraggable(panel, header) {
    wireDrag(header, panel, {
      dragClass: 'tds-dragging',
      shouldIgnore: (e) => !!e.target.closest('button'),
      onDragEnd: (rect, didDrag) => {
        if (!didDrag) return;
        Compat.set(STORAGE_KEY_PANEL_POS, { left: rect.left, top: rect.top });
      },
    });
 
    window.addEventListener('resize', () => {
      const rect = panel.getBoundingClientRect();
      const clamped = clampToViewport(rect.left, rect.top, panel);
      panel.style.left = `${clamped.left}px`;
      panel.style.top = `${clamped.top}px`;
    });
  }
 
  function buildPanel() {
    const panel = document.createElement('div');
    panel.id = 'tds-panel';
    panel.innerHTML = `
      <div id="tds-header">
        <div class="tds-brand">
          <span class="tds-brand-dot">\u25cb</span>
          <span class="tds-brand-name">COMPANY MANAGER</span>
          <span class="tds-brand-version">v0.6</span>
        </div>
        <div id="tds-header-icons">
          <button data-action="refresh" title="Run diagnostic">\u27f3</button>
          <button data-action="pin" title="Keep panel open">\ud83d\udccc</button>
          <button data-action="tab-settings" title="Settings">\u2699</button>
          <button data-action="close" title="Close">\u2715</button>
        </div>
      </div>
      <div id="tds-tabs">
        <button class="tds-tab tds-tab-active" data-tab="overview">OVERVIEW</button>
        <button class="tds-tab" data-tab="diagnostics">DIAGNOSTICS</button>
        <button class="tds-tab" data-tab="finance">FINANCE</button>
        <button class="tds-tab" data-tab="training">TRAINING</button>
        <button class="tds-tab" data-tab="benchmark">BENCHMARK</button>
        <button class="tds-tab tds-tab-locked" data-tab="optimize" title="Needs a resolved position-fit formula (see tab)">OPTIMIZE</button>
        <button class="tds-tab" data-tab="settings">SETTINGS</button>
      </div>
      <div id="tds-body">
        <div class="tds-tabpanel" data-tabpanel="overview"></div>
        <div class="tds-tabpanel" data-tabpanel="diagnostics" hidden></div>
        <div class="tds-tabpanel" data-tabpanel="finance" hidden></div>
        <div class="tds-tabpanel" data-tabpanel="training" hidden></div>
        <div class="tds-tabpanel" data-tabpanel="benchmark" hidden></div>
        <div class="tds-tabpanel" data-tabpanel="optimize" hidden></div>
        <div class="tds-tabpanel" data-tabpanel="settings" hidden></div>
      </div>
      <div id="tds-footer">
        <span class="tds-footer-status" id="tds-footer-status">Not yet run</span>
        <span>Torn Company Manager v0.5</span>
      </div>
    `;
    document.body.appendChild(panel);
    placePanel(panel);
    makePanelDraggable(panel, panel.querySelector('#tds-header'));
 
    const toggle = document.createElement('div');
    toggle.id = 'tds-toggle';
    toggle.innerHTML = '<span class="tds-drag-hint">drag to move</span>\u25cb Company Manager';
    document.body.appendChild(toggle);
    placeToggle(toggle);
    makeToggleDraggable(toggle);
 
    applyTheme(panel, Compat.get(STORAGE_KEY_THEME, 'green'));
    if (Compat.get(STORAGE_KEY_PINNED, false)) {
      panel.classList.add('tds-pinned');
      panel.querySelector('[data-action="pin"]').classList.add('tds-active');
    }
 
    toggle.addEventListener('click', () => {
      if (toggle.dataset.justDragged === '1') {
        // Suppress the click that fires right after a drag-release so
        // dragging the bubble doesn't also toggle the panel open/closed.
        toggle.dataset.justDragged = '0';
        return;
      }
      const isOpen = panel.style.display === 'flex' || panel.classList.contains('tds-pinned');
      panel.style.display = isOpen ? 'none' : 'flex';
    });
 
    panel.querySelector('[data-action="close"]').addEventListener('click', () => {
      panel.style.display = 'none';
    });
    panel.querySelector('[data-action="pin"]').addEventListener('click', (e) => {
      const nowPinned = !panel.classList.contains('tds-pinned');
      panel.classList.toggle('tds-pinned', nowPinned);
      Compat.set(STORAGE_KEY_PINNED, nowPinned);
      e.currentTarget.classList.toggle('tds-active', nowPinned);
    });
    panel.querySelector('[data-action="tab-settings"]').addEventListener('click', () => switchTab(panel, 'settings'));
    panel.querySelector('[data-action="refresh"]').addEventListener('click', () => runFullDiagnostic(panel));
 
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
    const currentTheme = Compat.get(STORAGE_KEY_THEME, 'green');
    const pdaKeyActive = PDA_API_KEY !== '###PDA-APIKEY###' && !!PDA_API_KEY;
    el.innerHTML = `
      <div class="tds-section-label">API Key</div>
      <div class="tds-box tds-box-neutral">${pdaKeyActive ? 'Torn PDA supplied the API key automatically. It is used only for requests to api.torn.com.' : 'Stored only in this browser (Tampermonkey local storage). Never sent anywhere except api.torn.com.'}</div>
      <input class="tds-input" id="tds-keyinput" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="${pdaKeyActive ? 'Torn PDA API key supplied automatically' : 'Paste API key here'}" ${pdaKeyActive ? 'disabled' : ''} />
      <div style="margin-top:8px; display:flex; gap:8px;">
        <button class="tds-btn" id="tds-savekey" ${pdaKeyActive ? 'disabled' : ''}>Save key</button>
        <button class="tds-btn-ghost" id="tds-rundiag2">Run diagnostic</button>
      </div>
 
      <div class="tds-section-label">Color Theme</div>
      <div class="tds-card">
        <div class="tds-card-title">Accent color (affects highlights, tabs, buttons \u2014 not the red/green/amber meaning colors)</div>
        <div class="tds-swatches" id="tds-swatches"></div>
      </div>
    `;
 
    const keyInput = el.querySelector('#tds-keyinput');
    if (!pdaKeyActive) keyInput.value = Compat.get(STORAGE_KEY_APIKEY, '');
    el.querySelector('#tds-savekey').addEventListener('click', () => {
      Compat.set(STORAGE_KEY_APIKEY, keyInput.value.trim());
      keyInput.style.borderColor = 'var(--tds-accent)';
      setTimeout(() => (keyInput.style.borderColor = ''), 600);
    });
    el.querySelector('#tds-rundiag2').addEventListener('click', () => runFullDiagnostic(panel));
 
    const swatchWrap = el.querySelector('#tds-swatches');
    Object.entries(THEME_PRESETS).forEach(([name, theme]) => {
      const sw = document.createElement('div');
      sw.className = 'tds-swatch' + (name === currentTheme ? ' tds-swatch-active' : '');
      sw.style.background = theme.accent;
      sw.title = name;
      sw.addEventListener('click', () => {
        Compat.set(STORAGE_KEY_THEME, name);
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
      el.innerHTML = `<div class="tds-box tds-box-neutral">Run the diagnostic (\u27f3 in the header, or the button in Settings) to see exactly what your current key can access \u2014 every row reflects a real response from api.torn.com.</div>`;
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
    if (!results) {
      el.innerHTML = `<div class="tds-box tds-box-neutral">No data yet. Add your API key in Settings, then run the diagnostic.</div>`;
      return;
    }
 
    let html = '';
    const boxClass = verdict.level === 'director' ? 'tds-box-info' : verdict.level === 'unknown' ? 'tds-box-danger' : 'tds-box-warn';
    html += `<div class="tds-box ${boxClass}"><strong>${verdict.headline}</strong><br>${verdict.detail}</div>`;
 
    const profile = results.find((r) => r.section === 'company' && r.selections === 'profile' && r.status === 'ok');
    if (profile) {
      html += '<div class="tds-section-label">Company</div><div class="tds-card">';
      Object.entries(profile.raw).slice(0, 8).forEach(([k, v]) => {
        if (typeof v === 'object') return;
        html += `<div class="tds-row"><span class="tds-row-label">${k}</span><span class="tds-row-value">${escapeHtml(String(v))}</span></div>`;
      });
      html += '</div>';
    }
 
    const employees = results.find((r) => r.section === 'company' && r.selections === 'employees' && r.status === 'ok');
    html += '<div class="tds-section-label">Employees</div>';
    if (employees) {
      const employeesKey = Object.keys(employees.raw).find((k) => k.toLowerCase().includes('employee'));
      const list = employeesKey ? employees.raw[employeesKey] : null;
      const entries = list ? (Array.isArray(list) ? list : Object.entries(list)) : [];
      html += '<div class="tds-card">';
      if (entries.length === 0) {
        html += '<div class="tds-row-label">No employee data in response.</div>';
      }
      entries.slice(0, 15).forEach((entry) => {
        const [id, emp] = Array.isArray(entry) ? [null, entry] : entry;
        const name = emp?.name || (id ?? 'Unknown');
        const position = emp?.position || '';
        html += `
          <div class="tds-employee-row">
            <div class="tds-employee-top">
              <div>
                <div class="tds-employee-name">${escapeHtml(String(name))}</div>
                <div class="tds-employee-meta">${escapeHtml(String(position))}</div>
              </div>
            </div>
            <div class="tds-employee-raw">${escapeHtml(JSON.stringify(emp))}</div>
          </div>`;
      });
      html += '</div>';
    } else {
      html += `<div class="tds-box tds-box-neutral">Roster not accessible with this key \u2014 see Diagnostics tab for the exact reason.</div>`;
    }
 
    el.innerHTML = html;
  }
 
  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
 
  // Dynamically resolves the employees list regardless of the exact key name
  // Torn uses for it (unverified until you've run the diagnostic against a
  // live key) — never assumes a fixed shape.
  function extractEmployeesEntries(companyEmployeesRaw) {
    if (!companyEmployeesRaw) return [];
    const employeesKey = Object.keys(companyEmployeesRaw).find((k) => k.toLowerCase().includes('employee'));
    const list = employeesKey ? companyEmployeesRaw[employeesKey] : null;
    if (!list) return [];
    const entries = Array.isArray(list) ? list.map((v, i) => [i, v]) : Object.entries(list);
    return entries.map(([id, emp]) => ({ id, raw: emp, name: emp?.name || `#${id}`, position: emp?.position || '' }));
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
    const employeesRaw = findRaw(results, 'company', 'employees');
    const blockedProfile = findBlockedReason(results, 'company', 'profile');
 
    let html = '';
 
    if (!profile) {
      html += `<div class="tds-box tds-box-danger"><strong>Company profile unavailable.</strong> ${blockedProfile || 'No data returned.'} Finance needs at least this to show anything.</div>`;
      el.innerHTML = html;
      return;
    }
 
    // Dynamically locate income-shaped fields rather than assuming exact
    // names — tags each as EXACT since it's a live field from this response.
    const incomeFields = Object.entries(profile).filter(([k, v]) => typeof v === 'number' && /profit|income/i.test(k));
    const dailyField = incomeFields.find(([k]) => /daily/i.test(k));
    const weeklyField = incomeFields.find(([k]) => /weekly/i.test(k));
 
    const employees = extractEmployeesEntries(employeesRaw);
    const wageFields = employees.map((e) => findWageField(e.raw)).filter(Boolean);
    const totalSalary = wageFields.length > 0 ? wageFields.reduce((sum, w) => sum + w.value, 0) : null;
    const salaryFieldName = wageFields[0]?.key;
 
    const todayGross = dailyField ? dailyField[1] : null;
    const todayNet = todayGross !== null && totalSalary !== null ? todayGross - totalSalary : null;
 
    // --- Today snapshot card ---
    html += '<div class="tds-section-label">Today</div><div class="tds-card">';
    html += `<div class="tds-row"><span class="tds-row-label">Gross${dailyField ? ` (${dailyField[0]})` : ''}</span><span class="tds-row-value">${todayGross !== null ? formatMoney(todayGross) : '<span class="tds-v-dim">unavailable</span>'}</span></div>`;
    html += `<div class="tds-row"><span class="tds-row-label">Salaries${salaryFieldName ? ` (sum of ${salaryFieldName})` : ''}</span><span class="tds-row-value tds-v-bad">${totalSalary !== null ? '-' + formatMoney(totalSalary) : '<span class="tds-v-dim">no wage field in this key\u2019s response</span>'}</span></div>`;
    html += `<div class="tds-row"><span class="tds-row-label">Net (DERIVED)</span><span class="tds-row-value ${todayNet !== null ? (todayNet >= 0 ? 'tds-v-good' : 'tds-v-bad') : ''}">${todayNet !== null ? formatMoney(todayNet) : '<span class="tds-v-dim">needs gross + salary above</span>'}</span></div>`;
    if (weeklyField) {
      html += `<div class="tds-row"><span class="tds-row-label">Weekly (${weeklyField[0]})</span><span class="tds-row-value">${formatMoney(weeklyField[1])}</span></div>`;
    }
    html += '</div>';
    if (todayGross === null) {
      html += `<div class="tds-box tds-box-warn">No field on <em>company/profile</em> looked like a profit/income number. Field names actually present: ${Object.keys(profile).join(', ')}. If one of these is the real income field under a name I didn\u2019t recognize, tell me the name and I\u2019ll wire it in directly instead of guessing.</div>`;
    }
 
    // --- Historical comparison from local snapshots ---
    const allSnapshots = await getSnapshotsSorted();
    const withProfile = allSnapshots.filter((s) => s.company_profile);
    const daily = collapseToDaily(withProfile);
 
    html += '<div class="tds-section-label">Today vs Yesterday <span class="tds-v-dim" style="font-weight:400;">(HISTORICAL \u2014 from local snapshots only)</span></div>';
    if (daily.length < 2) {
      html += `<div class="tds-box tds-box-neutral">Insufficient data \u2014 only ${daily.length} day${daily.length === 1 ? '' : 's'} of local snapshots so far. This starts filling in from tomorrow\u2019s first run onward; nothing here is backfilled or estimated.</div>`;
    } else {
      const todaySnap = daily[daily.length - 1];
      const ySnap = daily[daily.length - 2];
      const gField = Object.entries(todaySnap.company_profile).find(([k, v]) => typeof v === 'number' && /daily.*profit|daily.*income/i.test(k));
      const yField = gField ? [gField[0], ySnap.company_profile[gField[0]]] : null;
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
        const f = Object.entries(s.company_profile).find(([k, v]) => typeof v === 'number' && /daily.*profit|daily.*income/i.test(k));
        return f ? f[1] : null;
      }).filter((v) => v !== null);
      if (values.length >= 2) {
        const maxAbs = Math.max(...values.map((v) => Math.abs(v)), 1);
        html += `<div class="tds-section-label">Last ${values.length} days <span class="tds-v-dim" style="font-weight:400;">(local snapshots)</span></div><div class="tds-card"><div class="tds-spark">`;
        recent.forEach((s) => {
          const f = Object.entries(s.company_profile).find(([k, v]) => typeof v === 'number' && /daily.*profit|daily.*income/i.test(k));
          const v = f ? f[1] : 0;
          const h = Math.max(2, Math.round((Math.abs(v) / maxAbs) * 40));
          const cls = v >= 0 ? 'tds-bar-pos' : 'tds-bar-neg';
          const d = new Date(s.timestamp);
          html += `<div class="tds-spark-col"><div class="tds-spark-bar ${cls}" style="height:${h}px" title="${formatMoney(v)}"></div><div class="tds-spark-label">${d.getMonth() + 1}/${d.getDate()}</div></div>`;
        });
        html += '</div></div>';
      }
    }
 
    html += `<div class="tds-box tds-box-neutral" style="margin-top:10px;">One snapshot is taken per diagnostic run, up to ${MAX_SNAPSHOTS} kept locally (oldest pruned first). Run the diagnostic once a day to build a real trend.</div>`;
 
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
  function startFooterTicker(panel) {
    if (footerTicker) clearInterval(footerTicker);
    footerTicker = setInterval(() => {
      if (!state.lastRunAt) return;
      const secs = Math.floor((Date.now() - state.lastRunAt) / 1000);
      panel.querySelector('#tds-footer-status').textContent = `Last run ${secs}s ago`;
    }, 1000);
  }
 
  async function runFullDiagnostic(panel) {
    panel.querySelector('#tds-footer-status').textContent = 'Running diagnostic\u2026';
    const results = await runDiagnostic();
    const verdict = classifyAccess(results);
    await takeSnapshotFromDiagnostic(results);
 
    state.lastResults = results;
    state.lastVerdict = verdict;
    state.lastRunAt = Date.now();
 
    renderOverviewTab(panel, results, verdict);
    renderDiagnosticsTab(panel, results);
    startFooterTicker(panel);
  }
 
  // ---------------------------------------------------------------------
  // 6. BOOT
  // ---------------------------------------------------------------------
  function boot() {
    if (!document.body || document.getElementById('tds-panel')) return;
    injectStyles();
    buildPanel();
  }
 
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    boot();
  } else {
    document.addEventListener('DOMContentLoaded', boot);
  }
})();
