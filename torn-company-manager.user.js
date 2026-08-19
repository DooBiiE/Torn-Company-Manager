// ==UserScript==
// @name         Torn Company Management Suite
// @namespace    torn-company-management-suite
// @version      1.3.11
// @updateURL    https://raw.githubusercontent.com/DooBiiE/Torn-Company-Manager/main/torn-company-manager.user.js
// @downloadURL  https://raw.githubusercontent.com/DooBiiE/Torn-Company-Manager/main/torn-company-manager.user.js
// @description  Local-only company management dashboard for Torn directors, embedded in the Jobs page. No company data ever leaves your browser; only your Torn User ID is checked against a public license list.
// @author       DooBiiE
// @match        https://www.torn.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @connect      api.torn.com
// @connect      raw.githubusercontent.com
// @run-at       document-end
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
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __values = (this && this.__values) || function(o) {
    var s = typeof Symbol === "function" && Symbol.iterator, m = s && o[s], i = 0;
    if (m) return m.call(o);
    if (o && typeof o.length === "number") return {
        next: function () {
            if (o && i >= o.length) o = void 0;
            return { value: o && o[i++], done: !o };
        }
    };
    throw new TypeError(s ? "Object is not iterable." : "Symbol.iterator is not defined.");
};
var __read = (this && this.__read) || function (o, n) {
    var m = typeof Symbol === "function" && o[Symbol.iterator];
    if (!m) return o;
    var i = m.call(o), r, ar = [], e;
    try {
        while ((n === void 0 || n-- > 0) && !(r = i.next()).done) ar.push(r.value);
    }
    catch (error) { e = { error: error }; }
    finally {
        try {
            if (r && !r.done && (m = i["return"])) m.call(i);
        }
        finally { if (e) throw e.error; }
    }
    return ar;
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
(function () {
    var _a, _b, _c;
    console.log('[TDS] v1.3.11 PDA-compatible full build started');
    'use strict';
    // ---------------------------------------------------------------------
    // 0. CONSTANTS
    // ---------------------------------------------------------------------
    var API_BASE = 'https://api.torn.com';
    // Read the UI version from userscript metadata when available. TornPDA may
    // not expose that metadata API, so a release fallback is provided below.
    // TornPDA does not always expose the legacy GM_info object that desktop
    // userscript managers provide. Try both common metadata APIs, then use the
    // release version as a PDA-safe fallback so the UI never shows vunknown.
    var TDS_VERSION_FALLBACK = '1.3.11';
    // Update distribution uses the same GitHub-hosted .user.js for both version
    // checks and downloads. Release process: bump @version + this fallback, then
    // replace torn-company-manager.user.js on the main branch.
    var TDS_VERSION = (typeof GM_info !== 'undefined' && ((_a = GM_info === null || GM_info === void 0 ? void 0 : GM_info.script) === null || _a === void 0 ? void 0 : _a.version)) ||
        (typeof GM !== 'undefined' && ((_c = (_b = GM === null || GM === void 0 ? void 0 : GM.info) === null || _b === void 0 ? void 0 : _b.script) === null || _c === void 0 ? void 0 : _c.version)) ||
        TDS_VERSION_FALLBACK;
    var STORAGE_KEY_APIKEY = 'tds_api_key';
    var STORAGE_KEY_LAST_RUN_AT = 'tds_last_run_at';
    var STORAGE_KEY_THEME = 'tds_theme';
    var STORAGE_KEY_LICENSE_CACHE = 'tds_license_cache';
    // TornPDA normally supplies the underscore-style GM storage functions, but
    // keep a localStorage fallback so a missing/changed PDA GM shim cannot stop
    // the entire dashboard from mounting. Desktop Tampermonkey/Violentmonkey
    // continues to use the normal GM functions.
    function tdsGetValue(key, fallback) {
        if (fallback === void 0) { fallback = null; }
        try {
            if (typeof GM_getValue === 'function')
                return GM_getValue(key, fallback);
        }
        catch (err) {
            console.warn('[TDS] GM_getValue failed; using localStorage fallback:', err);
        }
        try {
            var raw = localStorage.getItem("tds_fallback_".concat(key));
            return raw === null ? fallback : JSON.parse(raw);
        }
        catch (_) {
            return fallback;
        }
    }
    function tdsSetValue(key, value) {
        try {
            if (typeof GM_setValue === 'function') {
                GM_setValue(key, value);
                return;
            }
        }
        catch (err) {
            console.warn('[TDS] GM_setValue failed; using localStorage fallback:', err);
        }
        try {
            localStorage.setItem("tds_fallback_".concat(key), JSON.stringify(value));
        }
        catch (_) { }
    }
    function tdsDeleteValue(key) {
        try {
            if (typeof GM_deleteValue === 'function') {
                GM_deleteValue(key);
                return;
            }
        }
        catch (err) {
            console.warn('[TDS] GM_deleteValue failed; using localStorage fallback:', err);
        }
        try {
            localStorage.removeItem("tds_fallback_".concat(key));
        }
        catch (_) { }
    }
    var MIN_CALL_INTERVAL_MS = 800; // ~75 req/min ceiling, well under Torn's 100/min cap
    var DB_NAME = 'torn_director_system';
    var DB_VERSION = 1;
    // Public list of licensed Torn User IDs. Only the numeric User ID (read
    // from user/basic, EXACT) is compared against this -- no API key or
    // company data is ever sent here. Expected shape (propose this to whoever
    // maintains the file if it isn't already in this form):
    //   [ { "userId": 4237873, "status": "active" }, { "userId": 1234567, "status": "expired" } ]
    // A "status" of anything other than "active"/"expired" (or a User ID not
    // present in the list at all) is treated as not licensed -- this never
    // guesses a license into existence.
    var LICENSE_JSON_URL = 'https://raw.githubusercontent.com/DooBiiE/Torn-Company-Manager/refs/heads/main/licensed-users.json';
    var LICENSE_CACHE_TTL_MS = 60 * 60 * 1000; // 1h -- avoids hitting GitHub raw on every page load/navigation
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
    var CUSTOM_KEY_TITLE = 'Torn Company Management Suite';
    var CUSTOM_KEY_SELECTIONS = {
        company: ['profile', 'employees', 'detailed', 'stock', 'news', 'applications', 'companies', 'search', 'snapshot'],
        user: ['basic', 'workstats', 'log'],
        torn: ['companies'],
    };
    function buildCustomKeyUrl() {
        var parts = [
            'https://www.torn.com/preferences.php#tab=api?step=addNewKey',
            "company=".concat(CUSTOM_KEY_SELECTIONS.company.join(',')),
            "user=".concat(CUSTOM_KEY_SELECTIONS.user.join(',')),
            "torn=".concat(CUSTOM_KEY_SELECTIONS.torn.join(',')),
            "title=".concat(encodeURIComponent(CUSTOM_KEY_TITLE)),
        ];
        return parts.join('&');
    }
    var PROBE_PLAN = [
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
    var THEME_PRESETS = {
        green: { accent: '#3ddc84', accentDim: 'rgba(61, 220, 132, 0.14)' },
        blue: { accent: '#4da3ff', accentDim: 'rgba(77, 163, 255, 0.14)' },
        purple: { accent: '#b18cff', accentDim: 'rgba(177, 140, 255, 0.14)' },
        amber: { accent: '#f5a623', accentDim: 'rgba(245, 166, 35, 0.14)' },
        cyan: { accent: '#39d0d8', accentDim: 'rgba(57, 208, 216, 0.14)' },
        pink: { accent: '#ff6bb5', accentDim: 'rgba(255, 107, 181, 0.14)' },
    };
    // ---------------------------------------------------------------------
    // 1. API CLIENT — queued, rate-limited, validated, never fabricates
    // ---------------------------------------------------------------------
    var ApiClient = (function () {
        var queue = Promise.resolve();
        var lastCallAt = 0;
        function rawCall(section, selections, id, extraParams) {
            if (id === void 0) { id = ''; }
            if (extraParams === void 0) { extraParams = {}; }
            var key = tdsGetValue(STORAGE_KEY_APIKEY, '');
            if (!key)
                return Promise.reject({ blocked: true, reason: 'No API key configured yet.' });
            var path = id ? "".concat(section, "/").concat(id) : section;
            var params = new URLSearchParams(__assign({ selections: selections, key: key }, extraParams));
            var url = "".concat(API_BASE, "/").concat(path, "?").concat(params.toString());
            return new Promise(function (resolve, reject) {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: url,
                    timeout: 15000,
                    onload: function (res) {
                        var json;
                        try {
                            json = JSON.parse(res.responseText);
                        }
                        catch (e) {
                            reject({ blocked: true, reason: 'Response was not valid JSON — Torn API may be down.' });
                            return;
                        }
                        if (json.error) {
                            reject({ blocked: true, code: json.error.code, reason: json.error.error });
                            return;
                        }
                        resolve(json);
                    },
                    onerror: function () { return reject({ blocked: true, reason: 'Network error contacting api.torn.com' }); },
                    ontimeout: function () { return reject({ blocked: true, reason: 'Request to api.torn.com timed out' }); },
                });
            });
        }
        function call(section, selections, id, extraParams) {
            if (id === void 0) { id = ''; }
            if (extraParams === void 0) { extraParams = {}; }
            var run = function () {
                var wait = Math.max(0, MIN_CALL_INTERVAL_MS - (Date.now() - lastCallAt));
                return new Promise(function (resolve) { return setTimeout(resolve, wait); }).then(function () {
                    lastCallAt = Date.now();
                    return rawCall(section, selections, id, extraParams);
                });
            };
            var result = queue.then(run, run);
            queue = result.then(function () { }, function () { });
            return result;
        }
        function rawCallV2(path, extraParams) {
            if (extraParams === void 0) { extraParams = {}; }
            var key = tdsGetValue(STORAGE_KEY_APIKEY, '');
            if (!key)
                return Promise.reject({ blocked: true, reason: 'No API key configured yet.' });
            // Torn API v2 / Swagger uses header authentication. Do NOT append the
            // secret API key to the query string here; doing so can return error 2
            // ("Incorrect key") even though the same key works with our v1 calls.
            var params = new URLSearchParams(__assign({}, extraParams));
            var cleanPath = String(path || '').replace(/^\/+/, '');
            var query = params.toString();
            var url = "".concat(API_BASE, "/v2/").concat(cleanPath).concat(query ? "?".concat(query) : '');
            return new Promise(function (resolve, reject) {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: url,
                    headers: {
                        Authorization: "ApiKey ".concat(key),
                    },
                    timeout: 15000,
                    onload: function (res) {
                        var json;
                        try {
                            json = JSON.parse(res.responseText);
                        }
                        catch (e) {
                            reject({ blocked: true, reason: 'Response was not valid JSON — Torn API may be down.' });
                            return;
                        }
                        if (json.error) {
                            reject({ blocked: true, code: json.error.code, reason: json.error.error || json.error.message });
                            return;
                        }
                        resolve(json);
                    },
                    onerror: function () { return reject({ blocked: true, reason: 'Network error contacting api.torn.com' }); },
                    ontimeout: function () { return reject({ blocked: true, reason: 'Request to api.torn.com timed out' }); },
                });
            });
        }
        function callV2(path, extraParams) {
            if (extraParams === void 0) { extraParams = {}; }
            var run = function () {
                var wait = Math.max(0, MIN_CALL_INTERVAL_MS - (Date.now() - lastCallAt));
                return new Promise(function (resolve) { return setTimeout(resolve, wait); }).then(function () {
                    lastCallAt = Date.now();
                    return rawCallV2(path, extraParams);
                });
            };
            var result = queue.then(run, run);
            queue = result.then(function () { }, function () { });
            return result;
        }
        function rawCallV2Text(path, extraParams) {
            if (extraParams === void 0) { extraParams = {}; }
            var key = tdsGetValue(STORAGE_KEY_APIKEY, '');
            if (!key)
                return Promise.reject({ blocked: true, reason: 'No API key configured yet.' });
            var params = new URLSearchParams(__assign({}, extraParams));
            var cleanPath = String(path || '').replace(/^\/+/, '');
            var query = params.toString();
            var url = "".concat(API_BASE, "/v2/").concat(cleanPath).concat(query ? "?".concat(query) : '');
            return new Promise(function (resolve, reject) {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: url,
                    headers: {
                        Authorization: "ApiKey ".concat(key),
                        Accept: 'text/csv, text/plain, */*',
                    },
                    timeout: 20000,
                    onload: function (res) {
                        var body = String(res.responseText || '');
                        // Snapshot errors may still arrive as JSON even though success is CSV.
                        var trimmed = body.trim();
                        if (trimmed.startsWith('{')) {
                            try {
                                var json = JSON.parse(trimmed);
                                if (json.error) {
                                    reject({
                                        blocked: true,
                                        code: json.error.code,
                                        reason: json.error.error || json.error.message || 'Torn API error',
                                    });
                                    return;
                                }
                            }
                            catch (_) { }
                        }
                        resolve(body);
                    },
                    onerror: function () { return reject({ blocked: true, reason: 'Network error contacting api.torn.com' }); },
                    ontimeout: function () { return reject({ blocked: true, reason: 'Request to api.torn.com timed out' }); },
                });
            });
        }
        function callV2Text(path, extraParams) {
            if (extraParams === void 0) { extraParams = {}; }
            var run = function () {
                var wait = Math.max(0, MIN_CALL_INTERVAL_MS - (Date.now() - lastCallAt));
                return new Promise(function (resolve) { return setTimeout(resolve, wait); }).then(function () {
                    lastCallAt = Date.now();
                    return rawCallV2Text(path, extraParams);
                });
            };
            var result = queue.then(run, run);
            queue = result.then(function () { }, function () { });
            return result;
        }
        return { call: call, callV2: callV2, callV2Text: callV2Text };
    })();
    // ---------------------------------------------------------------------
    // 2. LOCAL STORAGE (IndexedDB) — snapshots only, nothing leaves the browser
    // ---------------------------------------------------------------------
    var LocalDB = (function () {
        var dbPromise = null;
        function open() {
            if (dbPromise)
                return dbPromise;
            dbPromise = new Promise(function (resolve, reject) {
                var req = indexedDB.open(DB_NAME, DB_VERSION);
                req.onupgradeneeded = function () {
                    var db = req.result;
                    if (!db.objectStoreNames.contains('snapshots')) {
                        var store = db.createObjectStore('snapshots', { keyPath: 'id', autoIncrement: true });
                        store.createIndex('timestamp', 'timestamp');
                    }
                    if (!db.objectStoreNames.contains('diagnostics')) {
                        db.createObjectStore('diagnostics', { keyPath: 'timestamp' });
                    }
                };
                req.onsuccess = function () { return resolve(req.result); };
                req.onerror = function () { return reject(req.error); };
            });
            return dbPromise;
        }
        function put(storeName, value) {
            return __awaiter(this, void 0, void 0, function () {
                var db;
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0: return [4 /*yield*/, open()];
                        case 1:
                            db = _a.sent();
                            return [2 /*return*/, new Promise(function (resolve, reject) {
                                    var tx = db.transaction(storeName, 'readwrite');
                                    tx.objectStore(storeName).put(value);
                                    tx.oncomplete = function () { return resolve(); };
                                    tx.onerror = function () { return reject(tx.error); };
                                })];
                    }
                });
            });
        }
        function getAll(storeName) {
            return __awaiter(this, void 0, void 0, function () {
                var db;
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0: return [4 /*yield*/, open()];
                        case 1:
                            db = _a.sent();
                            return [2 /*return*/, new Promise(function (resolve, reject) {
                                    var tx = db.transaction(storeName, 'readonly');
                                    var req = tx.objectStore(storeName).getAll();
                                    req.onsuccess = function () { return resolve(req.result || []); };
                                    req.onerror = function () { return reject(req.error); };
                                })];
                    }
                });
            });
        }
        function deleteKey(storeName, key) {
            return __awaiter(this, void 0, void 0, function () {
                var db;
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0: return [4 /*yield*/, open()];
                        case 1:
                            db = _a.sent();
                            return [2 /*return*/, new Promise(function (resolve, reject) {
                                    var tx = db.transaction(storeName, 'readwrite');
                                    tx.objectStore(storeName).delete(key);
                                    tx.oncomplete = function () { return resolve(); };
                                    tx.onerror = function () { return reject(tx.error); };
                                })];
                    }
                });
            });
        }
        function getLatest(storeName_1) {
            return __awaiter(this, arguments, void 0, function (storeName, sortField) {
                var all;
                if (sortField === void 0) { sortField = 'timestamp'; }
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0: return [4 /*yield*/, getAll(storeName)];
                        case 1:
                            all = _a.sent();
                            if (!all.length)
                                return [2 /*return*/, null];
                            return [2 /*return*/, all.reduce(function (latest, row) {
                                    return !latest || (Number(row === null || row === void 0 ? void 0 : row[sortField]) || 0) > (Number(latest === null || latest === void 0 ? void 0 : latest[sortField]) || 0)
                                        ? row
                                        : latest;
                                }, null)];
                    }
                });
            });
        }
        function clear(storeName) {
            return __awaiter(this, void 0, void 0, function () {
                var db;
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0: return [4 /*yield*/, open()];
                        case 1:
                            db = _a.sent();
                            return [2 /*return*/, new Promise(function (resolve, reject) {
                                    var tx = db.transaction(storeName, 'readwrite');
                                    tx.objectStore(storeName).clear();
                                    tx.oncomplete = function () { return resolve(); };
                                    tx.onerror = function () { return reject(tx.error); };
                                })];
                    }
                });
            });
        }
        return { put: put, getAll: getAll, deleteKey: deleteKey, getLatest: getLatest, clear: clear };
    })();
    var MAX_SNAPSHOTS = 120; // matches the "120 max stored locally" retention policy
    function pruneSnapshots() {
        return __awaiter(this, void 0, void 0, function () {
            var all, toRemove, toRemove_1, toRemove_1_1, row, e_1_1;
            var e_1, _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0: return [4 /*yield*/, LocalDB.getAll('snapshots')];
                    case 1:
                        all = _b.sent();
                        if (all.length <= MAX_SNAPSHOTS)
                            return [2 /*return*/];
                        all.sort(function (a, b) { return a.timestamp - b.timestamp; });
                        toRemove = all.slice(0, all.length - MAX_SNAPSHOTS);
                        _b.label = 2;
                    case 2:
                        _b.trys.push([2, 7, 8, 9]);
                        toRemove_1 = __values(toRemove), toRemove_1_1 = toRemove_1.next();
                        _b.label = 3;
                    case 3:
                        if (!!toRemove_1_1.done) return [3 /*break*/, 6];
                        row = toRemove_1_1.value;
                        return [4 /*yield*/, LocalDB.deleteKey('snapshots', row.id)];
                    case 4:
                        _b.sent();
                        _b.label = 5;
                    case 5:
                        toRemove_1_1 = toRemove_1.next();
                        return [3 /*break*/, 3];
                    case 6: return [3 /*break*/, 9];
                    case 7:
                        e_1_1 = _b.sent();
                        e_1 = { error: e_1_1 };
                        return [3 /*break*/, 9];
                    case 8:
                        try {
                            if (toRemove_1_1 && !toRemove_1_1.done && (_a = toRemove_1.return)) _a.call(toRemove_1);
                        }
                        finally { if (e_1) throw e_1.error; }
                        return [7 /*endfinally*/];
                    case 9: return [2 /*return*/];
                }
            });
        });
    }
    // ---------------------------------------------------------------------
    // 3. DIAGNOSTIC RUNNER
    // ---------------------------------------------------------------------
    function runDiagnostic(onEach) {
        return __awaiter(this, void 0, void 0, function () {
            var results, PROBE_PLAN_1, PROBE_PLAN_1_1, probe, data, r, err_1, r, e_2_1;
            var e_2, _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        results = [];
                        _b.label = 1;
                    case 1:
                        _b.trys.push([1, 8, 9, 10]);
                        PROBE_PLAN_1 = __values(PROBE_PLAN), PROBE_PLAN_1_1 = PROBE_PLAN_1.next();
                        _b.label = 2;
                    case 2:
                        if (!!PROBE_PLAN_1_1.done) return [3 /*break*/, 7];
                        probe = PROBE_PLAN_1_1.value;
                        _b.label = 3;
                    case 3:
                        _b.trys.push([3, 5, , 6]);
                        return [4 /*yield*/, ApiClient.call(probe.section, probe.selections)];
                    case 4:
                        data = _b.sent();
                        r = __assign(__assign({}, probe), { status: 'ok', sampleKeys: extractTopLevelKeys(data), raw: data });
                        results.push(r);
                        onEach === null || onEach === void 0 ? void 0 : onEach(r);
                        return [3 /*break*/, 6];
                    case 5:
                        err_1 = _b.sent();
                        r = __assign(__assign({}, probe), { status: 'blocked', code: err_1.code, reason: err_1.reason || 'Unknown error' });
                        results.push(r);
                        onEach === null || onEach === void 0 ? void 0 : onEach(r);
                        return [3 /*break*/, 6];
                    case 6:
                        PROBE_PLAN_1_1 = PROBE_PLAN_1.next();
                        return [3 /*break*/, 2];
                    case 7: return [3 /*break*/, 10];
                    case 8:
                        e_2_1 = _b.sent();
                        e_2 = { error: e_2_1 };
                        return [3 /*break*/, 10];
                    case 9:
                        try {
                            if (PROBE_PLAN_1_1 && !PROBE_PLAN_1_1.done && (_a = PROBE_PLAN_1.return)) _a.call(PROBE_PLAN_1);
                        }
                        finally { if (e_2) throw e_2.error; }
                        return [7 /*endfinally*/];
                    case 10: return [4 /*yield*/, LocalDB.put('diagnostics', { timestamp: Date.now(), results: results })];
                    case 11:
                        _b.sent();
                        return [2 /*return*/, results];
                }
            });
        });
    }
    function extractTopLevelKeys(obj) {
        if (!obj || typeof obj !== 'object')
            return [];
        return Object.keys(obj);
    }
    function takeSnapshotFromDiagnostic(results) {
        return __awaiter(this, void 0, void 0, function () {
            var snapshot, results_1, results_1_1, r;
            var e_3, _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        snapshot = { timestamp: Date.now(), source: 'api' };
                        try {
                            for (results_1 = __values(results), results_1_1 = results_1.next(); !results_1_1.done; results_1_1 = results_1.next()) {
                                r = results_1_1.value;
                                if (r.status === 'ok')
                                    snapshot["".concat(r.section, "_").concat(r.selections)] = r.raw;
                            }
                        }
                        catch (e_3_1) { e_3 = { error: e_3_1 }; }
                        finally {
                            try {
                                if (results_1_1 && !results_1_1.done && (_a = results_1.return)) _a.call(results_1);
                            }
                            finally { if (e_3) throw e_3.error; }
                        }
                        if (!(Object.keys(snapshot).length > 2)) return [3 /*break*/, 3];
                        return [4 /*yield*/, LocalDB.put('snapshots', snapshot)];
                    case 1:
                        _b.sent();
                        return [4 /*yield*/, pruneSnapshots()];
                    case 2:
                        _b.sent();
                        _b.label = 3;
                    case 3: return [2 /*return*/, snapshot];
                }
            });
        });
    }
    // ---------------------------------------------------------------------
    // 3b. ACCESS VERDICT — DERIVED purely from the real statuses above
    // ---------------------------------------------------------------------
    function classifyAccess(results) {
        var byKey = function (section, selections) {
            return results.find(function (r) { return r.section === section && r.selections === selections; });
        };
        var financials = byKey('company', 'detailed');
        var stock = byKey('company', 'stock');
        var applications = byKey('company', 'applications');
        var roster = byKey('company', 'employees');
        var directorSignals = [financials, stock, applications].filter(Boolean);
        var directorOkCount = directorSignals.filter(function (r) { return r.status === 'ok'; }).length;
        var directorBlockedCount = directorSignals.filter(function (r) { return r.status === 'blocked'; }).length;
        if (directorOkCount === directorSignals.length && directorSignals.length > 0) {
            return {
                level: 'director',
                headline: 'Director-level access confirmed',
                detail: 'company/detailed, company/stock, and company/applications all returned real data. This key can drive the full system.',
            };
        }
        if ((roster === null || roster === void 0 ? void 0 : roster.status) === 'ok' && directorOkCount === 0 && directorBlockedCount > 0) {
            return {
                level: 'employee',
                headline: 'Employee-level access only',
                detail: 'Roster is visible, but financials/stock/applications are blocked (' +
                    directorSignals.map(function (r) { return "".concat(r.selections, ": ").concat(r.reason || 'blocked'); }).join('; ') +
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
        var css = "\n      /* Embedded Management Suite -- lives inside Torn's own Jobs page, not\n         an overlay. Structural colours (background/border/text) below are\n         CSS variables with these dark-theme values as fallbacks; detectTornColours()\n         overwrites them at runtime by sampling Torn's own page chrome, so the\n         panel matches whichever skin (light or dark) the player is using.\n         --tds-accent / --tds-accent-dim are the user-selectable theme colour\n         (Settings tab) and are never touched by colour detection. Semantic\n         colours (green/red/amber meaning good/bad/warning) are fixed on\n         purpose and are not part of either system. */\n      #tds-panel {\n        width: 100%; box-sizing: border-box; margin: 14px 0 18px;\n        background: var(--tds-bg, #2b2b2b); color: var(--tds-fg, #d8d8d8);\n        border: 1px solid var(--tds-border, #1a1a1a);\n        border-radius: 10px; overflow: hidden; font: 13px/1.45 -apple-system, 'Segoe UI', sans-serif;\n        box-shadow: 0 4px 18px rgba(0,0,0,.22);\n        position: relative; z-index: 20;\n      }\n      #tds-header {\n        display: flex; align-items: center; justify-content: space-between; gap: 12px;\n        padding: 12px 14px; background: var(--tds-bg-alt, #383838); border-bottom: 1px solid var(--tds-border, #1a1a1a);\n      }\n      #tds-header .tds-brand { display: flex; align-items: baseline; gap: 7px; min-width: 0; flex-wrap: wrap; }\n      #tds-header .tds-brand-dot { color: var(--tds-accent, #3ddc84); font-size: 13px; }\n      #tds-header .tds-brand-name {\n        color: var(--tds-accent, #3ddc84); font-weight: 800; font-size: 13px; letter-spacing: .04em;\n      }\n      #tds-header .tds-brand-version { color: var(--tds-text-faintest, #888888); font-size: 10.5px; }\n      #tds-header .tds-brand-subtitle { color: var(--tds-text-subtle, #969696); font-size: 10.5px; margin-left: 4px; }\n      #tds-header-icons { display: flex; gap: 6px; flex-shrink: 0; }\n      #tds-header-icons button {\n        min-width: 30px; height: 28px; display: flex; align-items: center; justify-content: center;\n        background: transparent; color: var(--tds-text-icon, #aaaaaa); border: 1px solid var(--tds-border-strong, #4a4a4a); border-radius: 6px;\n        cursor: pointer; font-size: 12px; padding: 0 8px;\n      }\n      #tds-header-icons button:hover { background: var(--tds-bg-hover, #404040); color: var(--tds-fg, #d8d8d8); }\n\n      #tds-tabs {\n        display: flex; flex-wrap: wrap; gap: 2px; padding: 9px 12px 0;\n        border-bottom: 1px solid var(--tds-border, #1a1a1a); background: var(--tds-bg, #2b2b2b);\n      }\n      .tds-tab {\n        background: transparent; border: none; color: var(--tds-text-dim, #999999); font: 700 10.5px/1 -apple-system, sans-serif;\n        letter-spacing: .05em; padding: 0 5px 10px; margin-right: 12px; cursor: pointer;\n        border-bottom: 2px solid transparent;\n      }\n      .tds-tab:hover { color: var(--tds-text-mid, #b5b5b5); }\n      .tds-tab.tds-tab-active { color: var(--tds-accent, #3ddc84); border-bottom-color: var(--tds-accent, #3ddc84); }\n      .tds-tab.tds-tab-locked { color: var(--tds-text-disabled, #666666); cursor: default; }\n      .tds-tab.tds-tab-locked:hover { color: var(--tds-text-disabled, #666666); }\n\n      #tds-body { padding: 14px; box-sizing: border-box; }\n      .tds-tabpanel[hidden] { display: none; }\n      .tds-section-label {\n        font: 700 10.5px/1 -apple-system, sans-serif; letter-spacing: .08em; color: var(--tds-text-faint, #9a9a9a);\n        text-transform: uppercase; margin: 16px 0 8px;\n      }\n      .tds-section-label:first-child { margin-top: 0; }\n      .tds-employee-subheading { font-weight: 800 !important; text-decoration: underline; text-underline-offset: 2px; }\n      .tds-card { background: var(--tds-bg-card, #323232); border: 1px solid var(--tds-border, #1a1a1a); border-radius: 8px; padding: 12px 14px; margin-bottom: 10px; }\n      .tds-card-title { color: var(--tds-text-icon, #aaaaaa); font-size: 11.5px; margin-bottom: 6px; }\n      .tds-row { display: flex; justify-content: space-between; align-items: center; padding: 3px 0; gap: 10px; }\n      .tds-row-label { color: var(--tds-text-mid, #b5b5b5); }\n      .tds-row-value { font-weight: 700; color: var(--tds-text-strong, #f0f0f0); }\n      .tds-v-good { color: #3ddc84 !important; }\n      .tds-v-bad { color: #ff5c5c !important; }\n      .tds-v-warn { color: #f5a623 !important; }\n      .tds-v-dim { color: var(--tds-text-dim, #999999) !important; font-weight: 400 !important; }\n      .tds-box { border-radius: 7px; padding: 10px 12px; margin-bottom: 10px; font-size: 12px; line-height: 1.5; }\n      .tds-box-info { background: rgba(61,220,132,.07); border: 1px solid rgba(61,220,132,.28); color: #a9e8c1; }\n      .tds-box-warn { background: rgba(245,166,35,.09); border: 1px solid rgba(245,166,35,.3); color: #f0c584; }\n      .tds-box-danger { background: rgba(255,92,92,.08); border: 1px solid rgba(255,92,92,.3); color: #ffb3b3; }\n      .tds-box-neutral { background: var(--tds-bg-card, #323232); border: 1px solid var(--tds-border, #1a1a1a); color: var(--tds-text-mid, #b5b5b5); }\n      .tds-box strong { color: inherit; }\n      .tds-badge { display: inline-flex; align-items: center; font: 700 10px/1 -apple-system, sans-serif; padding: 3px 7px; border-radius: 5px; white-space: nowrap; letter-spacing: .02em; }\n      .tds-badge-ok { background: rgba(61,220,132,.14); color: #3ddc84; border: 1px solid rgba(61,220,132,.3); }\n      .tds-badge-blocked { background: rgba(255,92,92,.12); color: #ff8b8b; border: 1px solid rgba(255,92,92,.28); }\n      .tds-badge-neutral { background: var(--tds-bg-hover, #404040); color: var(--tds-text-icon, #aaaaaa); border: 1px solid var(--tds-border-strong, #4a4a4a); }\n      .tds-employee-row { padding: 9px 0; border-bottom: 1px solid var(--tds-border-soft, #242424); }\n      .tds-employee-row:last-child { border-bottom: none; }\n      .tds-employee-row > summary { cursor: pointer; list-style: none; }\n      .tds-employee-row > summary::-webkit-details-marker { display: none; }\n      .tds-employee-row > summary::marker { content: ''; }\n      .tds-employee-chevron {\n        display: inline-block; font-size: 10px; color: var(--tds-text-dim, #999999);\n        transition: transform .15s ease; transform: rotate(0deg);\n      }\n      .tds-employee-row[open] .tds-employee-chevron { transform: rotate(90deg); }\n      .tds-employee-row[open] > summary { margin-bottom: 2px; }\n      .tds-employee-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }\n      .tds-employee-name { font-weight: 700; color: var(--tds-text-strong, #f0f0f0); font-size: 13px; }\n      .tds-employee-meta { color: var(--tds-text-dim, #999999); font-size: 11px; margin-top: 1px; }\n      .tds-diag-row { display: flex; justify-content: space-between; align-items: flex-start; padding: 8px 0; border-bottom: 1px solid var(--tds-border-soft, #242424); gap: 10px; }\n      .tds-diag-row:last-child { border-bottom: none; }\n      .tds-diag-label { color: var(--tds-text-mid2, #cfcfcf); font-size: 12px; }\n      .tds-diag-reason { color: var(--tds-text-dim, #999999); font-size: 11px; margin-top: 2px; }\n      .tds-btn { background: var(--tds-accent, #3ddc84); color: #06110a; border: none; border-radius: 6px; padding: 8px 12px; font: 700 12px/1 -apple-system, sans-serif; cursor: pointer; letter-spacing: .02em; }\n      .tds-btn:hover { filter: brightness(1.08); }\n      .tds-btn-ghost { background: transparent; color: var(--tds-text-mid, #b5b5b5); border: 1px solid var(--tds-border-strong, #4a4a4a); border-radius: 6px; padding: 8px 12px; font: 600 12px/1 -apple-system, sans-serif; cursor: pointer; }\n      .tds-btn-ghost:hover { background: var(--tds-bg-hover, #404040); color: var(--tds-fg, #d8d8d8); }\n      .tds-input { width: 100%; background: var(--tds-bg, #2b2b2b); color: var(--tds-text-strong, #f0f0f0); border: 1px solid var(--tds-border-strong, #4a4a4a); border-radius: 6px; padding: 8px 9px; box-sizing: border-box; font: 12.5px monospace; }\n      .tds-input:focus { outline: none; border-color: var(--tds-accent, #3ddc84); }\n      .tds-swatches { display: flex; gap: 8px; margin-top: 8px; }\n      .tds-swatch { width: 26px; height: 26px; border-radius: 50%; cursor: pointer; border: 2px solid transparent; }\n      .tds-swatch.tds-swatch-active { border-color: var(--tds-fg, #fff); }\n      .tds-segmented { display: flex; gap: 4px; margin-bottom: 10px; flex-wrap: wrap; }\n      .tds-segment { flex: 1; min-width: 90px; text-align: center; background: var(--tds-bg-card, #323232); color: var(--tds-text-icon, #aaaaaa); border: 1px solid var(--tds-border-strong, #4a4a4a); border-radius: 6px; padding: 8px 6px; font: 700 10.5px/1 -apple-system, sans-serif; letter-spacing: .03em; cursor: pointer; }\n      .tds-segment:hover { background: var(--tds-bg-hover, #404040); }\n      .tds-segment.tds-segment-active { background: var(--tds-accent-dim, rgba(61,220,132,.14)); color: var(--tds-accent, #3ddc84); border-color: var(--tds-accent, #3ddc84); }\n      .tds-table { width: 100%; border-collapse: collapse; font-size: 12px; }\n      .tds-table th { text-align: left; color: var(--tds-text-faint, #9a9a9a); font-size: 10px; letter-spacing: .05em; text-transform: uppercase; padding: 4px 6px; border-bottom: 1px solid var(--tds-border, #1a1a1a); }\n      .tds-table td { padding: 5px 6px; border-bottom: 1px solid var(--tds-border-soft, #242424); color: var(--tds-fg, #d8d8d8); }\n      .tds-table tr:last-child td { border-bottom: none; }\n      .tds-table td.tds-num { text-align: right; font-variant-numeric: tabular-nums; }\n      .tds-optimize-table th,\n      .tds-optimize-table td { text-align: center !important; vertical-align: middle; }\n      .tds-optimize-table td.tds-num { text-align: center !important; }\n      .tds-optimize-table tbody tr td {\n        border-bottom: 1px solid var(--tds-border-strong, #4a4a4a);\n        padding-top: 8px;\n        padding-bottom: 8px;\n      }\n      .tds-optimize-table tbody tr:last-child td { border-bottom: none; }\n      .tds-compare-table th,\n      .tds-compare-table td {\n        text-align: center !important;\n        vertical-align: middle;\n      }\n      .tds-compare-table td.tds-num { text-align: center !important; }\n      .tds-training-debt-table th,\n      .tds-training-debt-table td {\n        text-align: center !important;\n        vertical-align: middle;\n      }\n      .tds-training-debt-table tbody tr td {\n        border-bottom: 1px solid var(--tds-border-strong, #4a4a4a);\n        padding-top: 8px;\n        padding-bottom: 8px;\n      }\n      .tds-training-debt-table tbody tr:last-child td { border-bottom: none; }\n      .tds-stock-table th,\n      .tds-stock-table td {\n        text-align: center !important;\n        vertical-align: middle;\n      }\n      .tds-stock-table tbody tr td {\n        border-bottom: 1px solid var(--tds-border-strong, #4a4a4a);\n        padding-top: 8px;\n        padding-bottom: 8px;\n      }\n      .tds-stock-table tbody tr:last-child td { border-bottom: none; }\n      .tds-spark { display: flex; align-items: flex-end; gap: 4px; height: 46px; margin: 6px 0; }\n      .tds-spark-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; }\n      .tds-spark-bar { width: 100%; border-radius: 2px 2px 0 0; min-height: 2px; }\n      .tds-spark-bar.tds-bar-pos { background: var(--tds-accent, #3ddc84); }\n      .tds-spark-bar.tds-bar-neg { background: #ff5c5c; }\n      .tds-spark-label { font-size: 9px; color: var(--tds-text-faintest, #888888); }\n      #tds-footer { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-top: 1px solid var(--tds-border, #1a1a1a); background: var(--tds-bg-alt, #383838); font-size: 10.5px; color: var(--tds-text-faintest, #888888); }\n      #tds-footer .tds-footer-status { color: var(--tds-accent, #3ddc84); }\n      #tds-mount-error { margin: 14px 0; }\n\n      @media (max-width: 700px) {\n        #tds-header { align-items: flex-start; }\n        #tds-header .tds-brand { flex-wrap: wrap; }\n        #tds-header .tds-brand-subtitle { display: none; }\n        #tds-tabs { overflow-x: auto; flex-wrap: nowrap; scrollbar-width: thin; }\n        .tds-tab { flex: 0 0 auto; }\n        #tds-body { padding: 10px; }\n        .tds-row { align-items: flex-start; }\n      }\n    ";
        var style = document.createElement('style');
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
        var m = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\)/.exec(str || '');
        if (!m)
            return null;
        return { r: +m[1], g: +m[2], b: +m[3], a: m[4] !== undefined ? +m[4] : 1 };
    }
    function shadeColor(c, amt) {
        var clamp = function (v) { return Math.max(0, Math.min(255, v)); };
        return { r: clamp(c.r + amt), g: clamp(c.g + amt), b: clamp(c.b + amt) };
    }
    function rgbToCss(c) {
        return "rgb(".concat(Math.round(c.r), ", ").concat(Math.round(c.g), ", ").concat(Math.round(c.b), ")");
    }
    function detectTornColours() {
        var e_4, _a;
        try {
            var candidates = ['#skin-container', '.content-wrapper', '#mainContainer', '#top-page-links-wrap', 'body'];
            var probe = null;
            try {
                for (var candidates_1 = __values(candidates), candidates_1_1 = candidates_1.next(); !candidates_1_1.done; candidates_1_1 = candidates_1.next()) {
                    var sel = candidates_1_1.value;
                    var el = document.querySelector(sel);
                    if (!el)
                        continue;
                    var bg_1 = parseRgbColor(getComputedStyle(el).backgroundColor);
                    if (bg_1 && bg_1.a > 0 && !(bg_1.r === 0 && bg_1.g === 0 && bg_1.b === 0 && bg_1.a < 1)) {
                        probe = el;
                        break;
                    }
                }
            }
            catch (e_4_1) { e_4 = { error: e_4_1 }; }
            finally {
                try {
                    if (candidates_1_1 && !candidates_1_1.done && (_a = candidates_1.return)) _a.call(candidates_1);
                }
                finally { if (e_4) throw e_4.error; }
            }
            if (!probe)
                return;
            var cs = getComputedStyle(probe);
            var bg_2 = parseRgbColor(cs.backgroundColor);
            if (!bg_2)
                return;
            var luminance = (0.299 * bg_2.r + 0.587 * bg_2.g + 0.114 * bg_2.b) / 255;
            var dark = luminance < 0.5;
            var root = document.documentElement;
            if (dark) {
                // Keep the built-in dark palette (it already reads well on dark
                // skins) but nudge every shade slightly toward Torn's actual
                // background tone instead of leaving it a fixed, possibly
                // mismatched dark navy.
                var nudge = function (fallback) { return rgbToCss({
                    r: fallback.r * 0.6 + bg_2.r * 0.4,
                    g: fallback.g * 0.6 + bg_2.g * 0.4,
                    b: fallback.b * 0.6 + bg_2.b * 0.4,
                }); };
                root.style.setProperty('--tds-bg', nudge({ r: 43, g: 43, b: 43 }));
                root.style.setProperty('--tds-bg-alt', nudge({ r: 56, g: 56, b: 56 }));
                root.style.setProperty('--tds-bg-card', nudge({ r: 50, g: 50, b: 50 }));
                root.style.setProperty('--tds-bg-hover', nudge({ r: 64, g: 64, b: 64 }));
            }
            else {
                // Light Torn skin: derive a full light palette FROM the sampled
                // background rather than forcing the dark defaults onto a light
                // page, where they'd look like a jarring floating dark box.
                root.style.setProperty('--tds-bg', rgbToCss(bg_2));
                root.style.setProperty('--tds-bg-alt', rgbToCss(shadeColor(bg_2, -10)));
                root.style.setProperty('--tds-bg-card', rgbToCss(shadeColor(bg_2, -5)));
                root.style.setProperty('--tds-bg-hover', rgbToCss(shadeColor(bg_2, -14)));
                root.style.setProperty('--tds-border', rgbToCss(shadeColor(bg_2, -28)));
                root.style.setProperty('--tds-border-soft', rgbToCss(shadeColor(bg_2, -16)));
                root.style.setProperty('--tds-border-strong', rgbToCss(shadeColor(bg_2, -38)));
                root.style.setProperty('--tds-fg', rgbToCss(shadeColor(bg_2, -110)));
                root.style.setProperty('--tds-text-strong', rgbToCss(shadeColor(bg_2, -120)));
                root.style.setProperty('--tds-text-mid', rgbToCss(shadeColor(bg_2, -75)));
                root.style.setProperty('--tds-text-mid2', rgbToCss(shadeColor(bg_2, -80)));
                root.style.setProperty('--tds-text-dim', rgbToCss(shadeColor(bg_2, -55)));
                root.style.setProperty('--tds-text-faint', rgbToCss(shadeColor(bg_2, -60)));
                root.style.setProperty('--tds-text-faintest', rgbToCss(shadeColor(bg_2, -45)));
                root.style.setProperty('--tds-text-icon', rgbToCss(shadeColor(bg_2, -65)));
                root.style.setProperty('--tds-text-subtle', rgbToCss(shadeColor(bg_2, -50)));
                root.style.setProperty('--tds-text-disabled', rgbToCss(shadeColor(bg_2, -30)));
            }
        }
        catch (err) {
            console.warn('[TDS] Torn colour detection skipped:', err);
        }
    }
    function applyTheme(panelRoot, name) {
        var theme = THEME_PRESETS[name] || THEME_PRESETS.green;
        panelRoot.style.setProperty('--tds-accent', theme.accent);
        panelRoot.style.setProperty('--tds-accent-dim', theme.accentDim);
    }
    // ---------------------------------------------------------------------
    // 5. UI STATE
    // ---------------------------------------------------------------------
    var state = {
        lastResults: null,
        lastVerdict: null,
        lastRunAt: null,
        diagnosticRunning: false,
        panel: null,
        benchmark: { tier: 'same', cache: {}, snapshot: null }, // cache keyed by categoryId -> { timestamp, data }
        stock: { loading: false, newsCache: null, newsCacheAt: 0 },
    };
    function isJobsPage() {
        // Desktop and TornPDA can expose slightly different URL shapes during
        // WebView/SPA navigation. Match the real companies.php path even when
        // there is a trailing slash, query string or hash route.
        var path = String(window.location.pathname || '').replace(/\/+$/, '');
        if (/(?:^|\/)companies\.php$/i.test(path))
            return true;
        return /\/companies\.php(?:[?#]|$)/i.test(String(window.location.href || ''));
    }
    function findJobsMount() {
        var e_5, _a;
        var anchors = [
            '.companies-wrap',
            '#companies-page',
            '[class*="companies"][class*="wrap"]',
            '.content-wrapper',
            '#main-container',
            '#mainContainer',
            '.cont-gray',
            'main',
            '[role="main"]',
        ];
        try {
            for (var anchors_1 = __values(anchors), anchors_1_1 = anchors_1.next(); !anchors_1_1.done; anchors_1_1 = anchors_1.next()) {
                var selector = anchors_1_1.value;
                var el = document.querySelector(selector);
                if (el && !el.closest('#tds-panel'))
                    return el;
            }
        }
        catch (e_5_1) { e_5 = { error: e_5_1 }; }
        finally {
            try {
                if (anchors_1_1 && !anchors_1_1.done && (_a = anchors_1.return)) _a.call(anchors_1);
            }
            finally { if (e_5) throw e_5.error; }
        }
        // TornPDA's mobile DOM can omit desktop wrapper classes. On the confirmed
        // companies page, body is a safe last-resort mount rather than making the
        // whole suite disappear.
        return isJobsPage() ? document.body : null;
    }
    function removePanel() {
        var panel = document.getElementById('tds-panel');
        if (panel)
            panel.remove();
        state.panel = null;
    }
    function buildPanel(mount) {
        var panel = document.createElement('section');
        panel.id = 'tds-panel';
        panel.setAttribute('aria-label', 'Torn Company Management Suite');
        panel.innerHTML = "\n      <div id=\"tds-header\">\n        <div class=\"tds-brand\">\n          <span class=\"tds-brand-dot\">\u25CB</span>\n          <span class=\"tds-brand-name\">TORN COMPANY MANAGEMENT SUITE</span>\n          <span class=\"tds-brand-version\">v".concat(TDS_VERSION, "</span>\n          <span class=\"tds-brand-subtitle\">Company Director Dashboard</span>\n        </div>\n        <div id=\"tds-header-icons\">\n          <button data-action=\"refresh\" title=\"Run Diagnostics Again\">\u27F3</button>\n          <button data-action=\"tab-settings\" title=\"Settings\">\u2699</button>\n        </div>\n      </div>\n      <div id=\"tds-tabs\">\n        <button class=\"tds-tab tds-tab-active\" data-tab=\"overview\">OVERVIEW</button>\n        <button class=\"tds-tab\" data-tab=\"finance\">COMPANY FINANCIALS</button>\n        <button class=\"tds-tab\" data-tab=\"stock\">STOCK</button>\n        <button class=\"tds-tab\" data-tab=\"training\">TRAINING</button>\n        <button class=\"tds-tab\" data-tab=\"benchmark\">COMPARE</button>\n        <button class=\"tds-tab\" data-tab=\"optimize\">EMPLOYEE EFFECTIVENESS</button>\n        <button class=\"tds-tab\" data-tab=\"settings\">SETTINGS</button>\n        <button class=\"tds-tab\" data-tab=\"diagnostics\">DIAGNOSTICS</button>\n      </div>\n      <div id=\"tds-body\">\n        <div class=\"tds-tabpanel\" data-tabpanel=\"overview\"></div>\n        <div class=\"tds-tabpanel\" data-tabpanel=\"finance\" hidden></div>\n        <div class=\"tds-tabpanel\" data-tabpanel=\"stock\" hidden></div>\n        <div class=\"tds-tabpanel\" data-tabpanel=\"training\" hidden></div>\n        <div class=\"tds-tabpanel\" data-tabpanel=\"benchmark\" hidden></div>\n        <div class=\"tds-tabpanel\" data-tabpanel=\"optimize\" hidden></div>\n        <div class=\"tds-tabpanel\" data-tabpanel=\"settings\" hidden></div>\n        <div class=\"tds-tabpanel\" data-tabpanel=\"diagnostics\" hidden></div>\n      </div>\n      <div id=\"tds-footer\">\n        <span>Torn Company Management Suite v").concat(TDS_VERSION, "</span>\n        <span class=\"tds-footer-status\" id=\"tds-footer-status\">Last run: Never</span>\n      </div>\n    ");
        // Put the suite into Torn's Jobs content rather than attaching an overlay to body.
        mount.prepend(panel);
        state.panel = panel;
        applyTheme(panel, tdsGetValue(STORAGE_KEY_THEME, 'green'));
        panel.querySelector('[data-action="tab-settings"]').addEventListener('click', function () { return switchTab(panel, 'settings'); });
        panel.querySelector('[data-action="refresh"]').addEventListener('click', function () { return runFullDiagnostic(panel, { force: true }); });
        panel.querySelectorAll('.tds-tab').forEach(function (btn) {
            btn.addEventListener('click', function () {
                if (btn.classList.contains('tds-tab-locked'))
                    return;
                switchTab(panel, btn.dataset.tab);
            });
        });
        renderSettingsTab(panel);
        renderDiagnosticsTab(panel, null);
        renderOverviewTab(panel, null, null);
        renderFinanceTab(panel);
        renderStockTab(panel);
        renderTrainingTab(panel).catch(function (err) { return console.error('[TDS] Training render failed:', err); });
        renderBenchmarkTab(panel);
        renderOptimizeTab(panel);
        switchTab(panel, 'overview');
        return panel;
    }
    function switchTab(panel, tabName) {
        panel.querySelectorAll('.tds-tab').forEach(function (b) { return b.classList.toggle('tds-tab-active', b.dataset.tab === tabName); });
        panel.querySelectorAll('.tds-tabpanel').forEach(function (p) {
            p.hidden = p.dataset.tabpanel !== tabName;
        });
        // Sales history can require an extra company/news API request. Load it only
        // when the Stock tab is actually opened, not on every Torn page refresh.
        if (tabName === 'stock')
            renderStockTab(panel).catch(function (err) { return console.error('[TDS] Stock tab failed:', err); });
    }
    function renderSettingsTab(panel) {
        var _this = this;
        var el = panel.querySelector('[data-tabpanel="settings"]');
        var currentTheme = tdsGetValue(STORAGE_KEY_THEME, 'green');
        el.innerHTML = "\n      <div class=\"tds-section-label\">API Key</div>\n      <div class=\"tds-box tds-box-neutral\">Stored only in this browser (Tampermonkey local storage). Never sent anywhere except api.torn.com.</div>\n      <div class=\"tds-box tds-box-warn\">\n        <strong>What actually gates each selection</strong> (confirmed by testing a real key at both Limited\n        and Full Access, not assumed):\n        <ul style=\"margin:6px 0 0 18px; padding:0;\">\n          <li><code>company: detailed, stock, applications</code> \u2014 gated by <strong>being the company\n            director</strong>, not by key tier. These returned BLOCKED (Torn error 7, \"Incorrect ID-entity\n            relation\") even with a Full Access key belonging to a non-director. No key upgrade fixes this;\n            only the director's own key gets real data here.</li>\n          <li><code>user: log</code> (training history) \u2014 <strong>is</strong> tier-gated: BLOCKED at Limited\n            (error 16, \"access level not high enough\"), ACCESSIBLE at Full.</li>\n          <li><code>company: profile, employees</code> and <code>user: basic, workstats</code> \u2014 worked at\n            Limited already.</li>\n        </ul>\n      </div>\n      <div class=\"tds-box tds-box-neutral\">\n        Company financials/stock/applications only return real data if you're the company's director.\n      </div>\n      <div class=\"tds-box tds-box-neutral\">\n        <strong>Create the API key for this program.</strong><br>\n        This opens Torn's official custom-key generator with the permissions used by\n        <strong>Torn Company Management Suite</strong> already selected:\n        <strong>Company: Profile, Employees, Detailed, Stock, News, Applications, Companies, Search, Snapshot</strong>;\n        <strong>User: Basic, Workstats, Log</strong>;\n        <strong>Torn: Companies</strong>.<br><br>\n        Torn will handle the actual key creation. Review the selections on Torn's page,\n        generate the key, then paste the new key into the box below. Custom keys should be\n        treated as sensitive credentials.\n      </div>\n      <button class=\"tds-btn\" id=\"tds-create-api-key\">Create Custom API Key \u2197</button>\n      <div style=\"position:relative; margin-top:8px;\">\n        <input class=\"tds-input\" id=\"tds-keyinput\" type=\"password\" autocomplete=\"off\" spellcheck=\"false\" placeholder=\"Paste API key here\" style=\"padding-right:76px; width:100%; box-sizing:border-box;\" />\n        <button type=\"button\" class=\"tds-btn-ghost\" id=\"tds-togglekey\" style=\"position:absolute; right:6px; top:50%; transform:translateY(-50%); padding:4px 8px; font-size:11px;\">Show</button>\n      </div>\n      <div style=\"margin-top:8px; display:flex; gap:8px;\">\n        <button class=\"tds-btn\" id=\"tds-savekey\">Save key</button>\n      </div>\n      <div class=\"tds-box tds-box-neutral\" style=\"margin-top:10px;\">\n        Once an API key is saved, the system can run automatically on startup. No UI action is required.\n      </div>\n\n      <div class=\"tds-section-label\">Diagnostics</div>\n      <div class=\"tds-box tds-box-neutral\">\n        Diagnostics are automatically run once and remembered across Torn page changes and browser refreshes.\n        Run them again manually whenever you want to refresh the capability check. The Diagnostics tab itself\n        is always available \u2014 nothing about it is gated.\n      </div>\n      <button class=\"tds-btn-ghost\" id=\"tds-rerun-diagnostics\">Run Diagnostics Again</button>\n\n      <div class=\"tds-section-label\">License</div>\n      <div class=\"tds-card\">\n        <div class=\"tds-row\"><span class=\"tds-row-label\">Torn User ID</span><span class=\"tds-row-value\" id=\"tds-license-userid\">\u2014</span></div>\n        <div class=\"tds-row\"><span class=\"tds-row-label\">Status</span><span class=\"tds-row-value\" id=\"tds-license-status-value\">\u2014</span></div>\n        <div class=\"tds-row\"><span class=\"tds-row-label\">Last checked</span><span class=\"tds-row-value\" id=\"tds-license-checked\">\u2014</span></div>\n        <div class=\"tds-row\" id=\"tds-license-reason-row\" style=\"display:none;\"><span class=\"tds-row-label\">Detail</span><span class=\"tds-row-value tds-v-dim\" id=\"tds-license-reason\" style=\"font-weight:400;\"></span></div>\n        <div style=\"margin-top:8px;\">\n          <button class=\"tds-btn-ghost\" id=\"tds-recheck-license\">Recheck license</button>\n        </div>\n      </div>\n      <div class=\"tds-box tds-box-neutral\">\n        Checked against a public list keyed by your Torn User ID, refreshed at most every\n        ".concat(LICENSE_CACHE_TTL_MS / 3600000, "h (cached locally in between). Only your numeric User ID is sent for\n        this check \u2014 no API key, no company data, nothing else about you.\n      </div>\n\n      <div class=\"tds-section-label\">Color Theme</div>\n      <div class=\"tds-card\">\n        <div class=\"tds-card-title\">Accent color (affects highlights, tabs, buttons \u2014 not the red/green/amber meaning colors)</div>\n        <div class=\"tds-swatches\" id=\"tds-swatches\"></div>\n      </div>\n    ");
        var keyInput = el.querySelector('#tds-keyinput');
        var toggleKey = el.querySelector('#tds-togglekey');
        keyInput.value = tdsGetValue(STORAGE_KEY_APIKEY, '');
        // Keep the API key masked by default. It can be temporarily revealed
        // with the Show button when the user needs to verify or edit it.
        toggleKey.addEventListener('click', function () {
            var visible = keyInput.type === 'text';
            keyInput.type = visible ? 'password' : 'text';
            toggleKey.textContent = visible ? 'Show' : 'Hide';
        });
        // Open Torn's official custom-key creation flow with this suite's
        // required selections and title pre-filled. Torn performs the actual
        // key generation; this script never sees the generated key until the
        // user deliberately pastes it into the input below.
        el.querySelector('#tds-create-api-key').addEventListener('click', function () {
            var url = buildCustomKeyUrl();
            window.open(url, '_blank', 'noopener');
        });
        el.querySelector('#tds-savekey').addEventListener('click', function () { return __awaiter(_this, void 0, void 0, function () {
            var key, err_2;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        key = keyInput.value.trim();
                        tdsSetValue(STORAGE_KEY_APIKEY, key);
                        keyInput.style.borderColor = 'var(--tds-accent)';
                        setTimeout(function () { return (keyInput.style.borderColor = ''); }, 600);
                        if (!(key && !state.diagnosticRunning)) return [3 /*break*/, 4];
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, runFullDiagnostic(panel, { force: true })];
                    case 2:
                        _a.sent();
                        return [3 /*break*/, 4];
                    case 3:
                        err_2 = _a.sent();
                        console.error('[TDS] Run after API key save failed:', err_2);
                        return [3 /*break*/, 4];
                    case 4: return [2 /*return*/];
                }
            });
        }); });
        var rerunButton = el.querySelector('#tds-rerun-diagnostics');
        rerunButton.addEventListener('click', function () { return __awaiter(_this, void 0, void 0, function () {
            var err_3;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (state.diagnosticRunning)
                            return [2 /*return*/];
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, runFullDiagnostic(panel, { force: true })];
                    case 2:
                        _a.sent();
                        return [3 /*break*/, 4];
                    case 3:
                        err_3 = _a.sent();
                        console.error('[TDS] Manual diagnostic run failed:', err_3);
                        return [3 /*break*/, 4];
                    case 4: return [2 /*return*/];
                }
            });
        }); });
        el.querySelector('#tds-recheck-license').addEventListener('click', function () {
            checkLicense(panel, { force: true }).catch(function (err) { return console.error('[TDS] License recheck failed:', err); });
        });
        renderLicenseStatusInSettings(panel);
        var swatchWrap = el.querySelector('#tds-swatches');
        Object.entries(THEME_PRESETS).forEach(function (_a) {
            var _b = __read(_a, 2), name = _b[0], theme = _b[1];
            var sw = document.createElement('div');
            sw.className = 'tds-swatch' + (name === currentTheme ? ' tds-swatch-active' : '');
            sw.style.background = theme.accent;
            sw.title = name;
            sw.addEventListener('click', function () {
                tdsSetValue(STORAGE_KEY_THEME, name);
                applyTheme(panel, name);
                swatchWrap.querySelectorAll('.tds-swatch').forEach(function (s) { return s.classList.remove('tds-swatch-active'); });
                sw.classList.add('tds-swatch-active');
            });
            swatchWrap.appendChild(sw);
        });
    }
    function renderDiagnosticsTab(panel, results) {
        var e_6, _a;
        var _b;
        var el = panel.querySelector('[data-tabpanel="diagnostics"]');
        if (!results) {
            el.innerHTML = "<div class=\"tds-box tds-box-neutral\">Diagnostics run automatically on first use and can be rerun from Settings or the refresh button in the header. This shows exactly what your current key can access \u2014 every row reflects a real response from api.torn.com.</div>";
            return;
        }
        var html = '<div class="tds-section-label">Capability check</div>';
        try {
            for (var results_2 = __values(results), results_2_1 = results_2.next(); !results_2_1.done; results_2_1 = results_2.next()) {
                var r = results_2_1.value;
                if (r.status === 'ok') {
                    html += "\n          <div class=\"tds-diag-row\">\n            <div>\n              <div class=\"tds-diag-label\">".concat(r.label, "</div>\n              <div class=\"tds-diag-reason\">Fields: ").concat(r.sampleKeys.join(', '), "</div>\n            </div>\n            <span class=\"tds-badge tds-badge-ok\">ACCESSIBLE</span>\n          </div>");
                }
                else {
                    html += "\n          <div class=\"tds-diag-row\">\n            <div>\n              <div class=\"tds-diag-label\">".concat(r.label, "</div>\n              <div class=\"tds-diag-reason\">Torn error ").concat((_b = r.code) !== null && _b !== void 0 ? _b : '', ": ").concat(r.reason, "</div>\n            </div>\n            <span class=\"tds-badge tds-badge-blocked\">BLOCKED</span>\n          </div>");
                }
            }
        }
        catch (e_6_1) { e_6 = { error: e_6_1 }; }
        finally {
            try {
                if (results_2_1 && !results_2_1.done && (_a = results_2.return)) _a.call(results_2);
            }
            finally { if (e_6) throw e_6.error; }
        }
        el.innerHTML = html;
    }
    function renderOverviewTab(panel, results, verdict) {
        var e_7, _a, e_8, _b, e_9, _c;
        var _d, _e, _f;
        var el = panel.querySelector('[data-tabpanel="overview"]');
        if (!results || !verdict) {
            el.innerHTML = "<div class=\"tds-box tds-box-neutral\">No data yet. Add your API key in Settings, then run Diagnostics.</div>";
            return;
        }
        var html = '';
        var boxClass = verdict.level === 'director' ? 'tds-box-info' : verdict.level === 'unknown' ? 'tds-box-danger' : 'tds-box-warn';
        html += "<div class=\"tds-box ".concat(boxClass, "\"><strong>").concat(escapeHtml(verdict.headline), "</strong><br>").concat(escapeHtml(verdict.detail), "</div>");
        var profile = findRaw(results, 'company', 'profile');
        var detailed = findRaw(results, 'company', 'detailed');
        var employeesRaw = findRaw(results, 'company', 'employees');
        var employees = extractEmployeesEntries(employeesRaw);
        // Show every usable scalar value returned by company/profile, rather than
        // maintaining a small hard-coded list. This means new fields Torn adds to
        // the profile automatically appear here too. Employee objects/collections
        // are excluded because the Employees section below renders them properly.
        if (profile) {
            var profileRows = collectDisplayFields(profile, {
                skipObjectKeys: ['employees', 'employee', 'positions']
            });
            var capacity_1 = numericValue(findValueDeep(profile, [
                'employees_capacity', 'employee_capacity', 'max_employees',
                'maximum_employees', 'capacity'
            ]));
            var employeeCount_1 = employees.length || numericValue(findValueDeep(profile, [
                'employees_hired', 'employee_count', 'employees_count', 'num_employees'
            ]));
            html += '<div class="tds-section-label">Company</div><div class="tds-card">';
            // Put the most useful/common company fields first, then append every
            // other scalar field returned by Torn that has not already been shown.
            var preferred = [
                ['name', 'Name'], ['company_name', 'Name'], ['type', 'Type'], ['company_type', 'Type'],
                ['director', 'Director'], ['days_old', 'Company Age'], ['age', 'Company Age'],
                ['popularity', 'Popularity'], ['efficiency', 'Efficiency'], ['environment', 'Environment'],
                ['rating', 'Rating'], ['trains_available', 'Trains Available'], ['trains', 'Trains'],
                ['daily_income', 'Daily Income'], ['daily_customers', 'Daily Customers'],
                ['weekly_income', 'Weekly Income'], ['weekly_customers', 'Weekly Customers'],
                ['company_bank', 'Company Bank']
            ];
            var shown = new Set();
            var shownFieldNames = new Set();
            // Torn can expose these three health values at different nesting levels
            // depending on the API response shape. Pull them explicitly from the
            // full profile (and detailed data when available) rather than relying on
            // them being top-level scalar fields.
            var healthMetrics = {
                Popularity: (_d = findValueDeep(profile, ['popularity', 'company_popularity'])) !== null && _d !== void 0 ? _d : findValueDeep(detailed, ['popularity', 'company_popularity']),
                Efficiency: (_e = findValueDeep(profile, ['efficiency', 'company_efficiency'])) !== null && _e !== void 0 ? _e : findValueDeep(detailed, ['efficiency', 'company_efficiency']),
                Environment: (_f = findValueDeep(profile, ['environment', 'company_environment'])) !== null && _f !== void 0 ? _f : findValueDeep(detailed, ['environment', 'company_environment'])
            };
            var _loop_1 = function (key, label) {
                var row = profileRows.find(function (r) { return normalizeFieldName(r.key) === normalizeFieldName(key); });
                var explicitHealthValue = Object.prototype.hasOwnProperty.call(healthMetrics, label)
                    ? healthMetrics[label]
                    : null;
                if ((!row && explicitHealthValue === null) || (row && shown.has(row.path)))
                    return "continue";
                var formatter = formatCompanyValue;
                var value = row ? row.value : explicitHealthValue;
                if (label === 'Director') {
                    formatter = function (value) { return formatDirectorName(value, employees, results); };
                }
                else if (label === 'Type') {
                    formatter = function (value) { return formatCompanyType(value, results); };
                }
                else if (label === 'Company Age') {
                    formatter = formatCompanyAge;
                }
                else if (label === 'Daily Income' || label === 'Weekly Income') {
                    formatter = formatCurrency;
                }
                else if (label === 'Popularity' || label === 'Efficiency' || label === 'Environment') {
                    formatter = formatPercent;
                }
                html += companyOverviewRow(label, value, formatter);
                if (row)
                    shown.add(row.path);
                shownFieldNames.add(normalizeFieldName(key));
            };
            try {
                for (var preferred_1 = __values(preferred), preferred_1_1 = preferred_1.next(); !preferred_1_1.done; preferred_1_1 = preferred_1.next()) {
                    var _g = __read(preferred_1_1.value, 2), key = _g[0], label = _g[1];
                    _loop_1(key, label);
                }
            }
            catch (e_7_1) { e_7 = { error: e_7_1 }; }
            finally {
                try {
                    if (preferred_1_1 && !preferred_1_1.done && (_a = preferred_1.return)) _a.call(preferred_1);
                }
                finally { if (e_7) throw e_7.error; }
            }
            // Always show roster size in the familiar current / capacity form when
            // either side is known, even if Torn exposes those values under different
            // field names.
            if (employeeCount_1 !== null || capacity_1 !== null) {
                html += companyOverviewRow('Employees', employeeCount_1, function () {
                    if (employeeCount_1 !== null && capacity_1 !== null)
                        return "".concat(formatNumber(employeeCount_1), " / ").concat(formatNumber(capacity_1));
                    if (employeeCount_1 !== null)
                        return formatNumber(employeeCount_1);
                    return "\u2014 / ".concat(formatNumber(capacity_1));
                });
            }
            try {
                for (var profileRows_1 = __values(profileRows), profileRows_1_1 = profileRows_1.next(); !profileRows_1_1.done; profileRows_1_1 = profileRows_1.next()) {
                    var row = profileRows_1_1.value;
                    if (shown.has(row.path))
                        continue;
                    var nk = normalizeFieldName(row.key);
                    if (shownFieldNames.has(nk))
                        continue;
                    // These are already represented by the combined Employees row.
                    if (/^(employeeshired|employeecount|employeescount|numemployees|employeescapacity|employeecapacity|maxemployees|maximumemployees|capacity)$/.test(nk))
                        continue;
                    var formatter = formatCompanyValue;
                    if (/^(dailyincome|weeklyincome)$/.test(nk))
                        formatter = formatCurrency;
                    if (/^(daysold|age)$/.test(nk))
                        formatter = formatCompanyAge;
                    html += companyOverviewRow(row.label, row.value, formatter);
                    shown.add(row.path);
                }
            }
            catch (e_8_1) { e_8 = { error: e_8_1 }; }
            finally {
                try {
                    if (profileRows_1_1 && !profileRows_1_1.done && (_b = profileRows_1.return)) _b.call(profileRows_1);
                }
                finally { if (e_8) throw e_8.error; }
            }
            html += '</div>';
        }
        // company/detailed is director-only. If the key can access it, include all
        // scalar fields here as part of Overview as requested. If Torn blocks it,
        // the existing access notice at the top already explains why.
        if (detailed) {
            var detailedRows = collectDisplayFields(detailed, {
                skipObjectKeys: ['employees', 'employee', 'positions']
            });
            if (detailedRows.length) {
                html += '<div class="tds-section-label">Company Details</div><div class="tds-card">';
                try {
                    for (var detailedRows_1 = __values(detailedRows), detailedRows_1_1 = detailedRows_1.next(); !detailedRows_1_1.done; detailedRows_1_1 = detailedRows_1.next()) {
                        var row = detailedRows_1_1.value;
                        var nk = normalizeFieldName(row.key);
                        var formatter = /^(dailyincome|weeklyincome)$/.test(nk) ? formatCurrency : formatCompanyValue;
                        html += companyOverviewRow(row.label, row.value, formatter);
                    }
                }
                catch (e_9_1) { e_9 = { error: e_9_1 }; }
                finally {
                    try {
                        if (detailedRows_1_1 && !detailedRows_1_1.done && (_c = detailedRows_1.return)) _c.call(detailedRows_1);
                    }
                    finally { if (e_9) throw e_9.error; }
                }
                html += '</div>';
            }
        }
        html += '<div class="tds-section-label">Employees</div>';
        if (employees.length > 0) {
            html += '<div class="tds-card">';
            employees.slice(0, 15).forEach(function (employee) {
                var emp = employee.raw;
                var effectiveness = emp.effectiveness && typeof emp.effectiveness === 'object'
                    ? emp.effectiveness
                    : null;
                var lastAction = emp.last_action && typeof emp.last_action === 'object'
                    ? emp.last_action
                    : null;
                var status = emp.status && typeof emp.status === 'object'
                    ? emp.status
                    : null;
                // Torn exposes two different concepts here:
                //   last_action.status -> Online / Idle / Offline presence
                //   status.state       -> player state such as Okay / Hospital / Traveling
                //   status.description -> human-readable detail for that state
                var onlineStatus = (lastAction === null || lastAction === void 0 ? void 0 : lastAction.status) || '—';
                var playerState = (status === null || status === void 0 ? void 0 : status.state) || '—';
                var stateDetail = (status === null || status === void 0 ? void 0 : status.description) || '—';
                html += "\n          <details class=\"tds-employee-row\">\n            <summary class=\"tds-employee-summary\">\n              <div class=\"tds-employee-top\">\n                <div>\n                  <div class=\"tds-employee-name\">".concat(escapeHtml(String(employee.name)), "</div>\n                  <div class=\"tds-employee-meta\">").concat(escapeHtml(String(employee.position || 'Employee')), "</div>\n                </div>\n                <div style=\"display:flex; align-items:center; gap:8px;\">\n                  <span class=\"tds-badge tds-badge-neutral\">").concat(escapeHtml(String(onlineStatus)), "</span>\n                  <span class=\"tds-employee-chevron\">\u25B8</span>\n                </div>\n              </div>\n            </summary>\n\n            <div class=\"tds-card\" style=\"margin:8px 0 0;\">\n              <div class=\"tds-row\"><span class=\"tds-row-label\">Days employed</span><span class=\"tds-row-value\">").concat(formatNumber(emp.days_in_company), "</span></div>\n              <div class=\"tds-section-label tds-employee-subheading\" style=\"margin-top:10px;\">Working Stats</div>\n              <div class=\"tds-row\"><span class=\"tds-row-label\">Manual Labor</span><span class=\"tds-row-value\">").concat(formatNumber(emp.manual_labor), "</span></div>\n              <div class=\"tds-row\"><span class=\"tds-row-label\">Intelligence</span><span class=\"tds-row-value\">").concat(formatNumber(emp.intelligence), "</span></div>\n              <div class=\"tds-row\"><span class=\"tds-row-label\">Endurance</span><span class=\"tds-row-value\">").concat(formatNumber(emp.endurance), "</span></div>\n\n              ").concat(effectiveness ? "\n                <div class=\"tds-section-label tds-employee-subheading\" style=\"margin-top:10px;\">Effectiveness</div>\n                <div class=\"tds-row\"><span class=\"tds-row-label\">Working Stats</span><span class=\"tds-row-value\">".concat(formatNumber(effectiveness.working_stats), "</span></div>\n                <div class=\"tds-row\"><span class=\"tds-row-label\">Settled In</span><span class=\"tds-row-value\">").concat(formatNumber(effectiveness.settled_in), "</span></div>\n                <div class=\"tds-row\"><span class=\"tds-row-label\">Director Education</span><span class=\"tds-row-value\">").concat(formatNumber(effectiveness.director_education), "</span></div>\n                <div class=\"tds-row\"><span class=\"tds-row-label\">Addiction</span><span class=\"tds-row-value\">").concat(formatNumber(effectiveness.addiction), "</span></div>\n                <div class=\"tds-row\"><span class=\"tds-row-label\">Total</span><span class=\"tds-row-value\">").concat(formatNumber(effectiveness.total), "</span></div>\n              ") : '', "\n\n              ").concat(status || lastAction ? "\n                <div class=\"tds-section-label tds-employee-subheading\" style=\"margin-top:10px;\">Status</div>\n                <div class=\"tds-row\"><span class=\"tds-row-label\">Online Status</span><span class=\"tds-row-value\">".concat(escapeHtml(String(onlineStatus)), "</span></div>\n                <div class=\"tds-row\"><span class=\"tds-row-label\">State</span><span class=\"tds-row-value\">").concat(escapeHtml(String(playerState)), "</span></div>\n                <div class=\"tds-row\"><span class=\"tds-row-label\">Detail</span><span class=\"tds-row-value\">").concat(escapeHtml(String(stateDetail)), "</span></div>\n                <div class=\"tds-row\"><span class=\"tds-row-label\">Last action</span><span class=\"tds-row-value\">").concat(escapeHtml(String((lastAction === null || lastAction === void 0 ? void 0 : lastAction.relative) || formatTimestampRelative(lastAction === null || lastAction === void 0 ? void 0 : lastAction.timestamp))), "</span></div>\n              ") : '', "\n            </div>\n          </details>");
            });
            if (employees.length > 15) {
                html += "<div class=\"tds-box tds-box-neutral\" style=\"margin-top:10px;\">Showing the first 15 employees of ".concat(employees.length, " returned by the API.</div>");
            }
            html += '</div>';
        }
        else {
            html += "<div class=\"tds-box tds-box-neutral\">No employee records could be mapped from the company/employees response. Diagnostics shows the actual response fields so the parser can be extended without displaying raw JSON.</div>";
        }
        el.innerHTML = html;
    }
    function escapeHtml(str) {
        return str.replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]); });
    }
    // ---------------------------------------------------------------------
    // 5c. LICENSE CHECK -- Torn User ID against a public GitHub-hosted list.
    //     Fully separate from the Torn API: uses raw.githubusercontent.com,
    //     sends only the numeric User ID (already public within Torn itself),
    //     and never touches the API key or any company data.
    // ---------------------------------------------------------------------
    var LICENSE_GATED_TABS = ['overview', 'finance', 'stock', 'training', 'benchmark', 'optimize'];
    function findOwnUserId(results) {
        var basic = findRaw(results, 'user', 'basic');
        if (!basic)
            return null;
        var key = Object.keys(basic).find(function (k) {
            return /^(player_id|user_id|id)$/i.test(k) && (typeof basic[k] === 'number' || typeof basic[k] === 'string');
        });
        if (!key)
            return null;
        var n = Number(basic[key]);
        return Number.isFinite(n) ? n : null;
    }
    function fetchLicenseList() {
        return new Promise(function (resolve, reject) {
            GM_xmlhttpRequest({
                method: 'GET',
                url: LICENSE_JSON_URL,
                timeout: 15000,
                onload: function (res) {
                    var parsed;
                    try {
                        parsed = JSON.parse(res.responseText);
                    }
                    catch (e) {
                        reject({
                            reason: "licensed-users.json is not valid JSON yet. Expected an array like "
                                + "[{\"userId\":4237873,\"status\":\"active\"}]. Current content starts with: "
                                + "\"".concat(String(res.responseText).slice(0, 80), "\""),
                        });
                        return;
                    }
                    var list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed === null || parsed === void 0 ? void 0 : parsed.users) ? parsed.users : null);
                    if (!list) {
                        reject({ reason: 'licensed-users.json parsed as JSON but isn\u2019t an array of {userId, status} entries yet.' });
                        return;
                    }
                    resolve(list);
                },
                onerror: function () { return reject({ reason: 'Network error contacting raw.githubusercontent.com' }); },
                ontimeout: function () { return reject({ reason: 'Timed out contacting raw.githubusercontent.com' }); },
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
    function checkLicense(panel_1) {
        return __awaiter(this, arguments, void 0, function (panel, _a) {
            var results, userId, cached, list, entry, rawStatus, status, err_4;
            var _b, _c, _d, _e, _f;
            var _g = _a === void 0 ? {} : _a, _h = _g.force, force = _h === void 0 ? false : _h;
            return __generator(this, function (_j) {
                switch (_j.label) {
                    case 0:
                        results = state.lastResults;
                        userId = results ? findOwnUserId(results) : null;
                        if (!userId) {
                            state.license = {
                                status: 'unknown',
                                reason: 'Torn User ID not available yet \u2014 run Diagnostics with an API key first (needs user/basic).',
                                checkedAt: Date.now(),
                                userId: null,
                            };
                            applyLicenseGate(panel);
                            return [2 /*return*/];
                        }
                        cached = tdsGetValue(STORAGE_KEY_LICENSE_CACHE, null);
                        if (!force && cached && cached.userId === userId && (Date.now() - cached.checkedAt) < LICENSE_CACHE_TTL_MS) {
                            state.license = cached;
                            applyLicenseGate(panel);
                            return [2 /*return*/];
                        }
                        _j.label = 1;
                    case 1:
                        _j.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, fetchLicenseList()];
                    case 2:
                        list = _j.sent();
                        entry = list.find(function (row) { var _a, _b; return Number((_b = (_a = row.userId) !== null && _a !== void 0 ? _a : row.user_id) !== null && _b !== void 0 ? _b : row.id) === userId; });
                        rawStatus = String((_d = (_c = (_b = entry === null || entry === void 0 ? void 0 : entry.status) !== null && _b !== void 0 ? _b : entry === null || entry === void 0 ? void 0 : entry.flag) !== null && _c !== void 0 ? _c : entry === null || entry === void 0 ? void 0 : entry.state) !== null && _d !== void 0 ? _d : '').toLowerCase();
                        status = !entry ? 'unlicensed'
                            : rawStatus === 'active' ? 'active'
                                : rawStatus === 'expired' ? 'expired'
                                    : 'unknown';
                        state.license = { status: status, checkedAt: Date.now(), userId: userId, source: 'github' };
                        if (status === 'unknown' && entry) {
                            state.license.reason = "Entry found but status field (\"".concat((_f = (_e = entry.status) !== null && _e !== void 0 ? _e : entry.flag) !== null && _f !== void 0 ? _f : entry.state, "\") wasn\u2019t \"active\" or \"expired\".");
                        }
                        return [3 /*break*/, 4];
                    case 3:
                        err_4 = _j.sent();
                        state.license = {
                            status: 'unknown',
                            reason: err_4.reason || 'License check failed.',
                            checkedAt: Date.now(),
                            userId: userId,
                            source: 'github-error',
                        };
                        return [3 /*break*/, 4];
                    case 4:
                        tdsSetValue(STORAGE_KEY_LICENSE_CACHE, state.license);
                        applyLicenseGate(panel);
                        return [2 /*return*/];
                }
            });
        });
    }
    function renderLicenseStatusInSettings(panel) {
        var _a;
        var el = panel.querySelector('[data-tabpanel="settings"]');
        if (!el)
            return;
        var idEl = el.querySelector('#tds-license-userid');
        var statusEl = el.querySelector('#tds-license-status-value');
        var checkedEl = el.querySelector('#tds-license-checked');
        var reasonRow = el.querySelector('#tds-license-reason-row');
        var reasonEl = el.querySelector('#tds-license-reason');
        if (!idEl || !statusEl || !checkedEl)
            return;
        var license = state.license;
        if (!license) {
            idEl.textContent = '\u2014';
            statusEl.textContent = 'Not checked yet';
            statusEl.className = 'tds-row-value tds-v-dim';
            checkedEl.textContent = '\u2014';
            if (reasonRow)
                reasonRow.style.display = 'none';
            return;
        }
        idEl.textContent = (_a = license.userId) !== null && _a !== void 0 ? _a : '\u2014';
        var meta = licenseStatusMeta(license.status);
        statusEl.textContent = meta.label;
        statusEl.className = "tds-row-value ".concat(meta.cls);
        checkedEl.textContent = license.checkedAt ? formatTimestampRelative(license.checkedAt) : '\u2014';
        if (license.reason && reasonRow && reasonEl) {
            reasonRow.style.display = '';
            reasonEl.textContent = license.reason;
        }
        else if (reasonRow) {
            reasonRow.style.display = 'none';
        }
    }
    function applyLicenseGate(panel) {
        var license = state.license || { status: 'unknown' };
        var active = license.status === 'active';
        LICENSE_GATED_TABS.forEach(function (tab) {
            var btn = panel.querySelector(".tds-tab[data-tab=\"".concat(tab, "\"]"));
            if (!btn)
                return;
            btn.classList.toggle('tds-tab-locked', !active);
            if (!active)
                btn.title = 'Requires an active license \u2014 see Settings';
            else
                btn.removeAttribute('title');
        });
        if (!active) {
            var meta = licenseStatusMeta(license.status);
            var msg_1 = "\n        <div class=\"tds-box tds-box-warn\">\n          <strong>License required.</strong> Status: <span class=\"".concat(meta.cls, "\">").concat(meta.label, "</span>").concat(license.reason ? " \u2014 ".concat(escapeHtml(license.reason)) : '', ".\n          Go to Settings for details.\n        </div>");
            LICENSE_GATED_TABS.forEach(function (tab) {
                var panelEl = panel.querySelector("[data-tabpanel=\"".concat(tab, "\"]"));
                if (panelEl)
                    panelEl.innerHTML = msg_1;
            });
            var activeTabBtn = panel.querySelector('.tds-tab-active');
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
        var r = results === null || results === void 0 ? void 0 : results.find(function (x) { return x.section === section && x.selections === selections && x.status === 'ok'; });
        return r ? r.raw : null;
    }
    function findBlockedReason(results, section, selections) {
        var _a;
        var r = results === null || results === void 0 ? void 0 : results.find(function (x) { return x.section === section && x.selections === selections; });
        if (!r || r.status !== 'blocked')
            return null;
        return "Torn error ".concat((_a = r.code) !== null && _a !== void 0 ? _a : '', ": ").concat(r.reason).trim();
    }
    // Normalizes the employee payload into a consistent [{ id, raw, name, position }]
    // shape. Torn responses can arrive as an object keyed by employee ID, an
    // array of [id, employee] pairs, an array of employee objects, or a wrapper
    // object containing an employees collection. Never stringify the payload
    // into the UI as the fallback.
    function extractEmployeesEntries(companyEmployeesRaw) {
        var _a;
        if (!companyEmployeesRaw)
            return [];
        var list = companyEmployeesRaw;
        if (!Array.isArray(list) && typeof list === 'object') {
            var employeesKey = Object.keys(list).find(function (k) { return /employees?/i.test(k); });
            if (employeesKey && list[employeesKey] && typeof list[employeesKey] === 'object') {
                list = list[employeesKey];
            }
        }
        var entries = [];
        if (Array.isArray(list)) {
            // A single Object.entries-style pair: ["3951439", { ...employee... }]
            if (list.length === 2 && (typeof list[0] === 'string' || typeof list[0] === 'number') &&
                list[1] && typeof list[1] === 'object' && !Array.isArray(list[1])) {
                entries = [[list[0], list[1]]];
            }
            else {
                entries = list.map(function (value, index) {
                    var _a;
                    if (Array.isArray(value) && value.length >= 2 && value[1] && typeof value[1] === 'object') {
                        return [value[0], value[1]];
                    }
                    return [(_a = value === null || value === void 0 ? void 0 : value.id) !== null && _a !== void 0 ? _a : index, value];
                });
            }
        }
        else if (typeof list === 'object') {
            // A single employee object: treat it as one entry only if it looks like
            // an employee rather than a wrapper/container.
            var looksLikeEmployee = ['name', 'position', 'days_in_company', 'manual_labor',
                'intelligence', 'endurance', 'effectiveness', 'last_action', 'status']
                .some(function (key) { return Object.prototype.hasOwnProperty.call(list, key); });
            entries = looksLikeEmployee
                ? [[(_a = list.id) !== null && _a !== void 0 ? _a : 'employee', list]]
                : Object.entries(list);
        }
        return entries
            .filter(function (_a) {
            var _b = __read(_a, 2), emp = _b[1];
            return emp && typeof emp === 'object' && !Array.isArray(emp);
        })
            .map(function (_a) {
            var _b, _c;
            var _d = __read(_a, 2), id = _d[0], emp = _d[1];
            return ({
                id: id,
                raw: emp,
                name: (_b = emp.name) !== null && _b !== void 0 ? _b : "#".concat(id),
                position: (_c = emp.position) !== null && _c !== void 0 ? _c : ''
            });
        });
    }
    function normalizeFieldName(name) {
        return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    }
    function findValueDeep(obj, preferredNames) {
        if (!obj || typeof obj !== 'object')
            return null;
        var wanted = new Set(preferredNames.map(normalizeFieldName));
        var seen = new WeakSet();
        var found = null;
        function walk(value) {
            var e_10, _a, e_11, _b;
            if (found !== null || !value || typeof value !== 'object' || seen.has(value))
                return;
            seen.add(value);
            try {
                for (var _c = __values(Object.entries(value)), _d = _c.next(); !_d.done; _d = _c.next()) {
                    var _e = __read(_d.value, 2), key = _e[0], child = _e[1];
                    if (wanted.has(normalizeFieldName(key)) && child !== undefined && child !== null && typeof child !== 'object') {
                        found = child;
                        return;
                    }
                }
            }
            catch (e_10_1) { e_10 = { error: e_10_1 }; }
            finally {
                try {
                    if (_d && !_d.done && (_a = _c.return)) _a.call(_c);
                }
                finally { if (e_10) throw e_10.error; }
            }
            try {
                for (var _f = __values(Object.values(value)), _g = _f.next(); !_g.done; _g = _f.next()) {
                    var child = _g.value;
                    if (child && typeof child === 'object')
                        walk(child);
                    if (found !== null)
                        return;
                }
            }
            catch (e_11_1) { e_11 = { error: e_11_1 }; }
            finally {
                try {
                    if (_g && !_g.done && (_b = _f.return)) _b.call(_f);
                }
                finally { if (e_11) throw e_11.error; }
            }
        }
        walk(obj);
        return found;
    }
    function numericValue(value) {
        if (typeof value === 'number' && Number.isFinite(value))
            return value;
        if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))
            return Number(value);
        return null;
    }
    function displayValue(value) {
        if (value === undefined || value === null || value === '')
            return '—';
        if (typeof value === 'number')
            return formatNumber(value);
        return String(value);
    }
    function companyOverviewRow(label, value, formatter) {
        if (formatter === void 0) { formatter = displayValue; }
        return "<div class=\"tds-row\"><span class=\"tds-row-label\">".concat(escapeHtml(label), "</span><span class=\"tds-row-value\">").concat(escapeHtml(formatter(value)), "</span></div>");
    }
    function humanizeFieldName(name) {
        return String(name || '')
            .replace(/[_-]+/g, ' ')
            .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
            .replace(/\b\w/g, function (c) { return c.toUpperCase(); });
    }
    function collectDisplayFields(raw, options) {
        if (options === void 0) { options = {}; }
        if (!raw || typeof raw !== 'object')
            return [];
        var skip = new Set((options.skipObjectKeys || []).map(normalizeFieldName));
        var rows = [];
        var seen = new WeakSet();
        function walk(value, pathParts, depth) {
            var e_12, _a;
            if (pathParts === void 0) { pathParts = []; }
            if (depth === void 0) { depth = 0; }
            if (!value || typeof value !== 'object' || seen.has(value) || depth > 5)
                return;
            seen.add(value);
            try {
                for (var _b = __values(Object.entries(value)), _c = _b.next(); !_c.done; _c = _b.next()) {
                    var _d = __read(_c.value, 2), key = _d[0], child = _d[1];
                    var nextPath = __spreadArray(__spreadArray([], __read(pathParts), false), [key], false);
                    var path = nextPath.join('.');
                    if (child && typeof child === 'object' && !Array.isArray(child)) {
                        if (skip.has(normalizeFieldName(key)))
                            continue;
                        walk(child, nextPath, depth + 1);
                        continue;
                    }
                    if (Array.isArray(child)) {
                        if (skip.has(normalizeFieldName(key)))
                            continue;
                        if (child.every(function (v) { return v === null || ['string', 'number', 'boolean'].includes(typeof v); })) {
                            rows.push({ key: key, path: path, label: humanizeFieldName(key), value: child.join(', ') });
                        }
                        continue;
                    }
                    if (child === undefined || child === null || child === '')
                        continue;
                    rows.push({ key: key, path: path, label: humanizeFieldName(key), value: child });
                }
            }
            catch (e_12_1) { e_12 = { error: e_12_1 }; }
            finally {
                try {
                    if (_c && !_c.done && (_a = _b.return)) _a.call(_b);
                }
                finally { if (e_12) throw e_12.error; }
            }
        }
        // Common Torn API wrapper objects should not make labels read like
        // "Company > Name"; recurse into them directly when they are the only
        // meaningful container.
        var keys = Object.keys(raw);
        var wrapperKey = keys.find(function (k) { return /^(company|profile|detailed|details)$/i.test(k) && raw[k] && typeof raw[k] === 'object' && !Array.isArray(raw[k]); });
        if (wrapperKey && keys.length <= 3)
            walk(raw[wrapperKey]);
        else
            walk(raw);
        return rows;
    }
    function formatCompanyValue(value) {
        if (value === undefined || value === null || value === '')
            return '—';
        if (typeof value === 'boolean')
            return value ? 'Yes' : 'No';
        if (typeof value === 'number')
            return formatNumber(value);
        return String(value);
    }
    function formatCurrency(value) {
        var n = numericValue(value);
        if (n === null)
            return formatCompanyValue(value);
        return "$".concat(formatNumber(n));
    }
    function formatPercent(value) {
        if (value === undefined || value === null || value === '')
            return '—';
        var text = String(value).trim();
        if (text.endsWith('%'))
            return text;
        var n = numericValue(value);
        return n === null ? formatCompanyValue(value) : "".concat(formatNumber(n), "%");
    }
    function formatCompanyAge(value) {
        var totalDays = numericValue(value);
        if (totalDays === null)
            return formatCompanyValue(value);
        var days = Math.max(0, Math.floor(totalDays));
        if (days < 365)
            return "".concat(formatNumber(days), " ").concat(days === 1 ? 'day' : 'days');
        // The API exposes company age as a day count, not a foundation date, so
        // month values here use 30-day company-age months after each 365-day year.
        var years = Math.floor(days / 365);
        var afterYears = days % 365;
        var months = Math.floor(afterYears / 30);
        var remainingDays = afterYears % 30;
        var parts = ["".concat(years, " ").concat(years === 1 ? 'year' : 'years')];
        if (months)
            parts.push("".concat(months, " ").concat(months === 1 ? 'month' : 'months'));
        if (remainingDays || !months)
            parts.push("".concat(remainingDays, " ").concat(remainingDays === 1 ? 'day' : 'days'));
        return parts.join(', ');
    }
    function formatDirectorName(value, employees, results) {
        if (value && typeof value === 'object') {
            var objectName = findValueDeep(value, ['name', 'player_name', 'username']);
            if (objectName)
                return String(objectName);
            var objectId = findValueDeep(value, ['id', 'player_id', 'user_id']);
            if (objectId !== null)
                value = objectId;
        }
        var directorId = String(value !== null && value !== void 0 ? value : '').trim();
        if (!directorId)
            return '—';
        var rosterMatch = (employees || []).find(function (employee) { return String(employee.id) === directorId; });
        if ((rosterMatch === null || rosterMatch === void 0 ? void 0 : rosterMatch.name) && !String(rosterMatch.name).startsWith('#'))
            return String(rosterMatch.name);
        var basic = findRaw(results, 'user', 'basic');
        var basicId = basic && findValueDeep(basic, ['player_id', 'user_id', 'id']);
        var basicName = basic && findValueDeep(basic, ['name', 'player_name', 'username']);
        if (basicId !== null && String(basicId) === directorId && basicName)
            return String(basicName);
        return String(value);
    }
    function formatCompanyType(value, results) {
        if (value && typeof value === 'object') {
            var name = findValueDeep(value, ['name', 'type_name', 'company_type_name']);
            var id = findValueDeep(value, ['id', 'type', 'type_id', 'company_type']);
            if (name && id !== null)
                return "".concat(name, " (").concat(id, ")");
            if (name)
                return String(name);
            if (id !== null)
                value = id;
        }
        var typeId = numericValue(value);
        if (typeId === null)
            return formatCompanyValue(value);
        var reference = findRaw(results, 'torn', 'companies');
        var typeName = resolveCompanyTypeName(reference, typeId);
        return typeName ? "".concat(typeName, " (").concat(typeId, ")") : String(typeId);
    }
    function resolveCompanyTypeName(raw, typeId) {
        if (!raw || typeof raw !== 'object')
            return null;
        var wanted = String(typeId);
        var seen = new WeakSet();
        var found = null;
        function walk(value) {
            var e_13, _a, e_14, _b;
            if (found || !value || typeof value !== 'object' || seen.has(value))
                return;
            seen.add(value);
            if (!Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, wanted)) {
                var candidate = value[wanted];
                if (candidate && typeof candidate === 'object') {
                    var name = findValueDeep(candidate, ['name', 'company_name', 'type_name']);
                    if (name) {
                        found = String(name);
                        return;
                    }
                }
                else if (typeof candidate === 'string') {
                    found = candidate;
                    return;
                }
            }
            try {
                for (var _c = __values(Object.values(value)), _d = _c.next(); !_d.done; _d = _c.next()) {
                    var child = _d.value;
                    if (!child || typeof child !== 'object')
                        continue;
                    var id = findValueDeep(child, ['id', 'type_id', 'company_type']);
                    if (id !== null && String(id) === wanted) {
                        var name = findValueDeep(child, ['name', 'company_name', 'type_name']);
                        if (name) {
                            found = String(name);
                            return;
                        }
                    }
                }
            }
            catch (e_13_1) { e_13 = { error: e_13_1 }; }
            finally {
                try {
                    if (_d && !_d.done && (_a = _c.return)) _a.call(_c);
                }
                finally { if (e_13) throw e_13.error; }
            }
            try {
                for (var _e = __values(Object.values(value)), _f = _e.next(); !_f.done; _f = _e.next()) {
                    var child = _f.value;
                    if (child && typeof child === 'object')
                        walk(child);
                    if (found)
                        return;
                }
            }
            catch (e_14_1) { e_14 = { error: e_14_1 }; }
            finally {
                try {
                    if (_f && !_f.done && (_b = _e.return)) _b.call(_e);
                }
                finally { if (e_14) throw e_14.error; }
            }
        }
        walk(raw);
        return found;
    }
    function findNestedObject(obj, keyPattern) {
        if (!obj || typeof obj !== 'object')
            return null;
        if (Object.keys(obj).some(function (k) { return keyPattern.test(k); }))
            return obj;
        return null;
    }
    function formatNumber(n) {
        if (typeof n !== 'number' || Number.isNaN(n))
            return '—';
        return n.toLocaleString('en-GB');
    }
    function formatTimestampRelative(ts) {
        if (!ts)
            return '—';
        var seconds = Math.max(0, Math.floor((Date.now() - Number(ts)) / 1000));
        if (seconds < 60)
            return "".concat(seconds, "s ago");
        var minutes = Math.floor(seconds / 60);
        if (minutes < 60)
            return "".concat(minutes, "m ago");
        var hours = Math.floor(minutes / 60);
        if (hours < 24)
            return "".concat(hours, "h ").concat(minutes % 60, "m ago");
        var days = Math.floor(hours / 24);
        return "".concat(days, "d ").concat(hours % 24, "h ago");
    }
    // Looks for a wage/salary-shaped numeric field on an employee object
    // without assuming its exact name — flags what it found so the UI can
    // label it EXACT (real field) rather than a guess.
    function findWageField(emp) {
        if (!emp || typeof emp !== 'object')
            return null;
        var key = Object.keys(emp).find(function (k) { return /wage|salary/i.test(k) && typeof emp[k] === 'number'; });
        return key ? { key: key, value: emp[key] } : null;
    }
    function getEmployeeEffectiveness(emp) {
        if (!emp || typeof emp !== 'object')
            return null;
        // Current Torn company/employees responses expose effectiveness as an
        // object. This is the same breakdown Torn shows in the employee table:
        // working stats + settled in + director education + addiction = total.
        var raw = emp.effectiveness;
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            var total = numericValue(raw.total);
            return {
                source: 'effectiveness',
                workingStats: numericValue(raw.working_stats),
                settledIn: numericValue(raw.settled_in),
                directorEducation: numericValue(raw.director_education),
                addiction: numericValue(raw.addiction),
                total: total,
            };
        }
        // Backwards compatibility for older/alternate response shapes where EE
        // may be returned as a single numeric field.
        var key = Object.keys(emp).find(function (k) { return /effectiveness|^ee$/i.test(k) && typeof emp[k] === 'number'; });
        if (!key)
            return null;
        return {
            source: key,
            workingStats: null,
            settledIn: null,
            directorEducation: null,
            addiction: null,
            total: emp[key],
        };
    }
    function findEffectivenessField(emp) {
        var ee = getEmployeeEffectiveness(emp);
        return ee && typeof ee.total === 'number' ? { key: ee.source, value: ee.total } : null;
    }
    function formatMoney(n) {
        if (typeof n !== 'number' || Number.isNaN(n))
            return '—';
        var sign = n < 0 ? '-' : '';
        var abs = Math.abs(n);
        if (abs >= 1e9)
            return "".concat(sign, "$").concat((abs / 1e9).toFixed(2), "B");
        if (abs >= 1e6)
            return "".concat(sign, "$").concat((abs / 1e6).toFixed(2), "M");
        if (abs >= 1e3)
            return "".concat(sign, "$").concat((abs / 1e3).toFixed(1), "K");
        return "".concat(sign, "$").concat(abs.toFixed(0));
    }
    function dayKey(ts) {
        var d = new Date(ts);
        return "".concat(d.getFullYear(), "-").concat(d.getMonth(), "-").concat(d.getDate());
    }
    function getSnapshotsSorted() {
        return __awaiter(this, void 0, void 0, function () {
            var all;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, LocalDB.getAll('snapshots')];
                    case 1:
                        all = _a.sent();
                        return [2 /*return*/, all.sort(function (a, b) { return a.timestamp - b.timestamp; })];
                }
            });
        });
    }
    // One entry per distinct local calendar day, keeping the LAST snapshot
    // taken that day (freshest read for that day). This is purely local,
    // locally-timestamped data — never backfilled or invented for days
    // before you started running the diagnostic.
    function collapseToDaily(snapshots) {
        var e_15, _a;
        var byDay = new Map();
        try {
            for (var snapshots_1 = __values(snapshots), snapshots_1_1 = snapshots_1.next(); !snapshots_1_1.done; snapshots_1_1 = snapshots_1.next()) {
                var snap = snapshots_1_1.value;
                byDay.set(dayKey(snap.timestamp), snap);
            } // later overwrites earlier same-day
        }
        catch (e_15_1) { e_15 = { error: e_15_1 }; }
        finally {
            try {
                if (snapshots_1_1 && !snapshots_1_1.done && (_a = snapshots_1.return)) _a.call(snapshots_1);
            }
            finally { if (e_15) throw e_15.error; }
        }
        return __spreadArray([], __read(byDay.values()), false).sort(function (a, b) { return a.timestamp - b.timestamp; });
    }
    // =======================================================================
    // FINANCE TAB
    // =======================================================================
    function renderFinanceTab(panel) {
        return __awaiter(this, void 0, void 0, function () {
            function findNumericFieldDeep(obj, preferredNames, fallbackPattern) {
                var preferred = new Set(preferredNames.map(function (name) { return name.toLowerCase(); }));
                var seen = new WeakSet();
                var fallback = null;
                function walk(value, path) {
                    var e_16, _a;
                    if (path === void 0) { path = ''; }
                    if (!value || typeof value !== 'object' || seen.has(value))
                        return null;
                    seen.add(value);
                    try {
                        for (var _b = __values(Object.entries(value)), _c = _b.next(); !_c.done; _c = _b.next()) {
                            var _d = __read(_c.value, 2), key = _d[0], child = _d[1];
                            var currentPath = path ? "".concat(path, ".").concat(key) : key;
                            if (typeof child === 'number' && Number.isFinite(child)) {
                                var lower = key.toLowerCase();
                                if (preferred.has(lower))
                                    return { key: key, value: child, path: currentPath };
                                if (!fallback && fallbackPattern.test(key))
                                    fallback = { key: key, value: child, path: currentPath };
                            }
                            else if (child && typeof child === 'object') {
                                var found = walk(child, currentPath);
                                if (found && preferred.has(found.key.toLowerCase()))
                                    return found;
                            }
                        }
                    }
                    catch (e_16_1) { e_16 = { error: e_16_1 }; }
                    finally {
                        try {
                            if (_c && !_c.done && (_a = _b.return)) _a.call(_b);
                        }
                        finally { if (e_16) throw e_16.error; }
                    }
                    return null;
                }
                return walk(obj) || fallback;
            }
            // --- Historical comparison from local snapshots ---
            // Snapshots store profile and detailed under separate keys (matching how
            // they were fetched), so merge them per-snapshot the same way as above —
            // otherwise a snapshot taken when only "detailed" held the income field
            // would silently be treated as having no income data at all.
            function snapshotIncomeFields(snap) {
                return __assign(__assign({}, (snap.company_profile || {})), (snap.company_detailed || {}));
            }
            function findDailyIncome(snap) {
                var merged = snapshotIncomeFields(snap);
                return Object.entries(merged).find(function (_a) {
                    var _b = __read(_a, 2), k = _b[0], v = _b[1];
                    return typeof v === 'number' && /daily/i.test(k) && /profit|income/i.test(k);
                });
            }
            var el, results, profile, detailed, employeesRaw, blockedProfile, blockedDetailed, html, combined, dailyField, weeklyField, employees, wageFields, totalSalary, salaryFieldName, aggregateWage, todayGross, todayNet, bankField, popField, effField, envField, allSnapshots, withIncomeData, daily, todaySnap, ySnap, gField, yField, change, pct, recent, values, maxAbs_1;
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        el = panel.querySelector('[data-tabpanel="finance"]');
                        results = state.lastResults;
                        if (!results) {
                            el.innerHTML = "<div class=\"tds-box tds-box-neutral\">Run the diagnostic first (Overview tab or the \u27F3 button) \u2014 Finance reads from that data plus your local snapshot history.</div>";
                            return [2 /*return*/];
                        }
                        profile = findRaw(results, 'company', 'profile');
                        detailed = findRaw(results, 'company', 'detailed');
                        employeesRaw = findRaw(results, 'company', 'employees');
                        blockedProfile = findBlockedReason(results, 'company', 'profile');
                        blockedDetailed = findBlockedReason(results, 'company', 'detailed');
                        html = '';
                        if (!profile && !detailed) {
                            html += "<div class=\"tds-box tds-box-danger\"><strong>Company profile unavailable.</strong> ".concat(blockedProfile || 'No data returned.', " Finance needs at least this to show anything.</div>");
                            el.innerHTML = html;
                            return [2 /*return*/];
                        }
                        combined = __assign(__assign({}, (profile || {})), (detailed || {}));
                        dailyField = findNumericFieldDeep(combined, ['daily_income', 'daily_profit'], /daily[_ ]?(income|profit)/i);
                        weeklyField = findNumericFieldDeep(combined, ['weekly_income', 'weekly_profit'], /weekly[_ ]?(income|profit)/i);
                        employees = extractEmployeesEntries(employeesRaw);
                        wageFields = employees.map(function (e) { return findWageField(e.raw); }).filter(Boolean);
                        totalSalary = wageFields.length > 0 ? wageFields.reduce(function (sum, w) { return sum + w.value; }, 0) : null;
                        salaryFieldName = (_a = wageFields[0]) === null || _a === void 0 ? void 0 : _a.key;
                        // Fallback: some responses may only expose an aggregate wage/salary
                        // figure at the company level rather than per employee.
                        if (totalSalary === null) {
                            aggregateWage = Object.entries(combined).find(function (_a) {
                                var _b = __read(_a, 2), k = _b[0], v = _b[1];
                                return typeof v === 'number' && /wage|salar/i.test(k);
                            });
                            if (aggregateWage) {
                                totalSalary = aggregateWage[1];
                                salaryFieldName = aggregateWage[0];
                            }
                        }
                        todayGross = dailyField ? dailyField.value : null;
                        todayNet = todayGross !== null && totalSalary !== null ? todayGross - totalSalary : null;
                        // --- Today snapshot card ---
                        html += '<div class="tds-section-label">Today</div><div class="tds-card">';
                        html += "<div class=\"tds-row\"><span class=\"tds-row-label\">Gross".concat(dailyField ? " (".concat(dailyField.path, ")") : '', "</span><span class=\"tds-row-value\">").concat(todayGross !== null ? formatMoney(todayGross) : '<span class="tds-v-dim">unavailable</span>', "</span></div>");
                        html += "<div class=\"tds-row\"><span class=\"tds-row-label\">Salaries".concat(salaryFieldName ? " (".concat(salaryFieldName, ")") : '', "</span><span class=\"tds-row-value tds-v-bad\">").concat(totalSalary !== null ? '-' + formatMoney(totalSalary) : '<span class="tds-v-dim">no wage field in this key\u2019s response</span>', "</span></div>");
                        html += "<div class=\"tds-row\"><span class=\"tds-row-label\">Net (DERIVED)</span><span class=\"tds-row-value ".concat(todayNet !== null ? (todayNet >= 0 ? 'tds-v-good' : 'tds-v-bad') : '', "\">").concat(todayNet !== null ? formatMoney(todayNet) : '<span class="tds-v-dim">needs gross + salary above</span>', "</span></div>");
                        if (weeklyField) {
                            html += "<div class=\"tds-row\"><span class=\"tds-row-label\">Weekly (".concat(weeklyField.path, ")</span><span class=\"tds-row-value\">").concat(formatMoney(weeklyField.value), "</span></div>");
                        }
                        html += '</div>';
                        if (todayGross === null) {
                            html += "<div class=\"tds-box tds-box-warn\">No numeric daily_income/daily_profit field was found in the company profile or detailed response. Fields actually present \u2014 profile: ".concat(profile ? Object.keys(profile).join(', ') : (blockedProfile || 'blocked'), "; detailed: ").concat(detailed ? Object.keys(detailed).join(', ') : (blockedDetailed || 'blocked'), ".</div>");
                        }
                        // --- Company health, if company/detailed is accessible with this key ---
                        if (detailed) {
                            bankField = Object.entries(detailed).find(function (_a) {
                                var _b = __read(_a, 2), k = _b[0], v = _b[1];
                                return typeof v === 'number' && /bank/i.test(k);
                            });
                            popField = Object.entries(detailed).find(function (_a) {
                                var _b = __read(_a, 2), k = _b[0], v = _b[1];
                                return typeof v === 'number' && /popular/i.test(k);
                            });
                            effField = Object.entries(detailed).find(function (_a) {
                                var _b = __read(_a, 2), k = _b[0], v = _b[1];
                                return typeof v === 'number' && /efficien/i.test(k);
                            });
                            envField = Object.entries(detailed).find(function (_a) {
                                var _b = __read(_a, 2), k = _b[0], v = _b[1];
                                return typeof v === 'number' && /environ/i.test(k);
                            });
                            if (bankField || popField || effField || envField) {
                                html += '<div class="tds-section-label">Company Health</div><div class="tds-card">';
                                if (bankField)
                                    html += "<div class=\"tds-row\"><span class=\"tds-row-label\">Company bank</span><span class=\"tds-row-value\">".concat(formatMoney(bankField[1]), "</span></div>");
                                if (popField)
                                    html += "<div class=\"tds-row\"><span class=\"tds-row-label\">Popularity</span><span class=\"tds-row-value\">".concat(popField[1], "%</span></div>");
                                if (effField)
                                    html += "<div class=\"tds-row\"><span class=\"tds-row-label\">Efficiency</span><span class=\"tds-row-value\">".concat(effField[1], "%</span></div>");
                                if (envField)
                                    html += "<div class=\"tds-row\"><span class=\"tds-row-label\">Environment</span><span class=\"tds-row-value\">".concat(envField[1], "%</span></div>");
                                html += '</div>';
                            }
                        }
                        return [4 /*yield*/, getSnapshotsSorted()];
                    case 1:
                        allSnapshots = _b.sent();
                        withIncomeData = allSnapshots.filter(function (s) { return s.company_profile || s.company_detailed; });
                        daily = collapseToDaily(withIncomeData);
                        html += '<div class="tds-section-label">Today vs Yesterday <span class="tds-v-dim" style="font-weight:400;">(HISTORICAL \u2014 from local snapshots only)</span></div>';
                        if (daily.length < 2) {
                            html += "<div class=\"tds-box tds-box-neutral\">Insufficient data \u2014 only ".concat(daily.length, " day").concat(daily.length === 1 ? '' : 's', " of local snapshots so far. This starts filling in from tomorrow\u2019s first run onward; nothing here is backfilled or estimated.</div>");
                        }
                        else {
                            todaySnap = daily[daily.length - 1];
                            ySnap = daily[daily.length - 2];
                            gField = findDailyIncome(todaySnap);
                            yField = gField ? [gField[0], snapshotIncomeFields(ySnap)[gField[0]]] : null;
                            html += '<div class="tds-card">';
                            if (gField && yField && typeof yField[1] === 'number') {
                                change = gField[1] - yField[1];
                                pct = yField[1] !== 0 ? (change / Math.abs(yField[1])) * 100 : null;
                                html += "<div class=\"tds-row\"><span class=\"tds-row-label\">Today</span><span class=\"tds-row-value\">".concat(formatMoney(gField[1]), "</span></div>");
                                html += "<div class=\"tds-row\"><span class=\"tds-row-label\">Yesterday (last snapshot that day)</span><span class=\"tds-row-value\">".concat(formatMoney(yField[1]), "</span></div>");
                                html += "<div class=\"tds-row\"><span class=\"tds-row-label\">Change</span><span class=\"tds-row-value ".concat(change >= 0 ? 'tds-v-good' : 'tds-v-bad', "\">").concat(change >= 0 ? '+' : '').concat(formatMoney(change)).concat(pct !== null ? " (".concat(change >= 0 ? '\u2191' : '\u2193', " ").concat(Math.abs(pct).toFixed(1), "%)") : '', "</span></div>");
                            }
                            else {
                                html += "<div class=\"tds-row-label\">Couldn\u2019t match a comparable income field between the two snapshots.</div>";
                            }
                            html += '</div>';
                            recent = daily.slice(-7);
                            values = recent.map(function (s) {
                                var f = findDailyIncome(s);
                                return f ? f[1] : null;
                            }).filter(function (v) { return v !== null; });
                            if (values.length >= 2) {
                                maxAbs_1 = Math.max.apply(Math, __spreadArray(__spreadArray([], __read(values.map(function (v) { return Math.abs(v); })), false), [1], false));
                                html += "<div class=\"tds-section-label\">Last ".concat(values.length, " days <span class=\"tds-v-dim\" style=\"font-weight:400;\">(local snapshots)</span></div><div class=\"tds-card\"><div class=\"tds-spark\">");
                                recent.forEach(function (s) {
                                    var f = findDailyIncome(s);
                                    var v = f ? f[1] : 0;
                                    var h = Math.max(2, Math.round((Math.abs(v) / maxAbs_1) * 40));
                                    var cls = v >= 0 ? 'tds-bar-pos' : 'tds-bar-neg';
                                    var d = new Date(s.timestamp);
                                    html += "<div class=\"tds-spark-col\"><div class=\"tds-spark-bar ".concat(cls, "\" style=\"height:").concat(h, "px\" title=\"").concat(formatMoney(v), "\"></div><div class=\"tds-spark-label\">").concat(d.getMonth() + 1, "/").concat(d.getDate(), "</div></div>");
                                });
                                html += '</div></div>';
                            }
                        }
                        html += "<div class=\"tds-box tds-box-neutral\" style=\"margin-top:10px;\">One snapshot is taken per diagnostic run, up to ".concat(MAX_SNAPSHOTS, " kept locally (oldest pruned first). Run Diagnostics Again when you want a fresh snapshot.</div>");
                        el.innerHTML = html;
                        return [2 /*return*/];
                }
            });
        });
    }
    // =======================================================================
    // STOCK MANAGEMENT TAB
    // =======================================================================
    var STOCK_NEWS_CACHE_MS = 5 * 60 * 1000;
    function deepObjectEntries(raw) {
        var out = [];
        var seen = new WeakSet();
        function walk(value, path) {
            if (path === void 0) { path = []; }
            if (!value || typeof value !== 'object' || seen.has(value))
                return;
            seen.add(value);
            out.push({ value: value, path: path });
            if (Array.isArray(value))
                value.forEach(function (child, i) { return walk(child, __spreadArray(__spreadArray([], __read(path), false), [String(i)], false)); });
            else
                Object.entries(value).forEach(function (_a) {
                    var _b = __read(_a, 2), key = _b[0], child = _b[1];
                    return walk(child, __spreadArray(__spreadArray([], __read(path), false), [key], false));
                });
        }
        walk(raw);
        return out;
    }
    function pickNumeric(obj, names) {
        var e_17, _a;
        if (!obj || typeof obj !== 'object')
            return null;
        var _loop_2 = function (name) {
            var wanted = normalizeFieldName(name);
            var entry = Object.entries(obj).find(function (_a) {
                var _b = __read(_a, 2), k = _b[0], v = _b[1];
                return normalizeFieldName(k) === wanted && numericValue(v) !== null;
            });
            if (entry)
                return { value: numericValue(entry[1]) };
        };
        try {
            for (var names_1 = __values(names), names_1_1 = names_1.next(); !names_1_1.done; names_1_1 = names_1.next()) {
                var name = names_1_1.value;
                var state_1 = _loop_2(name);
                if (typeof state_1 === "object")
                    return state_1.value;
            }
        }
        catch (e_17_1) { e_17 = { error: e_17_1 }; }
        finally {
            try {
                if (names_1_1 && !names_1_1.done && (_a = names_1.return)) _a.call(names_1);
            }
            finally { if (e_17) throw e_17.error; }
        }
        return null;
    }
    function pickText(obj, names) {
        var e_18, _a;
        if (!obj || typeof obj !== 'object')
            return null;
        var _loop_3 = function (name) {
            var wanted = normalizeFieldName(name);
            var entry = Object.entries(obj).find(function (_a) {
                var _b = __read(_a, 2), k = _b[0], v = _b[1];
                return normalizeFieldName(k) === wanted && (typeof v === 'string' || typeof v === 'number');
            });
            if (entry && String(entry[1]).trim())
                return { value: String(entry[1]).trim() };
        };
        try {
            for (var names_2 = __values(names), names_2_1 = names_2.next(); !names_2_1.done; names_2_1 = names_2.next()) {
                var name = names_2_1.value;
                var state_2 = _loop_3(name);
                if (typeof state_2 === "object")
                    return state_2.value;
            }
        }
        catch (e_18_1) { e_18 = { error: e_18_1 }; }
        finally {
            try {
                if (names_2_1 && !names_2_1.done && (_a = names_2.return)) _a.call(names_2);
            }
            finally { if (e_18) throw e_18.error; }
        }
        return null;
    }
    function extractStockItems(stockRaw) {
        var e_19, _a;
        if (!stockRaw)
            return [];
        var candidates = [];
        var seenKeys = new Set();
        try {
            for (var _b = __values(deepObjectEntries(stockRaw)), _c = _b.next(); !_c.done; _c = _b.next()) {
                var _d = _c.value, value = _d.value, path = _d.path;
                if (!value || typeof value !== 'object' || Array.isArray(value))
                    continue;
                var name = pickText(value, ['name', 'item_name', 'stock_name', 'product_name']);
                var id = pickText(value, ['id', 'item_id', 'stock_id', 'product_id']) || (path.length ? path[path.length - 1] : null);
                var current = pickNumeric(value, ['amount', 'quantity', 'qty', 'stock', 'in_stock', 'instock', 'available', 'inventory']);
                var setPrice = pickNumeric(value, ['price', 'selling_price', 'sell_price', 'price_each', 'priceeach']);
                var costEach = pickNumeric(value, ['cost', 'cost_each', 'costeach', 'unit_cost', 'buy_price']);
                var rrp = pickNumeric(value, ['rrp', 'recommended_retail_price', 'retail_price']);
                var soldTotal = pickNumeric(value, ['sold_total', 'soldtotal', 'total_sold', 'units_sold_total']);
                var soldDaily = pickNumeric(value, ['sold_daily', 'solddaily', 'daily_sold', 'sold_day', 'sold_today', 'daily_sales', 'sales_day']);
                var sold24 = pickNumeric(value, ['sold_24h', 'sold24h', 'sold_day', 'sold_today', 'daily_sold', 'daily_sales', 'sales_day']);
                var sold7 = pickNumeric(value, ['sold_7d', 'sold7d', 'sold_week', 'weekly_sold', 'weekly_sales', 'sales_week']);
                if (!name || (current === null && sold24 === null && sold7 === null && soldDaily === null && setPrice === null))
                    continue;
                var key = "".concat(id || '', "|").concat(name).toLowerCase();
                if (seenKeys.has(key))
                    continue;
                seenKeys.add(key);
                candidates.push({
                    id: id,
                    name: name,
                    current: current,
                    setPrice: setPrice,
                    costEach: costEach,
                    rrp: rrp,
                    soldTotal: soldTotal,
                    soldDaily: soldDaily,
                    sold24: sold24,
                    sold7: sold7,
                    raw: value
                });
            }
        }
        catch (e_19_1) { e_19 = { error: e_19_1 }; }
        finally {
            try {
                if (_c && !_c.done && (_a = _b.return)) _a.call(_b);
            }
            finally { if (e_19) throw e_19.error; }
        }
        return candidates.sort(function (a, b) { return a.name.localeCompare(b.name); });
    }
    function flattenNewsEntries(newsRaw) {
        var e_20, _a;
        if (!newsRaw)
            return [];
        var rows = [];
        var seen = new Set();
        try {
            for (var _b = __values(deepObjectEntries(newsRaw)), _c = _b.next(); !_c.done; _c = _b.next()) {
                var _d = _c.value, value = _d.value, path = _d.path;
                if (!value || typeof value !== 'object' || Array.isArray(value))
                    continue;
                var timestamp = pickNumeric(value, ['timestamp', 'time', 'created_at', 'date']);
                var text = pickText(value, ['text', 'news', 'message', 'description', 'event', 'title']);
                var id = pickText(value, ['id', 'news_id', 'event_id']) || path.join('.');
                if (!text || !timestamp)
                    continue;
                var key = "".concat(id, "|").concat(timestamp, "|").concat(text);
                if (seen.has(key))
                    continue;
                seen.add(key);
                rows.push({ id: id, timestamp: timestamp, text: text, raw: value });
            }
        }
        catch (e_20_1) { e_20 = { error: e_20_1 }; }
        finally {
            try {
                if (_c && !_c.done && (_a = _b.return)) _a.call(_b);
            }
            finally { if (e_20) throw e_20.error; }
        }
        return rows.sort(function (a, b) { return b.timestamp - a.timestamp; });
    }
    function parseSaleFromNews(entry, stockItems) {
        var e_21, _a, e_22, _b;
        var raw = entry.raw || {};
        var text = String(entry.text || '');
        if (!/(sold|sale|customer|purchased|bought)/i.test(text))
            return null;
        var qty = pickNumeric(raw, ['quantity', 'qty', 'amount', 'sold', 'units', 'count']);
        var itemName = pickText(raw, ['item_name', 'stock_name', 'product_name', 'item', 'product']);
        var patterns = [
            /(?:sold|sale of)\s+(\d[\d,]*)\s+(?:x\s+)?(.+?)(?:\s+(?:for|at|to|worth)\b|[.!]|$)/i,
            /(\d[\d,]*)\s+(?:x\s+)?(.+?)\s+(?:were\s+|was\s+)?sold\b/i,
            /(.+?)\s*[:\-]\s*(\d[\d,]*)\s+(?:sold|sales)\b/i,
        ];
        if (qty === null || !itemName) {
            try {
                for (var patterns_1 = __values(patterns), patterns_1_1 = patterns_1.next(); !patterns_1_1.done; patterns_1_1 = patterns_1.next()) {
                    var re = patterns_1_1.value;
                    var m = text.match(re);
                    if (!m)
                        continue;
                    if (/^\D/.test(m[1])) {
                        itemName = itemName || m[1].trim();
                        qty = qty !== null && qty !== void 0 ? qty : Number(String(m[2]).replace(/,/g, ''));
                    }
                    else {
                        qty = qty !== null && qty !== void 0 ? qty : Number(String(m[1]).replace(/,/g, ''));
                        itemName = itemName || m[2].trim();
                    }
                    break;
                }
            }
            catch (e_21_1) { e_21 = { error: e_21_1 }; }
            finally {
                try {
                    if (patterns_1_1 && !patterns_1_1.done && (_a = patterns_1.return)) _a.call(patterns_1);
                }
                finally { if (e_21) throw e_21.error; }
            }
        }
        if (!Number.isFinite(qty) || qty <= 0 || !itemName)
            return null;
        // Prefer a current stock item name so minor wording differences in news
        // aggregate into the same row.
        var normalizedNewsName = normalizeFieldName(itemName);
        var match = stockItems.find(function (item) {
            var n = normalizeFieldName(item.name);
            return n === normalizedNewsName || n.includes(normalizedNewsName) || normalizedNewsName.includes(n);
        });
        var salePrice = pickNumeric(raw, [
            'price', 'sale_price', 'sold_price', 'price_each', 'unit_price', 'selling_price'
        ]);
        if (salePrice === null) {
            var pricePatterns = [
                /(?:for|at)\s*\$\s*([\d,]+(?:\.\d+)?)(?:\s+each)?\b/i,
                /\$\s*([\d,]+(?:\.\d+)?)\s*(?:each|per\s+item|per\s+unit)\b/i,
            ];
            try {
                for (var pricePatterns_1 = __values(pricePatterns), pricePatterns_1_1 = pricePatterns_1.next(); !pricePatterns_1_1.done; pricePatterns_1_1 = pricePatterns_1.next()) {
                    var re = pricePatterns_1_1.value;
                    var m = text.match(re);
                    if (!m)
                        continue;
                    var parsed = Number(String(m[1]).replace(/,/g, ''));
                    if (Number.isFinite(parsed)) {
                        salePrice = parsed;
                        break;
                    }
                }
            }
            catch (e_22_1) { e_22 = { error: e_22_1 }; }
            finally {
                try {
                    if (pricePatterns_1_1 && !pricePatterns_1_1.done && (_b = pricePatterns_1.return)) _b.call(pricePatterns_1);
                }
                finally { if (e_22) throw e_22.error; }
            }
        }
        return {
            timestamp: entry.timestamp,
            quantity: qty,
            name: (match === null || match === void 0 ? void 0 : match.name) || itemName,
            id: (match === null || match === void 0 ? void 0 : match.id) || null,
            price: salePrice
        };
    }
    function aggregateSales(newsRaw, stockItems) {
        var e_23, _a;
        var nowSec = Math.floor(Date.now() / 1000);
        var dayAgo = nowSec - 86400;
        var weekAgo = nowSec - 7 * 86400;
        var totals = new Map();
        var entries = flattenNewsEntries(newsRaw);
        var parsedEvents = 0;
        try {
            for (var entries_1 = __values(entries), entries_1_1 = entries_1.next(); !entries_1_1.done; entries_1_1 = entries_1.next()) {
                var entry = entries_1_1.value;
                var sale = parseSaleFromNews(entry, stockItems);
                if (!sale)
                    continue;
                parsedEvents += 1;
                var key = String(sale.id || normalizeFieldName(sale.name));
                var row = totals.get(key) || {
                    name: sale.name,
                    sold24: 0,
                    sold7: 0,
                    lastSoldPrice: null,
                    lastSoldAt: null,
                    pricedUnits24: 0,
                    pricedRevenue24: 0
                };
                if (sale.timestamp >= weekAgo)
                    row.sold7 += sale.quantity;
                if (sale.timestamp >= dayAgo)
                    row.sold24 += sale.quantity;
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
        }
        catch (e_23_1) { e_23 = { error: e_23_1 }; }
        finally {
            try {
                if (entries_1_1 && !entries_1_1.done && (_a = entries_1.return)) _a.call(entries_1);
            }
            finally { if (e_23) throw e_23.error; }
        }
        var oldestTimestamp = entries.length ? Math.min.apply(Math, __spreadArray([], __read(entries.map(function (e) { return e.timestamp; })), false)) : null;
        return { totals: totals, parsedEvents: parsedEvents, newsEntries: entries.length, oldestTimestamp: oldestTimestamp };
    }
    function fetchCompanyNewsForStock() {
        return __awaiter(this, void 0, void 0, function () {
            var now, from, data, err_5;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (state.stock.newsCache && Date.now() - state.stock.newsCacheAt < STOCK_NEWS_CACHE_MS)
                            return [2 /*return*/, state.stock.newsCache];
                        now = Math.floor(Date.now() / 1000);
                        from = now - 7 * 86400;
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 5]);
                        return [4 /*yield*/, ApiClient.call('company', 'news', '', { from: from, to: now })];
                    case 2:
                        data = _a.sent();
                        return [3 /*break*/, 5];
                    case 3:
                        err_5 = _a.sent();
                        return [4 /*yield*/, ApiClient.call('company', 'news')];
                    case 4:
                        // Some API versions ignore/rename the window parameters. Fall back to
                        // the normal news selection before declaring the history unavailable.
                        data = _a.sent();
                        return [3 /*break*/, 5];
                    case 5:
                        state.stock.newsCache = data;
                        state.stock.newsCacheAt = Date.now();
                        return [2 /*return*/, data];
                }
            });
        });
    }
    function stockDaysRemaining(current, dailyRate) {
        if (current === null || typeof current !== 'number')
            return null;
        if (!dailyRate || dailyRate <= 0)
            return null;
        return current / dailyRate;
    }
    function stockGrossMargin(setPrice, costEach) {
        if (setPrice === null || costEach === null)
            return null;
        return setPrice - costEach;
    }
    function stockMarginPercent(setPrice, costEach) {
        if (setPrice === null || costEach === null || costEach <= 0)
            return null;
        return ((setPrice - costEach) / costEach) * 100;
    }
    function pricingRecommendation(item, sold24, sold7, lastSoldPrice) {
        var setPrice = item.setPrice;
        var rrp = item.rrp;
        var current = item.current;
        var day = sold24 !== null ? Math.max(0, Number(sold24) || 0) : null;
        var week = sold7 !== null ? Math.max(0, Number(sold7) || 0) : null;
        var weeklyDailyAverage = week !== null ? week / 7 : null;
        var dailyRate = day !== null ? day : (item.soldDaily !== null ? item.soldDaily : weeklyDailyAverage);
        var daysLeft = stockDaysRemaining(current, dailyRate);
        if (setPrice === null) {
            return {
                action: 'No price data',
                className: '',
                suggested: null,
                reason: 'Torn did not return the currently configured selling price.'
            };
        }
        var trend = day !== null && weeklyDailyAverage !== null && weeklyDailyAverage > 0
            ? ((day - weeklyDailyAverage) / weeklyDailyAverage) * 100
            : null;
        var score = 0;
        var reasons = [];
        // Strong recent demand and plenty of cover suggests there is room to test
        // a small increase. Weak demand with lots of inventory suggests the reverse.
        if (trend !== null) {
            if (trend >= 15) {
                score += 2;
                reasons.push("24h sales are ".concat(trend.toFixed(0), "% above the 7-day daily average"));
            }
            else if (trend <= -15) {
                score -= 2;
                reasons.push("24h sales are ".concat(Math.abs(trend).toFixed(0), "% below the 7-day daily average"));
            }
            else {
                reasons.push('24h sales are close to the 7-day daily average');
            }
        }
        if (daysLeft !== null) {
            if (daysLeft >= 14) {
                score += 1;
                reasons.push("".concat(daysLeft.toFixed(1), " days of stock remain"));
            }
            else if (daysLeft <= 4) {
                score -= 1;
                reasons.push("only ".concat(daysLeft.toFixed(1), " days of stock remain"));
            }
        }
        if (rrp !== null) {
            if (setPrice < rrp * 0.85) {
                score += 1;
                reasons.push("set price is well below RRP (".concat(formatCurrency(rrp), ")"));
            }
            else if (setPrice > rrp * 1.20) {
                score -= 1;
                reasons.push("set price is well above RRP (".concat(formatCurrency(rrp), ")"));
            }
        }
        if (lastSoldPrice !== null) {
            if (lastSoldPrice >= setPrice) {
                reasons.push("latest observed sale cleared at ".concat(formatCurrency(lastSoldPrice)));
            }
            else {
                score -= 1;
                reasons.push("latest observed sale price (".concat(formatCurrency(lastSoldPrice), ") is below the set price"));
            }
        }
        var action = 'Hold';
        var suggested = setPrice;
        var className = '';
        if (score >= 2) {
            action = 'Consider raising';
            suggested = setPrice + 1;
            className = 'tds-v-good';
        }
        else if (score <= -2) {
            action = 'Consider lowering';
            suggested = Math.max(item.costEach !== null ? item.costEach : 0, setPrice - 1);
            className = 'tds-v-bad';
        }
        return {
            action: action,
            suggested: suggested,
            className: className,
            daysLeft: daysLeft,
            trend: trend,
            reason: reasons.length ? reasons.join('; ') : 'Not enough recent sales evidence to justify changing the price.'
        };
    }
    function restockRecommendation(current, sold24, sold7) {
        if (sold24 === null && sold7 === null)
            return null;
        var day = Math.max(0, Number(sold24) || 0);
        var week = Math.max(0, Number(sold7) || 0);
        if (day === 0 && week === 0)
            return { target: 0, restock: 0, baseline: 0 };
        // Use the faster of the recent one-day run-rate and the observed seven-day
        // total, then add a 20% safety buffer. This is a recommendation, not a Torn
        // API field, and is labelled DERIVED in the UI.
        var baseline = Math.max(week, day * 7);
        var target = Math.ceil(baseline * 1.20);
        var restock = current === null ? null : Math.max(0, target - Math.max(0, current));
        return { target: target, restock: restock, baseline: baseline };
    }
    function renderStockTab(panel_1) {
        return __awaiter(this, arguments, void 0, function (panel, _a) {
            var el, results, stockRaw, blocked, items, sales, newsError, diagnosticNews, newsRaw, _b, err_6, html, coverage, items_1, items_1_1, item, keyById, keyByName, fromNews, sold24, sold7, soldDaily, lastSoldPrice, averageSoldPrice24, rec, priceRec, margin, marginPct, daysLeft, estDailyGross, restockText, lastPriceHtml;
            var e_24, _c;
            var _d, _e;
            var _f = _a === void 0 ? {} : _a, _g = _f.refresh, refresh = _g === void 0 ? false : _g;
            return __generator(this, function (_h) {
                switch (_h.label) {
                    case 0:
                        el = panel.querySelector('[data-tabpanel="stock"]');
                        if (!el)
                            return [2 /*return*/];
                        results = state.lastResults;
                        if (!results) {
                            el.innerHTML = "<div class=\"tds-box tds-box-neutral\">Run Diagnostics once so Stock Management can read your company stock.</div>";
                            return [2 /*return*/];
                        }
                        stockRaw = findRaw(results, 'company', 'stock');
                        blocked = findBlockedReason(results, 'company', 'stock');
                        if (!stockRaw) {
                            el.innerHTML = "<div class=\"tds-box tds-box-danger\"><strong>Company stock unavailable.</strong> ".concat(escapeHtml(blocked || 'No company/stock data was returned.'), "</div>");
                            return [2 /*return*/];
                        }
                        items = extractStockItems(stockRaw);
                        if (el.hidden && !refresh) {
                            el.innerHTML = "<div class=\"tds-box tds-box-neutral\">Stock data is ready. Open this tab to load recent sales history, restock targets, margins and read-only pricing recommendations.</div>";
                            return [2 /*return*/];
                        }
                        if (!items.length) {
                            el.innerHTML = "<div class=\"tds-box tds-box-warn\"><strong>Stock data was returned, but its item structure was not recognised yet.</strong><br>Open Diagnostics and check the fields shown for Company stock. The raw response is deliberately not guessed into fake item rows.</div>";
                            return [2 /*return*/];
                        }
                        el.innerHTML = "<div class=\"tds-box tds-box-neutral\">Loading recent sales and pricing history\u2026</div>";
                        sales = { totals: new Map(), parsedEvents: 0, newsEntries: 0, oldestTimestamp: null };
                        newsError = null;
                        _h.label = 1;
                    case 1:
                        _h.trys.push([1, 4, , 5]);
                        if (refresh) {
                            state.stock.newsCache = null;
                            state.stock.newsCacheAt = 0;
                        }
                        diagnosticNews = findRaw(results, 'company', 'news');
                        _b = diagnosticNews;
                        if (_b) return [3 /*break*/, 3];
                        return [4 /*yield*/, fetchCompanyNewsForStock()];
                    case 2:
                        _b = (_h.sent());
                        _h.label = 3;
                    case 3:
                        newsRaw = _b;
                        sales = aggregateSales(newsRaw, items);
                        return [3 /*break*/, 5];
                    case 4:
                        err_6 = _h.sent();
                        newsError = err_6;
                        return [3 /*break*/, 5];
                    case 5:
                        html = "\n      <div class=\"tds-box tds-box-info\">\n        <strong>Read-only pricing assistant:</strong> this tab does <strong>not</strong> submit prices or interact with Torn's Pricing form.\n        It only analyses data Torn returns and suggests <strong>Hold / Consider raising / Consider lowering</strong>.\n        Suggested prices are advisory and deliberately move only <strong>$1 at a time</strong>.\n      </div>\n      <div class=\"tds-box tds-box-info\">\n        <strong>Restock recommendation:</strong> target = 120% of the higher of <em>last 7 days sold</em> or <em>last 24 hours \u00D7 7</em>.\n        This gives roughly one week of fast-moving stock plus a 20% buffer. Targets are <strong>DERIVED</strong>.\n      </div>";
                        if (newsError) {
                            html += "<div class=\"tds-box tds-box-warn\"><strong>Item-level sales history unavailable.</strong> ".concat(escapeHtml(newsError.reason || 'company/news could not be read with this key'), ". Current stock/pricing fields returned directly by Torn are still shown.</div>");
                        }
                        else if (!sales.parsedEvents) {
                            html += "<div class=\"tds-box tds-box-warn\">Company news was accessible (".concat(formatNumber(sales.newsEntries), " entries inspected), but no item-sale events were recognised. Direct <code>company/stock</code> sales fields are still used where available; Last Sold Price stays unavailable rather than being guessed.</div>");
                        }
                        else {
                            coverage = sales.oldestTimestamp ? formatTimestampRelative(sales.oldestTimestamp * 1000) : 'unknown';
                            html += "<div class=\"tds-box tds-box-neutral\">Parsed ".concat(formatNumber(sales.parsedEvents), " stock-sale event(s) from company news. Oldest returned news: ").concat(escapeHtml(coverage), ".</div>");
                        }
                        html += "<div style=\"overflow-x:auto;\">\n      <table class=\"tds-table tds-stock-table\">\n        <thead>\n          <tr>\n            <th>Product</th>\n            <th>Cost</th>\n            <th>RRP</th>\n            <th>Set Price</th>\n            <th>Last Sold</th>\n            <th>In Stock</th>\n            <th>Sold Daily</th>\n            <th>Sold 24h</th>\n            <th>Sold 7d</th>\n            <th>Days Left</th>\n            <th>Margin / Unit</th>\n            <th>Est. Daily Gross</th>\n            <th>Target Stock</th>\n            <th>Restock</th>\n            <th>Pricing</th>\n            <th>Suggested</th>\n          </tr>\n        </thead>\n        <tbody>";
                        try {
                            for (items_1 = __values(items), items_1_1 = items_1.next(); !items_1_1.done; items_1_1 = items_1.next()) {
                                item = items_1_1.value;
                                keyById = String(item.id || '');
                                keyByName = normalizeFieldName(item.name);
                                fromNews = sales.totals.get(keyById) || sales.totals.get(keyByName);
                                sold24 = item.sold24 !== null
                                    ? item.sold24
                                    : (fromNews ? fromNews.sold24 : (item.soldDaily !== null ? item.soldDaily : null));
                                sold7 = item.sold7 !== null
                                    ? item.sold7
                                    : (fromNews ? fromNews.sold7 : null);
                                soldDaily = item.soldDaily !== null
                                    ? item.soldDaily
                                    : (sold24 !== null ? sold24 : (sold7 !== null ? sold7 / 7 : null));
                                lastSoldPrice = (_d = fromNews === null || fromNews === void 0 ? void 0 : fromNews.lastSoldPrice) !== null && _d !== void 0 ? _d : null;
                                averageSoldPrice24 = fromNews && fromNews.pricedUnits24 > 0
                                    ? fromNews.pricedRevenue24 / fromNews.pricedUnits24
                                    : null;
                                rec = restockRecommendation(item.current, sold24, sold7);
                                priceRec = pricingRecommendation(item, sold24, sold7, lastSoldPrice);
                                margin = stockGrossMargin(item.setPrice, item.costEach);
                                marginPct = stockMarginPercent(item.setPrice, item.costEach);
                                daysLeft = stockDaysRemaining(item.current, soldDaily);
                                estDailyGross = margin !== null && soldDaily !== null
                                    ? margin * soldDaily
                                    : null;
                                restockText = rec
                                    ? (rec.restock === null ? '—' : formatNumber(rec.restock))
                                    : '—';
                                lastPriceHtml = lastSoldPrice !== null
                                    ? "".concat(formatCurrency(lastSoldPrice)).concat(averageSoldPrice24 !== null ? "<div class=\"tds-v-dim\">24h avg ".concat(formatCurrency(averageSoldPrice24), "</div>") : '')
                                    : '—';
                                html += "<tr>\n        <td><strong>".concat(escapeHtml(item.name), "</strong>").concat(item.soldTotal !== null ? "<div class=\"tds-v-dim\">Lifetime sold: ".concat(formatNumber(item.soldTotal), "</div>") : '', "</td>\n        <td>").concat(item.costEach === null ? '—' : formatCurrency(item.costEach), "</td>\n        <td>").concat(item.rrp === null ? '—' : formatCurrency(item.rrp), "</td>\n        <td><strong>").concat(item.setPrice === null ? '—' : formatCurrency(item.setPrice), "</strong></td>\n        <td>").concat(lastPriceHtml, "</td>\n        <td>").concat(item.current === null ? '—' : formatNumber(item.current), "</td>\n        <td>").concat(soldDaily === null ? '—' : formatNumber(Math.round(soldDaily)), "</td>\n        <td>").concat(sold24 === null ? '—' : formatNumber(Math.round(sold24)), "</td>\n        <td>").concat(sold7 === null ? '—' : formatNumber(Math.round(sold7)), "</td>\n        <td>").concat(daysLeft === null ? '—' : "".concat(daysLeft.toFixed(1), "d"), "</td>\n        <td>").concat(margin === null ? '—' : "".concat(formatCurrency(margin)).concat(marginPct !== null ? "<div class=\"tds-v-dim\">".concat(marginPct.toFixed(0), "%</div>") : ''), "</td>\n        <td>").concat(estDailyGross === null ? '—' : formatCurrency(estDailyGross), "</td>\n        <td>").concat(rec ? formatNumber(rec.target) : '—', "</td>\n        <td><strong>").concat(restockText, "</strong></td>\n        <td class=\"").concat(priceRec.className, "\">\n          <strong>").concat(escapeHtml(priceRec.action), "</strong>\n          <div class=\"tds-v-dim\" style=\"max-width:240px;white-space:normal;\">").concat(escapeHtml(priceRec.reason), "</div>\n        </td>\n        <td class=\"").concat(priceRec.className, "\"><strong>").concat(priceRec.suggested === null ? '—' : formatCurrency(priceRec.suggested), "</strong></td>\n      </tr>");
                            }
                        }
                        catch (e_24_1) { e_24 = { error: e_24_1 }; }
                        finally {
                            try {
                                if (items_1_1 && !items_1_1.done && (_c = items_1.return)) _c.call(items_1);
                            }
                            finally { if (e_24) throw e_24.error; }
                        }
                        html += "</tbody></table></div>\n      <div class=\"tds-box tds-box-neutral\" style=\"margin-top:10px;\">\n        <strong>Pricing recommendation rules:</strong> recent 24h sales are compared with the 7-day daily average, stock cover is considered, RRP is used when Torn supplies it, and an observed Last Sold Price is used when it can be parsed reliably.\n        A recommendation only moves one dollar from the configured price so the tool stays conservative.\n      </div>\n      <div style=\"margin-top:10px;\">\n        <button class=\"tds-btn-ghost\" id=\"tds-stock-refresh\">Refresh sales</button>\n      </div>";
                        el.innerHTML = html;
                        (_e = el.querySelector('#tds-stock-refresh')) === null || _e === void 0 ? void 0 : _e.addEventListener('click', function () {
                            return renderStockTab(panel, { refresh: true });
                        });
                        return [2 /*return*/];
                }
            });
        });
    }
    // =======================================================================
    // OPTIMIZE TAB — position requirement fit, not a fabricated EE formula
    // =======================================================================
    function findCompanyTypeReferenceNode(reference, typeId) {
        if (!reference || typeId === null || typeId === undefined)
            return null;
        var wanted = String(typeId);
        var seen = new WeakSet();
        var best = null;
        function walk(value) {
            var e_25, _a;
            if (best || !value || typeof value !== 'object' || seen.has(value))
                return;
            seen.add(value);
            if (!Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, wanted)) {
                var candidate = value[wanted];
                if (candidate && typeof candidate === 'object') {
                    best = candidate;
                    return;
                }
            }
            if (!Array.isArray(value)) {
                var id = findValueDeep(value, ['id', 'type_id', 'company_type']);
                if (id !== null && String(id) === wanted) {
                    best = value;
                    return;
                }
            }
            try {
                for (var _b = __values(Object.values(value)), _c = _b.next(); !_c.done; _c = _b.next()) {
                    var child = _c.value;
                    if (child && typeof child === 'object')
                        walk(child);
                    if (best)
                        return;
                }
            }
            catch (e_25_1) { e_25 = { error: e_25_1 }; }
            finally {
                try {
                    if (_c && !_c.done && (_a = _b.return)) _a.call(_b);
                }
                finally { if (e_25) throw e_25.error; }
            }
        }
        walk(reference);
        return best;
    }
    function extractPositionRequirements(reference, typeId) {
        var e_26, _a;
        var root = findCompanyTypeReferenceNode(reference, typeId) || reference;
        if (!root)
            return [];
        var positions = [];
        var seen = new Set();
        try {
            for (var _b = __values(deepObjectEntries(root)), _c = _b.next(); !_c.done; _c = _b.next()) {
                var _d = _c.value, value = _d.value, path = _d.path;
                if (!value || typeof value !== 'object' || Array.isArray(value))
                    continue;
                var name = pickText(value, ['name', 'position', 'position_name', 'title']) || (path.length ? path[path.length - 1] : null);
                var manual = pickNumeric(value, ['manual_labor', 'manual', 'man_required', 'manual_required', 'man']);
                var intelligence = pickNumeric(value, ['intelligence', 'int_required', 'intelligence_required', 'int']);
                var endurance = pickNumeric(value, ['endurance', 'end_required', 'endurance_required', 'end']);
                var statCount = [manual, intelligence, endurance].filter(function (v) { return v !== null && v > 0; }).length;
                if (!name || statCount < 1)
                    continue;
                var key = normalizeFieldName(name);
                if (!key || seen.has(key))
                    continue;
                seen.add(key);
                positions.push({ name: String(name), manual: manual, intelligence: intelligence, endurance: endurance });
            }
        }
        catch (e_26_1) { e_26 = { error: e_26_1 }; }
        finally {
            try {
                if (_c && !_c.done && (_a = _b.return)) _a.call(_b);
            }
            finally { if (e_26) throw e_26.error; }
        }
        return positions;
    }
    function employeePositionFit(emp, position) {
        var e_27, _a;
        var _b, _c, _d;
        var actual = {
            manual: (_b = numericValue(emp.manual_labor)) !== null && _b !== void 0 ? _b : 0,
            intelligence: (_c = numericValue(emp.intelligence)) !== null && _c !== void 0 ? _c : 0,
            endurance: (_d = numericValue(emp.endurance)) !== null && _d !== void 0 ? _d : 0,
        };
        var req = { manual: position.manual, intelligence: position.intelligence, endurance: position.endurance };
        var ratios = [];
        var shortfall = 0;
        var requiredCount = 0;
        try {
            for (var _e = __values(Object.keys(req)), _f = _e.next(); !_f.done; _f = _e.next()) {
                var key = _f.value;
                if (req[key] === null || req[key] <= 0)
                    continue;
                requiredCount += 1;
                var ratio = actual[key] / req[key];
                ratios.push(Math.min(1, ratio));
                shortfall += Math.max(0, req[key] - actual[key]) / req[key];
            }
        }
        catch (e_27_1) { e_27 = { error: e_27_1 }; }
        finally {
            try {
                if (_f && !_f.done && (_a = _e.return)) _a.call(_e);
            }
            finally { if (e_27) throw e_27.error; }
        }
        if (!requiredCount)
            return null;
        var coverage = Math.round((ratios.reduce(function (a, b) { return a + b; }, 0) / requiredCount) * 100);
        return { coverage: coverage, shortfall: shortfall, requiredCount: requiredCount };
    }
    // Official Torn work-stat efficiency formula, applied once per required
    // position stat. Company positions normally use a primary + secondary stat.
    // Exact requirement on both stats therefore gives 90 Working Stats EE.
    function calculatePositionWorkingStats(emp, position) {
        var e_28, _a;
        var _b, _c, _d;
        var actual = {
            manual: (_b = numericValue(emp.manual_labor)) !== null && _b !== void 0 ? _b : 0,
            intelligence: (_c = numericValue(emp.intelligence)) !== null && _c !== void 0 ? _c : 0,
            endurance: (_d = numericValue(emp.endurance)) !== null && _d !== void 0 ? _d : 0,
        };
        var req = {
            manual: numericValue(position.manual),
            intelligence: numericValue(position.intelligence),
            endurance: numericValue(position.endurance),
        };
        var total = 0;
        var used = 0;
        try {
            for (var _e = __values(Object.keys(req)), _f = _e.next(); !_f.done; _f = _e.next()) {
                var key = _f.value;
                var required = req[key];
                if (required === null || required <= 0)
                    continue;
                var stat = Math.max(0, actual[key] || 0);
                var ratio = stat / required;
                var base = Math.min(45, 45 * ratio);
                var overRequirement = ratio > 0 ? Math.max(0, 5 * Math.log2(ratio)) : 0;
                total += Math.floor(base + overRequirement);
                used += 1;
            }
        }
        catch (e_28_1) { e_28 = { error: e_28_1 }; }
        finally {
            try {
                if (_f && !_f.done && (_a = _e.return)) _a.call(_e);
            }
            finally { if (e_28) throw e_28.error; }
        }
        return used ? total : null;
    }
    function estimateEffectivenessAtPosition(emp, ee, position) {
        var workingStats = calculatePositionWorkingStats(emp, position);
        if (workingStats === null)
            return null;
        // Everything except Working Stats is retained from Torn's current Total EE.
        // This automatically preserves Settled In, Director Education, Merits,
        // Addiction, inactivity adjustments, and any future components Torn may add
        // without us needing to guess each field individually.
        var currentWorking = typeof (ee === null || ee === void 0 ? void 0 : ee.workingStats) === 'number' ? ee.workingStats : null;
        var currentTotal = typeof (ee === null || ee === void 0 ? void 0 : ee.total) === 'number' ? ee.total : null;
        var nonPositionAdjustment = currentWorking !== null && currentTotal !== null
            ? currentTotal - currentWorking
            : 0;
        return {
            workingStats: workingStats,
            total: workingStats + nonPositionAdjustment,
            nonPositionAdjustment: nonPositionAdjustment,
        };
    }
    function renderOptimizeTab(panel) {
        var e_29, _a;
        var el = panel.querySelector('[data-tabpanel="optimize"]');
        if (!el)
            return;
        var results = state.lastResults;
        if (!results) {
            el.innerHTML = "<div class=\"tds-box tds-box-neutral\">Run Diagnostics once so Optimize can read your employee working stats and effectiveness.</div>";
            return;
        }
        var employees = extractEmployeesEntries(findRaw(results, 'company', 'employees'));
        var profile = findRaw(results, 'company', 'profile');
        var reference = findRaw(results, 'torn', 'companies');
        var typeId = numericValue(findValueDeep(profile, ['company_type', 'type_id', 'type']));
        var positions = extractPositionRequirements(reference, typeId);
        var html = "<div class=\"tds-box tds-box-info\"><strong>How Employee Effectiveness works:</strong> Current EE is Torn's real employee effectiveness. For each available position, Optimize calculates the Working Stats component using Torn's published work-stat efficiency formula, then carries across the employee's current non-position EE adjustment (Total EE minus Working Stats). The resulting <strong>Estimated EE</strong> is a prediction for comparison, not a live Torn value.</div>";
        if (!employees.length) {
            el.innerHTML = html + "<div class=\"tds-box tds-box-danger\">No employee data is available.</div>";
            return;
        }
        var rows = employees.map(function (employee) {
            var ee = getEmployeeEffectiveness(employee.raw);
            var best = null;
            if (positions.length) {
                var ranked = positions
                    .map(function (position) {
                    var fit = employeePositionFit(employee.raw, position);
                    var estimate = estimateEffectivenessAtPosition(employee.raw, ee, position);
                    return { position: position, fit: fit, estimate: estimate };
                })
                    .filter(function (row) { return row.fit && row.estimate; })
                    .sort(function (a, b) {
                    return b.estimate.total - a.estimate.total ||
                        b.estimate.workingStats - a.estimate.workingStats ||
                        b.fit.coverage - a.fit.coverage ||
                        a.fit.shortfall - b.fit.shortfall;
                });
                best = ranked[0] || null;
            }
            return { employee: employee, ee: ee, best: best };
        }).sort(function (a, b) {
            var _a, _b;
            var av = typeof ((_a = a.ee) === null || _a === void 0 ? void 0 : _a.total) === 'number' ? a.ee.total : Number.POSITIVE_INFINITY;
            var bv = typeof ((_b = b.ee) === null || _b === void 0 ? void 0 : _b.total) === 'number' ? b.ee.total : Number.POSITIVE_INFINITY;
            return av - bv;
        });
        html += "<div class=\"tds-section-label\">Employee effectiveness</div>";
        html += "<div style=\"overflow-x:auto;\">\n      <table class=\"tds-table tds-optimize-table\">\n        <thead>\n          <tr>\n            <th>Employee</th>\n            <th>Current Position</th>\n            <th>Working Stats</th>\n            <th>Settled In</th>\n            <th>Director Ed.</th>\n            <th>Addiction</th>\n            <th>Total EE</th>\n            ".concat(positions.length ? '<th>Best Position</th><th>New Working Stats</th><th>Est. New EE</th><th>Change</th><th>Fit</th>' : '', "\n          </tr>\n        </thead>\n        <tbody>");
        try {
            for (var rows_1 = __values(rows), rows_1_1 = rows_1.next(); !rows_1_1.done; rows_1_1 = rows_1.next()) {
                var row = rows_1_1.value;
                var employee = row.employee, ee = row.ee, best = row.best;
                var currentTotal = typeof (ee === null || ee === void 0 ? void 0 : ee.total) === 'number' ? ee.total : null;
                var estimatedTotal = (best === null || best === void 0 ? void 0 : best.estimate) && typeof best.estimate.total === 'number' ? best.estimate.total : null;
                var delta = currentTotal !== null && estimatedTotal !== null ? estimatedTotal - currentTotal : null;
                var deltaText = delta === null ? '—' : "".concat(delta > 0 ? '+' : '').concat(formatNumber(delta));
                html += "<tr>";
                html += "<td><strong>".concat(escapeHtml(employee.name), "</strong></td>");
                html += "<td>".concat(escapeHtml(employee.position || '—'), "</td>");
                html += "<td>".concat(typeof (ee === null || ee === void 0 ? void 0 : ee.workingStats) === 'number' ? formatNumber(ee.workingStats) : '—', "</td>");
                html += "<td>".concat(typeof (ee === null || ee === void 0 ? void 0 : ee.settledIn) === 'number' ? formatNumber(ee.settledIn) : '—', "</td>");
                html += "<td>".concat(typeof (ee === null || ee === void 0 ? void 0 : ee.directorEducation) === 'number' ? formatNumber(ee.directorEducation) : '—', "</td>");
                html += "<td>".concat(typeof (ee === null || ee === void 0 ? void 0 : ee.addiction) === 'number' ? formatNumber(ee.addiction) : '—', "</td>");
                html += "<td><strong>".concat(currentTotal !== null ? formatNumber(currentTotal) : '—', "</strong></td>");
                if (positions.length) {
                    html += "<td>".concat(best ? escapeHtml(best.position.name) : '—', "</td>");
                    html += "<td>".concat((best === null || best === void 0 ? void 0 : best.estimate) ? formatNumber(best.estimate.workingStats) : '—', "</td>");
                    html += "<td><strong>".concat(estimatedTotal !== null ? formatNumber(estimatedTotal) : '—', "</strong></td>");
                    html += "<td><strong>".concat(deltaText, "</strong></td>");
                    html += "<td>".concat(best ? "".concat(best.fit.coverage, "%") : '—', "</td>");
                }
                html += "</tr>";
            }
        }
        catch (e_29_1) { e_29 = { error: e_29_1 }; }
        finally {
            try {
                if (rows_1_1 && !rows_1_1.done && (_a = rows_1.return)) _a.call(rows_1);
            }
            finally { if (e_29) throw e_29.error; }
        }
        html += "</tbody></table></div>";
        if (!positions.length) {
            html += "<div class=\"tds-box tds-box-warn\" style=\"margin-top:10px;\">No reliable position requirement data was found for company type ".concat(escapeHtml(String(typeId !== null && typeId !== void 0 ? typeId : 'unknown')), ", so Optimize is showing Torn's real current effectiveness values without inventing position recommendations.</div>");
        }
        else {
            html += "<div class=\"tds-box tds-box-neutral\" style=\"margin-top:10px;\">\n        <strong>Estimated EE:</strong> the target position's calculated Working Stats EE plus the employee's current non-position adjustment.\n        This preserves bonuses/penalties already reflected in Torn's Total EE while changing only the position-dependent Working Stats component.\n        Rows remain sorted by current <strong>Total EE, lowest first</strong>.\n      </div>";
        }
        el.innerHTML = html;
    }
    // -----------------------------------------------------------------------
    // TRAINING / ROTATIONAL DEBT HELPERS
    // -----------------------------------------------------------------------
    function normalizePersonName(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/<[^>]*>/g, '')
            .replace(/[^a-z0-9]+/g, ' ')
            .trim()
            .replace(/\s+/g, ' ');
    }
    function parseTrainingEvent(entry, employees) {
        var e_30, _a;
        if (!entry)
            return null;
        var raw = entry.raw || {};
        var text = String(entry.text || '');
        if (!/\btrain(?:ed|ing|s)?\b/i.test(text))
            return null;
        // Structured recipient fields are preferred. Avoid a plain `user_id`
        // first because some log shapes use it for the director/trainer.
        var structuredId = pickNumeric(raw, [
            'employee_id', 'target_id', 'recipient_id', 'trained_id',
            'employee', 'target', 'recipient'
        ]);
        var structuredName = pickText(raw, [
            'employee_name', 'target_name', 'recipient_name', 'trained_name',
            'employee', 'target', 'recipient'
        ]);
        var employee = null;
        if (structuredId !== null) {
            employee = employees.find(function (e) { return String(e.id) === String(structuredId); }) || null;
        }
        if (!employee && structuredName) {
            var wanted_1 = normalizePersonName(structuredName);
            employee = employees.find(function (e) { return normalizePersonName(e.name) === wanted_1; }) || null;
        }
        // Most Torn company-news/log messages include the recipient's visible
        // name. Match longest names first so one employee's name does not become
        // a substring match inside another employee's name.
        if (!employee) {
            var normalizedText_1 = normalizePersonName(text);
            var byLength = __spreadArray([], __read(employees), false).sort(function (a, b) { return String(b.name).length - String(a.name).length; });
            employee = byLength.find(function (e) {
                var n = normalizePersonName(e.name);
                return n && (" ".concat(normalizedText_1, " ")).includes(" ".concat(n, " "));
            }) || null;
        }
        if (!employee)
            return null;
        var quantity = pickNumeric(raw, [
            'quantity', 'qty', 'count', 'trains', 'train_count', 'amount'
        ]);
        if (quantity === null) {
            var patterns = [
                /(\d[\d,]*)\s+trains?\b/i,
                /\btrains?\s*[x×:]?\s*(\d[\d,]*)\b/i,
                /\btrained\b.*?\b(\d[\d,]*)\s+times?\b/i,
            ];
            try {
                for (var patterns_2 = __values(patterns), patterns_2_1 = patterns_2.next(); !patterns_2_1.done; patterns_2_1 = patterns_2.next()) {
                    var pattern = patterns_2_1.value;
                    var m = text.match(pattern);
                    if (!m)
                        continue;
                    quantity = Number(String(m[1]).replace(/,/g, ''));
                    break;
                }
            }
            catch (e_30_1) { e_30 = { error: e_30_1 }; }
            finally {
                try {
                    if (patterns_2_1 && !patterns_2_1.done && (_a = patterns_2.return)) _a.call(patterns_2);
                }
                finally { if (e_30) throw e_30.error; }
            }
        }
        // A normal Torn "trained employee" event represents one train unless an
        // explicit quantity is present.
        if (quantity === null)
            quantity = 1;
        if (!Number.isFinite(quantity) || quantity <= 0)
            return null;
        return {
            eventId: String(entry.id || ''),
            timestamp: Number(entry.timestamp),
            employeeId: String(employee.id),
            employeeName: employee.name,
            quantity: quantity,
            text: text,
        };
    }
    function collectTrainingEvents(raw, employees) {
        var e_31, _a;
        var sourceEntries = flattenNewsEntries(raw);
        var events = [];
        var seen = new Set();
        try {
            for (var sourceEntries_1 = __values(sourceEntries), sourceEntries_1_1 = sourceEntries_1.next(); !sourceEntries_1_1.done; sourceEntries_1_1 = sourceEntries_1.next()) {
                var entry = sourceEntries_1_1.value;
                var parsed = parseTrainingEvent(entry, employees);
                if (!parsed)
                    continue;
                var key = parsed.eventId
                    ? "id:".concat(parsed.eventId)
                    : "".concat(parsed.timestamp, "|").concat(parsed.employeeId, "|").concat(parsed.quantity);
                if (seen.has(key))
                    continue;
                seen.add(key);
                events.push(parsed);
            }
        }
        catch (e_31_1) { e_31 = { error: e_31_1 }; }
        finally {
            try {
                if (sourceEntries_1_1 && !sourceEntries_1_1.done && (_a = sourceEntries_1.return)) _a.call(sourceEntries_1);
            }
            finally { if (e_31) throw e_31.error; }
        }
        events.sort(function (a, b) { return b.timestamp - a.timestamp; });
        return { sourceEntries: sourceEntries, events: events };
    }
    function mergeTrainingEventSources(primary, secondary) {
        var e_32, _a;
        var rows = __spreadArray(__spreadArray([], __read((primary || [])), false), __read((secondary || [])), false).sort(function (a, b) { return b.timestamp - a.timestamp; });
        var merged = [];
        var _loop_4 = function (event) {
            // The same train can appear in both company/news and user/log with
            // different event IDs. Treat matching employee/quantity within a
            // two-second window as the same action.
            var duplicate = merged.some(function (existing) {
                return existing.employeeId === event.employeeId &&
                    existing.quantity === event.quantity &&
                    Math.abs(existing.timestamp - event.timestamp) <= 2;
            });
            if (!duplicate)
                merged.push(event);
        };
        try {
            for (var rows_2 = __values(rows), rows_2_1 = rows_2.next(); !rows_2_1.done; rows_2_1 = rows_2.next()) {
                var event = rows_2_1.value;
                _loop_4(event);
            }
        }
        catch (e_32_1) { e_32 = { error: e_32_1 }; }
        finally {
            try {
                if (rows_2_1 && !rows_2_1.done && (_a = rows_2.return)) _a.call(rows_2);
            }
            finally { if (e_32) throw e_32.error; }
        }
        return merged;
    }
    function formatTrainingCoverage(timestamp) {
        if (!timestamp)
            return 'Unknown';
        var ms = Number(timestamp) * 1000;
        var days = Math.max(0, Math.floor((Date.now() - ms) / 86400000));
        if (days < 1)
            return 'Less than 1 day';
        return "".concat(formatNumber(days), " day").concat(days === 1 ? '' : 's');
    }
    function calculateRotationalDebt(employees, events, coverageStart) {
        var e_33, _a, e_34, _b;
        var now = Math.floor(Date.now() / 1000);
        var THREE_DAYS = 3 * 86400;
        var actualByEmployee = new Map();
        var lastTrainByEmployee = new Map();
        var trains7ByEmployee = new Map();
        var trains30ByEmployee = new Map();
        var sevenAgo = now - 7 * 86400;
        var thirtyAgo = now - 30 * 86400;
        try {
            for (var events_1 = __values(events), events_1_1 = events_1.next(); !events_1_1.done; events_1_1 = events_1.next()) {
                var event = events_1_1.value;
                var id = String(event.employeeId);
                actualByEmployee.set(id, (actualByEmployee.get(id) || 0) + event.quantity);
                var prev = lastTrainByEmployee.get(id);
                if (!prev || event.timestamp > prev)
                    lastTrainByEmployee.set(id, event.timestamp);
                if (event.timestamp >= sevenAgo) {
                    trains7ByEmployee.set(id, (trains7ByEmployee.get(id) || 0) + event.quantity);
                }
                if (event.timestamp >= thirtyAgo) {
                    trains30ByEmployee.set(id, (trains30ByEmployee.get(id) || 0) + event.quantity);
                }
            }
        }
        catch (e_33_1) { e_33 = { error: e_33_1 }; }
        finally {
            try {
                if (events_1_1 && !events_1_1.done && (_a = events_1.return)) _a.call(events_1);
            }
            finally { if (e_33) throw e_33.error; }
        }
        var rows = employees.map(function (employee) {
            var _a, _b;
            var days = (_b = numericValue((_a = employee.raw) === null || _a === void 0 ? void 0 : _a.days_in_company)) !== null && _b !== void 0 ? _b : 0;
            var joinedAt = now - Math.max(0, days) * 86400;
            var eligibleAt = joinedAt + THREE_DAYS;
            var fairStart = Math.max(coverageStart || now, eligibleAt);
            var eligibleSeconds = Math.max(0, now - fairStart);
            var eligibleWeight = eligibleSeconds / 86400;
            return {
                employee: employee,
                eligibleWeight: eligibleWeight,
                actual: actualByEmployee.get(String(employee.id)) || 0,
                lastTrain: lastTrainByEmployee.get(String(employee.id)) || null,
                trains7: trains7ByEmployee.get(String(employee.id)) || 0,
                trains30: trains30ByEmployee.get(String(employee.id)) || 0,
            };
        });
        var totalObserved = rows.reduce(function (sum, row) { return sum + row.actual; }, 0);
        var totalWeight = rows.reduce(function (sum, row) { return sum + row.eligibleWeight; }, 0);
        try {
            for (var rows_3 = __values(rows), rows_3_1 = rows_3.next(); !rows_3_1.done; rows_3_1 = rows_3.next()) {
                var row = rows_3_1.value;
                row.expected = totalWeight > 0
                    ? totalObserved * (row.eligibleWeight / totalWeight)
                    : 0;
                row.debt = row.expected - row.actual;
            }
        }
        catch (e_34_1) { e_34 = { error: e_34_1 }; }
        finally {
            try {
                if (rows_3_1 && !rows_3_1.done && (_b = rows_3.return)) _b.call(rows_3);
            }
            finally { if (e_34) throw e_34.error; }
        }
        rows.sort(function (a, b) {
            return b.debt - a.debt ||
                (a.lastTrain || 0) - (b.lastTrain || 0) ||
                String(a.employee.name).localeCompare(String(b.employee.name));
        });
        return { rows: rows, totalObserved: totalObserved, totalWeight: totalWeight };
    }
    function fetchTrainingHistorySources(results) {
        return __awaiter(this, void 0, void 0, function () {
            var diagnosticNews, diagnosticLog, newsRaw, logRaw, newsError, logError, err_7;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        diagnosticNews = findRaw(results, 'company', 'news');
                        diagnosticLog = findRaw(results, 'user', 'log');
                        newsRaw = diagnosticNews;
                        logRaw = diagnosticLog;
                        newsError = null;
                        logError = null;
                        if (!!newsRaw) return [3 /*break*/, 4];
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, fetchCompanyNewsForStock()];
                    case 2:
                        // Reuse the already rate-limited/cached company news helper. It asks
                        // Torn for a recent history window and gracefully falls back when
                        // from/to are not accepted by a particular API shape.
                        newsRaw = _a.sent();
                        return [3 /*break*/, 4];
                    case 3:
                        err_7 = _a.sent();
                        newsError = err_7;
                        return [3 /*break*/, 4];
                    case 4:
                        // `user/log` remains a fallback/second source because directors' personal
                        // logs can contain the same training actions. Do not make an extra request
                        // here if Diagnostics did not already return it.
                        if (!logRaw) {
                            logError = findBlockedReason(results, 'user', 'log');
                        }
                        return [2 /*return*/, { newsRaw: newsRaw, logRaw: logRaw, newsError: newsError, logError: logError }];
                }
            });
        });
    }
    // =======================================================================
    // TRAINING TAB
    // =======================================================================
    function renderTrainingTab(panel) {
        return __awaiter(this, void 0, void 0, function () {
            var el, results, employeesRaw, employees, profile, mode, html, ratingValue, withEE;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        el = panel.querySelector('[data-tabpanel="training"]');
                        results = state.lastResults;
                        if (!results) {
                            el.innerHTML = "<div class=\"tds-box tds-box-neutral\">Run Diagnostics first \u2014 Training reads the employee roster and training-history sources.</div>";
                            return [2 /*return*/];
                        }
                        employeesRaw = findRaw(results, 'company', 'employees');
                        employees = extractEmployeesEntries(employeesRaw);
                        profile = findRaw(results, 'company', 'profile');
                        mode = state.trainingMode || 'priority';
                        html = "\n      <div class=\"tds-segmented\">\n        <div class=\"tds-segment ".concat(mode === 'priority' ? 'tds-segment-active' : '', "\" data-trainmode=\"priority\">PRIORITY</div>\n        <div class=\"tds-segment ").concat(mode === 'rotational' ? 'tds-segment-active' : '', "\" data-trainmode=\"rotational\">ROTATIONAL / DEBT</div>\n      </div>");
                        if (employees.length === 0) {
                            html += "<div class=\"tds-box tds-box-danger\">Employee roster unavailable, so there\u2019s nothing to build a training queue from.</div>";
                            el.innerHTML = html;
                            return [2 /*return*/];
                        }
                        ratingValue = numericValue(findValueDeep(profile, ['rating', 'star_rating', 'stars']));
                        html += "<div class=\"tds-box tds-box-neutral\">\n      ".concat(ratingValue !== null ? "Current company rating: <strong>".concat(escapeHtml(String(ratingValue)), "\u2605</strong>. ") : '', "\n      Rotational debt below is based on <strong>observed trains actually given</strong>, not an assumed star-rating budget. This keeps the queue fair if ratings, staffing, saved trains or training-role bonuses changed during the period.\n    </div>");
                        if (!(mode === 'priority')) return [3 /*break*/, 1];
                        html += "<div class=\"tds-box tds-box-info\">\n        Sorted by <strong>current effectiveness, lowest first</strong>. This mode answers \u201Cwho currently needs EE help most?\u201D; Rotational / Debt answers \u201Cwho has received less than their fair share of actual trains?\u201D\n      </div>";
                        withEE = employees.map(function (e) { return (__assign(__assign({}, e), { ee: findEffectivenessField(e.raw) })); });
                        withEE.sort(function (a, b) { var _a, _b, _c, _d; return ((_b = (_a = a.ee) === null || _a === void 0 ? void 0 : _a.value) !== null && _b !== void 0 ? _b : Infinity) - ((_d = (_c = b.ee) === null || _c === void 0 ? void 0 : _c.value) !== null && _d !== void 0 ? _d : Infinity); });
                        html += '<div class="tds-section-label">Priority queue</div><div class="tds-card">';
                        withEE.forEach(function (e, i) {
                            html += "\n          <div class=\"tds-employee-row\">\n            <div class=\"tds-employee-top\">\n              <div>\n                <div class=\"tds-employee-name\">".concat(i === 0 ? '▶ ' : '').concat(escapeHtml(String(e.name)), "</div>\n                <div class=\"tds-employee-meta\">").concat(escapeHtml(String(e.position)), "</div>\n              </div>\n              <div class=\"tds-row-value\">").concat(e.ee ? e.ee.value : '<span class="tds-v-dim">no EE field</span>', "</div>\n            </div>\n          </div>");
                        });
                        html += '</div>';
                        return [3 /*break*/, 3];
                    case 1:
                        html += "<div class=\"tds-box tds-box-neutral\" id=\"tds-training-loading\">\n        Reading Torn training history and calculating fair-share debt\u2026\n      </div>";
                        el.innerHTML = html;
                        bindTrainingModeButtons(panel);
                        return [4 /*yield*/, renderRotationalDebt(panel, employees, results)];
                    case 2:
                        _a.sent();
                        return [2 /*return*/];
                    case 3:
                        el.innerHTML = html;
                        bindTrainingModeButtons(panel);
                        return [2 /*return*/];
                }
            });
        });
    }
    function bindTrainingModeButtons(panel) {
        var el = panel.querySelector('[data-tabpanel="training"]');
        if (!el)
            return;
        el.querySelectorAll('[data-trainmode]').forEach(function (seg) {
            seg.addEventListener('click', function () {
                state.trainingMode = seg.dataset.trainmode;
                el.querySelectorAll('[data-trainmode]').forEach(function (button) {
                    button.classList.toggle('tds-segment-active', button === seg);
                });
                renderTrainingTab(panel).catch(function (err) {
                    console.error('[TDS] Training tab render failed:', err);
                });
            });
        });
    }
    function renderRotationalDebt(panel, employees, results) {
        return __awaiter(this, void 0, void 0, function () {
            var el, sources, err_8, newsParsed, logParsed, events, allSourceEntries, coverageStart, loading, detail, debt, next, html;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        el = panel.querySelector('[data-tabpanel="training"]');
                        if (!el || state.trainingMode !== 'rotational')
                            return [2 /*return*/];
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, fetchTrainingHistorySources(results)];
                    case 2:
                        sources = _a.sent();
                        return [3 /*break*/, 4];
                    case 3:
                        err_8 = _a.sent();
                        el.innerHTML += "<div class=\"tds-box tds-box-danger\"><strong>Training history failed:</strong> ".concat(escapeHtml(String(err_8.reason || err_8.message || err_8)), "</div>");
                        return [2 /*return*/];
                    case 4:
                        newsParsed = collectTrainingEvents(sources.newsRaw, employees);
                        logParsed = collectTrainingEvents(sources.logRaw, employees);
                        events = mergeTrainingEventSources(newsParsed.events, logParsed.events);
                        allSourceEntries = __spreadArray(__spreadArray([], __read(newsParsed.sourceEntries), false), __read(logParsed.sourceEntries), false);
                        coverageStart = allSourceEntries.length
                            ? Math.min.apply(Math, __spreadArray([], __read(allSourceEntries.map(function (entry) { return Number(entry.timestamp); }).filter(Number.isFinite)), false)) : null;
                        loading = el.querySelector('#tds-training-loading');
                        if (loading)
                            loading.remove();
                        if (!events.length) {
                            detail = '';
                            if (newsParsed.sourceEntries.length || logParsed.sourceEntries.length) {
                                detail = "Torn history was readable (".concat(formatNumber(newsParsed.sourceEntries.length + logParsed.sourceEntries.length), " entries inspected), but no employee-training events were recognised.");
                            }
                            else {
                                detail = 'No readable company-news or user-log history was returned.';
                            }
                            el.insertAdjacentHTML('beforeend', "\n        <div class=\"tds-box tds-box-warn\">\n          <strong>No training events matched yet.</strong> ".concat(escapeHtml(detail), "\n          The parser deliberately refuses to invent train counts. If you have recently trained an employee, send me the Training tab after that action and we can map Torn\u2019s exact live event wording/fields.\n        </div>\n        <div class=\"tds-card\">\n          <div class=\"tds-row\"><span class=\"tds-row-label\">Company-news entries inspected</span><span class=\"tds-row-value\">").concat(formatNumber(newsParsed.sourceEntries.length), "</span></div>\n          <div class=\"tds-row\"><span class=\"tds-row-label\">User-log entries inspected</span><span class=\"tds-row-value\">").concat(formatNumber(logParsed.sourceEntries.length), "</span></div>\n        </div>\n      "));
                            return [2 /*return*/];
                        }
                        debt = calculateRotationalDebt(employees, events, coverageStart);
                        next = debt.rows.find(function (row) { return row.eligibleWeight > 0; }) || null;
                        html = "\n      <div class=\"tds-box tds-box-info\">\n        <strong>Rotational / Debt is live.</strong>\n        It found <strong>".concat(formatNumber(events.reduce(function (sum, event) { return sum + event.quantity; }, 0)), "</strong> train(s) across\n        ").concat(formatTrainingCoverage(coverageStart), " of returned history.\n        Fair share is weighted by how long each current employee was eligible during that same history window.\n      </div>");
                        if (next) {
                            html += "\n        <div class=\"tds-box ".concat(next.debt > 0.05 ? 'tds-box-warn' : 'tds-box-info', "\">\n          <strong>Train next:</strong> ").concat(escapeHtml(String(next.employee.name)), "\n          ").concat(next.debt > 0.05 ? " \u2014 approximately <strong>".concat(next.debt.toFixed(2), "</strong> train(s) behind their fair share.") : ' — the rotation is currently close to balanced.', "\n        </div>");
                        }
                        html += "\n      <div class=\"tds-card\">\n        <div class=\"tds-row\"><span class=\"tds-row-label\">Training events recognised</span><span class=\"tds-row-value\">".concat(formatNumber(events.length), "</span></div>\n        <div class=\"tds-row\"><span class=\"tds-row-label\">Trains represented</span><span class=\"tds-row-value\">").concat(formatNumber(debt.totalObserved), "</span></div>\n        <div class=\"tds-row\"><span class=\"tds-row-label\">History coverage</span><span class=\"tds-row-value\">").concat(escapeHtml(formatTrainingCoverage(coverageStart)), "</span></div>\n        <div class=\"tds-row\"><span class=\"tds-row-label\">Company-news entries inspected</span><span class=\"tds-row-value\">").concat(formatNumber(newsParsed.sourceEntries.length), "</span></div>\n        <div class=\"tds-row\"><span class=\"tds-row-label\">User-log entries inspected</span><span class=\"tds-row-value\">").concat(formatNumber(logParsed.sourceEntries.length), "</span></div>\n      </div>\n\n      <div class=\"tds-section-label\">Rotational queue</div>\n      <div style=\"overflow-x:auto;\">\n        <table class=\"tds-table tds-training-debt-table\">\n          <thead>\n            <tr>\n              <th>#</th>\n              <th>Employee</th>\n              <th>Position</th>\n              <th>Eligible Days*</th>\n              <th>Received</th>\n              <th>Fair Share</th>\n              <th>Debt</th>\n              <th>Last 7d</th>\n              <th>Last 30d</th>\n              <th>Last Train</th>\n            </tr>\n          </thead>\n          <tbody>");
                        debt.rows.forEach(function (row, index) {
                            var debtClass = row.debt > 0.05
                                ? 'tds-v-bad'
                                : row.debt < -0.05
                                    ? 'tds-v-good'
                                    : '';
                            var debtText = "".concat(row.debt > 0 ? '+' : '').concat(row.debt.toFixed(2));
                            var lastTrain = row.lastTrain ? formatTimestampRelative(row.lastTrain) : 'None in history';
                            html += "\n        <tr>\n          <td>".concat(index + 1, "</td>\n          <td><strong>").concat(index === 0 ? '▶ ' : '').concat(escapeHtml(String(row.employee.name)), "</strong></td>\n          <td>").concat(escapeHtml(String(row.employee.position || '—')), "</td>\n          <td>").concat(row.eligibleWeight.toFixed(1), "</td>\n          <td>").concat(formatNumber(row.actual), "</td>\n          <td>").concat(row.expected.toFixed(2), "</td>\n          <td class=\"").concat(debtClass, "\"><strong>").concat(debtText, "</strong></td>\n          <td>").concat(formatNumber(row.trains7), "</td>\n          <td>").concat(formatNumber(row.trains30), "</td>\n          <td>").concat(escapeHtml(lastTrain), "</td>\n        </tr>");
                        });
                        html += "\n          </tbody>\n        </table>\n      </div>\n\n      <div class=\"tds-box tds-box-neutral\" style=\"margin-top:10px;\">\n        <strong>How debt is calculated:</strong> actual trains observed in Torn history are distributed as a fair-share target across current employees, weighted by eligible time in the same returned history window. Employees are treated as training-eligible after their first 3 days. <strong>Debt = Fair Share \u2212 Received.</strong>\n        Positive/red means owed trains; negative/green means ahead of the rotation.\n        <br><br>\n        *Eligible Days is limited to the history Torn actually returned \u2014 this is not presented as an all-time figure unless the returned history genuinely covers the employee\u2019s full tenure.\n      </div>";
                        el.insertAdjacentHTML('beforeend', html);
                        return [2 /*return*/];
                }
            });
        });
    }
    // =======================================================================
    // COMPARE TAB
    // =======================================================================
    var BENCHMARK_CACHE_TTL_MS = 4 * 60 * 60 * 1000;
    function getOwnCompanyCompareInfo(profile, results) {
        var e_35, _a, e_36, _b;
        var _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q;
        if (!profile || typeof profile !== 'object') {
            return { id: null, name: null, typeId: null, typeName: null, rating: null };
        }
        var candidates = [profile];
        try {
            for (var _r = __values(['company', 'profile', 'data']), _s = _r.next(); !_s.done; _s = _r.next()) {
                var key = _s.value;
                if (profile[key] && typeof profile[key] === 'object' && !Array.isArray(profile[key])) {
                    candidates.push(profile[key]);
                }
            }
        }
        catch (e_35_1) { e_35 = { error: e_35_1 }; }
        finally {
            try {
                if (_s && !_s.done && (_a = _r.return)) _a.call(_r);
            }
            finally { if (e_35) throw e_35.error; }
        }
        var id = null;
        var name = null;
        var typeId = null;
        var typeName = null;
        var rating = null;
        try {
            for (var candidates_2 = __values(candidates), candidates_2_1 = candidates_2.next(); !candidates_2_1.done; candidates_2_1 = candidates_2.next()) {
                var obj = candidates_2_1.value;
                if (id === null) {
                    id = numericValue((_d = (_c = obj.id) !== null && _c !== void 0 ? _c : obj.company_id) !== null && _d !== void 0 ? _d : obj.companyId);
                }
                if (!name) {
                    var nameValue = (_f = (_e = obj.name) !== null && _e !== void 0 ? _e : obj.company_name) !== null && _f !== void 0 ? _f : obj.companyName;
                    if (nameValue !== null && nameValue !== undefined && String(nameValue).trim()) {
                        name = String(nameValue).trim();
                    }
                }
                if (rating === null) {
                    rating = numericValue((_h = (_g = obj.rating) !== null && _g !== void 0 ? _g : obj.star_rating) !== null && _h !== void 0 ? _h : obj.stars);
                }
                var typeValue = (_l = (_k = (_j = obj.company_type) !== null && _j !== void 0 ? _j : obj.type_id) !== null && _k !== void 0 ? _k : obj.companyType) !== null && _l !== void 0 ? _l : obj.type;
                if (typeValue && typeof typeValue === 'object') {
                    if (typeId === null)
                        typeId = numericValue((_o = (_m = typeValue.id) !== null && _m !== void 0 ? _m : typeValue.type_id) !== null && _o !== void 0 ? _o : typeValue.type);
                    if (!typeName)
                        typeName = (_q = (_p = typeValue.name) !== null && _p !== void 0 ? _p : typeValue.type_name) !== null && _q !== void 0 ? _q : null;
                }
                else if (typeId === null) {
                    typeId = numericValue(typeValue);
                }
            }
        }
        catch (e_36_1) { e_36 = { error: e_36_1 }; }
        finally {
            try {
                if (candidates_2_1 && !candidates_2_1.done && (_b = candidates_2.return)) _b.call(candidates_2);
            }
            finally { if (e_36) throw e_36.error; }
        }
        if (typeId === null) {
            typeId = numericValue(findValueDeep(profile, ['company_type', 'type_id', 'companyType']));
        }
        if (rating === null) {
            rating = numericValue(findValueDeep(profile, ['rating', 'star_rating', 'stars']));
        }
        if (typeId !== null && !typeName) {
            typeName = resolveCompanyTypeName(findRaw(results, 'torn', 'companies'), typeId);
        }
        if (!name) {
            var deepName = findValueDeep(profile, ['name', 'company_name', 'companyName']);
            if (deepName !== null && deepName !== undefined && String(deepName).trim()) {
                name = String(deepName).trim();
            }
        }
        return { id: id, name: name, typeId: typeId, typeName: typeName, rating: rating };
    }
    function buildCompareFilters(typeId, tier, ownRating) {
        var filters = ["type:Equal:".concat(typeId)];
        if (tier === 'same' && ownRating !== null) {
            filters.push("rating:=:".concat(ownRating));
        }
        else if (tier === 'mid') {
            filters.push('rating:>=:3', 'rating:<=:5');
        }
        else if (tier === 'top') {
            filters.push('rating:>=:8', 'rating:<=:10');
        }
        return filters.join(',');
    }
    function fetchBenchmarkCompanies(typeId_1, tier_1, ownRating_1) {
        return __awaiter(this, arguments, void 0, function (typeId, tier, ownRating, offset) {
            var filters;
            if (offset === void 0) { offset = 0; }
            return __generator(this, function (_a) {
                filters = buildCompareFilters(typeId, tier, ownRating);
                return [2 /*return*/, ApiClient.callV2('company/search', {
                        filters: filters,
                        limit: 100,
                        offset: offset,
                        striptags: 'true',
                    })];
            });
        });
    }
    function extractCompareCompanies(data) {
        var e_37, _a;
        if (!data || typeof data !== 'object')
            return [];
        try {
            for (var _b = __values(['companies', 'company_search', 'results', 'data']), _c = _b.next(); !_c.done; _c = _b.next()) {
                var key = _c.value;
                var value = data[key];
                if (Array.isArray(value))
                    return value;
                if (value && typeof value === 'object' && !Array.isArray(value)) {
                    var values = Object.values(value).filter(function (x) { return x && typeof x === 'object'; });
                    if (values.length)
                        return values;
                }
            }
        }
        catch (e_37_1) { e_37 = { error: e_37_1 }; }
        finally {
            try {
                if (_c && !_c.done && (_a = _b.return)) _a.call(_b);
            }
            finally { if (e_37) throw e_37.error; }
        }
        var seen = new WeakSet();
        var found = null;
        function walk(value) {
            var e_38, _a;
            if (found || !value || typeof value !== 'object' || seen.has(value))
                return;
            seen.add(value);
            if (Array.isArray(value) && value.length && value.every(function (x) { return x && typeof x === 'object'; })) {
                var keys = new Set(value.flatMap(function (x) { return Object.keys(x); }));
                if (__spreadArray([], __read(keys), false).some(function (k) { return /company|name|daily.*income|weekly.*income|rating/i.test(k); })) {
                    found = value;
                    return;
                }
            }
            try {
                for (var _b = __values(Object.values(value)), _c = _b.next(); !_c.done; _c = _b.next()) {
                    var child = _c.value;
                    if (child && typeof child === 'object')
                        walk(child);
                    if (found)
                        return;
                }
            }
            catch (e_38_1) { e_38 = { error: e_38_1 }; }
            finally {
                try {
                    if (_c && !_c.done && (_a = _b.return)) _a.call(_b);
                }
                finally { if (e_38) throw e_38.error; }
            }
        }
        walk(data);
        return found || [];
    }
    function compareField(row, names, pattern) {
        var e_39, _a;
        if (pattern === void 0) { pattern = null; }
        if (!row || typeof row !== 'object')
            return null;
        try {
            for (var names_3 = __values(names), names_3_1 = names_3.next(); !names_3_1.done; names_3_1 = names_3.next()) {
                var name = names_3_1.value;
                if (Object.prototype.hasOwnProperty.call(row, name) &&
                    row[name] !== null &&
                    row[name] !== undefined) {
                    return row[name];
                }
            }
        }
        catch (e_39_1) { e_39 = { error: e_39_1 }; }
        finally {
            try {
                if (names_3_1 && !names_3_1.done && (_a = names_3.return)) _a.call(names_3);
            }
            finally { if (e_39) throw e_39.error; }
        }
        if (pattern) {
            var entry = Object.entries(row).find(function (_a) {
                var _b = __read(_a, 2), k = _b[0], v = _b[1];
                return pattern.test(k) && v !== null && v !== undefined;
            });
            if (entry)
                return entry[1];
        }
        return null;
    }
    function normalizeCompareCompany(row) {
        return {
            raw: row,
            id: numericValue(compareField(row, ['id', 'company_id', 'companyId'], /^id$|company.*id/i)),
            name: compareField(row, ['name', 'company_name', 'companyName'], /^name$|company.*name/i),
            rating: numericValue(compareField(row, ['rating', 'stars', 'star_rating', 'starRating'], /^rating$|^stars$|star.*rating/i)),
            dailyIncome: numericValue(compareField(row, ['daily_income', 'dailyIncome'], /daily.*income/i)),
            weeklyIncome: numericValue(compareField(row, ['weekly_income', 'weeklyIncome'], /weekly.*income/i)),
            dailyCustomers: numericValue(compareField(row, ['daily_customers', 'dailyCustomers'], /daily.*customer/i)),
            weeklyCustomers: numericValue(compareField(row, ['weekly_customers', 'weeklyCustomers'], /weekly.*customer/i)),
            employees: numericValue(compareField(row, ['employees', 'employees_current', 'employeesCurrent'], /^employees$|employees.*current/i)),
        };
    }
    function compareTierLabel(tier, ownRating) {
        if (tier === 'same')
            return ownRating !== null ? "Same Rating (".concat(ownRating, "\u2605)") : 'Same Rating';
        if (tier === 'mid')
            return '3–5★';
        if (tier === 'top')
            return '8–10★';
        return 'All Ratings';
    }
    function parseCsvLine(line) {
        var out = [];
        var value = '';
        var quoted = false;
        for (var i = 0; i < line.length; i += 1) {
            var ch = line[i];
            if (ch === '"') {
                if (quoted && line[i + 1] === '"') {
                    value += '"';
                    i += 1;
                }
                else {
                    quoted = !quoted;
                }
            }
            else if (ch === ',' && !quoted) {
                out.push(value);
                value = '';
            }
            else {
                value += ch;
            }
        }
        out.push(value);
        return out;
    }
    function normalizeCsvHeader(value) {
        return String(value || '')
            .trim()
            .toLowerCase()
            .replace(/^\uFEFF/, '')
            .replace(/[\s-]+/g, '_');
    }
    function parseCompanySnapshotCsv(csvText) {
        var lines = String(csvText || '')
            .split(/\r?\n/)
            .filter(function (line) { return line.trim().length > 0; });
        if (lines.length < 2)
            return [];
        var headers = parseCsvLine(lines[0]).map(normalizeCsvHeader);
        var rows = [];
        var _loop_5 = function (i) {
            var values = parseCsvLine(lines[i]);
            var row = {};
            headers.forEach(function (header, index) {
                var _a;
                row[header] = (_a = values[index]) !== null && _a !== void 0 ? _a : '';
            });
            rows.push(row);
        };
        for (var i = 1; i < lines.length; i += 1) {
            _loop_5(i);
        }
        return rows;
    }
    function snapshotNumber(row, names) {
        var e_40, _a;
        try {
            for (var names_4 = __values(names), names_4_1 = names_4.next(); !names_4_1.done; names_4_1 = names_4.next()) {
                var name = names_4_1.value;
                if (!Object.prototype.hasOwnProperty.call(row, name))
                    continue;
                var raw = row[name];
                if (raw === '' || raw === null || raw === undefined)
                    continue;
                var cleaned = String(raw).replace(/[$,\s]/g, '');
                var n = Number(cleaned);
                if (Number.isFinite(n))
                    return n;
            }
        }
        catch (e_40_1) { e_40 = { error: e_40_1 }; }
        finally {
            try {
                if (names_4_1 && !names_4_1.done && (_a = names_4.return)) _a.call(names_4);
            }
            finally { if (e_40) throw e_40.error; }
        }
        return null;
    }
    function snapshotCompanyId(row) {
        return snapshotNumber(row, ['id', 'company_id', 'companyid']);
    }
    function getCompanySnapshotMap() {
        return __awaiter(this, arguments, void 0, function (_a) {
            var cached, ttl, csv, rows, map, rows_4, rows_4_1, row, id;
            var e_41, _b;
            var _c = _a === void 0 ? {} : _a, _d = _c.force, force = _d === void 0 ? false : _d;
            return __generator(this, function (_e) {
                switch (_e.label) {
                    case 0:
                        cached = state.benchmark.snapshot;
                        ttl = 30 * 60 * 1000;
                        if (!force && cached && Date.now() - cached.timestamp < ttl) {
                            return [2 /*return*/, cached.map];
                        }
                        return [4 /*yield*/, ApiClient.callV2Text('company/snapshot')];
                    case 1:
                        csv = _e.sent();
                        rows = parseCompanySnapshotCsv(csv);
                        map = new Map();
                        try {
                            for (rows_4 = __values(rows), rows_4_1 = rows_4.next(); !rows_4_1.done; rows_4_1 = rows_4.next()) {
                                row = rows_4_1.value;
                                id = snapshotCompanyId(row);
                                if (id === null)
                                    continue;
                                map.set(String(id), {
                                    dailyIncome: snapshotNumber(row, ['daily_income', 'dailyincome']),
                                    weeklyIncome: snapshotNumber(row, ['weekly_income', 'weeklyincome']),
                                    dailyCustomers: snapshotNumber(row, ['daily_customers', 'dailycustomers']),
                                    weeklyCustomers: snapshotNumber(row, ['weekly_customers', 'weeklycustomers']),
                                });
                            }
                        }
                        catch (e_41_1) { e_41 = { error: e_41_1 }; }
                        finally {
                            try {
                                if (rows_4_1 && !rows_4_1.done && (_b = rows_4.return)) _b.call(rows_4);
                            }
                            finally { if (e_41) throw e_41.error; }
                        }
                        state.benchmark.snapshot = {
                            timestamp: Date.now(),
                            map: map,
                        };
                        return [2 /*return*/, map];
                }
            });
        });
    }
    function mergeCompareFinancials(rows, snapshotMap) {
        if (!snapshotMap || !snapshotMap.size)
            return rows;
        return rows.map(function (row) {
            var _a, _b, _c, _d;
            if (row.id === null)
                return row;
            var snap = snapshotMap.get(String(row.id));
            if (!snap)
                return row;
            return __assign(__assign({}, row), { dailyIncome: (_a = row.dailyIncome) !== null && _a !== void 0 ? _a : snap.dailyIncome, weeklyIncome: (_b = row.weeklyIncome) !== null && _b !== void 0 ? _b : snap.weeklyIncome, dailyCustomers: (_c = row.dailyCustomers) !== null && _c !== void 0 ? _c : snap.dailyCustomers, weeklyCustomers: (_d = row.weeklyCustomers) !== null && _d !== void 0 ? _d : snap.weeklyCustomers });
        });
    }
    function renderBenchmarkTab(panel) {
        var el = panel.querySelector('[data-tabpanel="benchmark"]');
        var results = state.lastResults;
        var profile = results ? findRaw(results, 'company', 'profile') : null;
        var own = getOwnCompanyCompareInfo(profile, results);
        var typeLabel = own.typeName
            ? "".concat(escapeHtml(String(own.typeName)), " (").concat(escapeHtml(String(own.typeId)), ")")
            : own.typeId !== null
                ? "Company type ".concat(escapeHtml(String(own.typeId)))
                : 'Not detected';
        var html = "\n      <div class=\"tds-box tds-box-neutral\">\n        Compare uses Torn API v2's <code>/company/search</code> endpoint so company type,\n        star rating and financial/customer comparison fields come from the same search response.\n        This comparison does not require director access.\n      </div>\n\n      <div class=\"tds-card\">\n        <div class=\"tds-row\">\n          <span class=\"tds-row-label\">Detected company type</span>\n          <span class=\"tds-row-value\">".concat(typeLabel, "</span>\n        </div>\n        ").concat(own.rating !== null
            ? "<div class=\"tds-row\"><span class=\"tds-row-label\">Your rating</span><span class=\"tds-row-value\">".concat(escapeHtml(String(own.rating)), "\u2605</span></div>")
            : '', "\n      </div>\n\n      <div class=\"tds-segmented\">\n        <div class=\"tds-segment ").concat(state.benchmark.tier === 'same' ? 'tds-segment-active' : '', "\" data-tier=\"same\">SAME RATING").concat(own.rating !== null ? " (".concat(own.rating, "\u2605)") : '', "</div>\n        <div class=\"tds-segment ").concat(state.benchmark.tier === 'mid' ? 'tds-segment-active' : '', "\" data-tier=\"mid\">3\u20135\u2605</div>\n        <div class=\"tds-segment ").concat(state.benchmark.tier === 'top' ? 'tds-segment-active' : '', "\" data-tier=\"top\">8\u201310\u2605 TOP</div>\n        <div class=\"tds-segment ").concat(state.benchmark.tier === 'all' ? 'tds-segment-active' : '', "\" data-tier=\"all\">ALL RATINGS</div>\n      </div>\n\n      <button class=\"tds-btn\" id=\"tds-bench-reload\">\u21BB Refresh Compare</button>\n      <div id=\"tds-bench-results\" style=\"margin-top:10px;\"></div>\n    ");
        el.innerHTML = html;
        el.querySelectorAll('[data-tier]').forEach(function (seg) {
            seg.addEventListener('click', function () {
                state.benchmark.tier = seg.dataset.tier;
                el.querySelectorAll('[data-tier]').forEach(function (button) {
                    button.classList.toggle('tds-segment-active', button === seg);
                });
                runBenchmark(panel);
            });
        });
        el.querySelector('#tds-bench-reload').addEventListener('click', function () {
            return runBenchmark(panel, { force: true });
        });
        if (own.typeId === null) {
            el.querySelector('#tds-bench-results').innerHTML =
                "<div class=\"tds-box tds-box-warn\">I couldn't detect your company type ID from company/profile, so Compare cannot build the Torn search filter.</div>";
            return;
        }
        if (state.benchmark.tier === 'same' && own.rating === null) {
            state.benchmark.tier = 'all';
            el.querySelectorAll('[data-tier]').forEach(function (button) {
                button.classList.toggle('tds-segment-active', button.dataset.tier === 'all');
            });
        }
        setTimeout(function () { return runBenchmark(panel); }, 0);
    }
    function runBenchmark(panel_1) {
        return __awaiter(this, arguments, void 0, function (panel, _a) {
            var el, results, profile, own, resultsEl, tier, cacheKey, cached, data, err_9, permissionHint;
            var _b, _c;
            var _d = _a === void 0 ? {} : _a, _e = _d.force, force = _e === void 0 ? false : _e;
            return __generator(this, function (_f) {
                switch (_f.label) {
                    case 0:
                        el = panel.querySelector('[data-tabpanel="benchmark"]');
                        if (!el)
                            return [2 /*return*/];
                        results = state.lastResults;
                        profile = results ? findRaw(results, 'company', 'profile') : null;
                        own = getOwnCompanyCompareInfo(profile, results);
                        resultsEl = el.querySelector('#tds-bench-results');
                        if (own.typeId === null) {
                            if (resultsEl) {
                                resultsEl.innerHTML =
                                    "<div class=\"tds-box tds-box-warn\">Company type could not be detected.</div>";
                            }
                            return [2 /*return*/];
                        }
                        tier = state.benchmark.tier || 'same';
                        cacheKey = "".concat(own.typeId, ":").concat(tier, ":").concat(tier === 'same' ? (_b = own.rating) !== null && _b !== void 0 ? _b : 'unknown' : '');
                        cached = state.benchmark.cache[cacheKey];
                        if (!force &&
                            cached &&
                            Date.now() - cached.timestamp < BENCHMARK_CACHE_TTL_MS) {
                            renderBenchmarkResults(panel, cached.data, own, tier);
                            return [2 /*return*/];
                        }
                        if (resultsEl) {
                            resultsEl.innerHTML =
                                "<div class=\"tds-box tds-box-neutral\">Fetching ".concat(escapeHtml(String(own.typeName || "company type ".concat(own.typeId))), " \u2014 ").concat(escapeHtml(compareTierLabel(tier, own.rating)), "\u2026</div>");
                        }
                        _f.label = 1;
                    case 1:
                        _f.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, fetchBenchmarkCompanies(own.typeId, tier, own.rating, 0)];
                    case 2:
                        data = _f.sent();
                        state.benchmark.cache[cacheKey] = {
                            timestamp: Date.now(),
                            data: data,
                        };
                        renderBenchmarkResults(panel, data, own, tier);
                        return [3 /*break*/, 4];
                    case 3:
                        err_9 = _f.sent();
                        if (!resultsEl)
                            return [2 /*return*/];
                        permissionHint = err_9.code === 16
                            ? "<br><br><strong>Custom-key note:</strong> your current key may not include Company \u2192 Search. Generate the updated Custom API Key from Settings once."
                            : '';
                        resultsEl.innerHTML =
                            "<div class=\"tds-box tds-box-danger\"><strong>Compare fetch failed:</strong> Torn error ".concat((_c = err_9.code) !== null && _c !== void 0 ? _c : '', ": ").concat(escapeHtml(String(err_9.reason || 'unknown')), ".").concat(permissionHint, "</div>");
                        return [3 /*break*/, 4];
                    case 4: return [2 /*return*/];
                }
            });
        });
    }
    function averageNumeric(values) {
        var nums = values.filter(function (v) { return typeof v === 'number' && Number.isFinite(v); });
        if (!nums.length)
            return null;
        return nums.reduce(function (sum, value) { return sum + value; }, 0) / nums.length;
    }
    function medianNumeric(values) {
        var nums = values
            .filter(function (v) { return typeof v === 'number' && Number.isFinite(v); })
            .sort(function (a, b) { return a - b; });
        if (!nums.length)
            return null;
        var mid = Math.floor(nums.length / 2);
        return nums.length % 2
            ? nums[mid]
            : (nums[mid - 1] + nums[mid]) / 2;
    }
    function percentageDifference(value, baseline) {
        if (typeof value !== 'number' || typeof baseline !== 'number' || baseline === 0)
            return null;
        return ((value - baseline) / baseline) * 100;
    }
    function formatSignedPercent(value, digits) {
        if (digits === void 0) { digits = 1; }
        if (typeof value !== 'number' || !Number.isFinite(value))
            return '—';
        return "".concat(value > 0 ? '+' : '').concat(value.toFixed(digits), "%");
    }
    function formatPercentile(rank, total) {
        if (!rank || !total || total < 1)
            return '—';
        if (total === 1)
            return '100th';
        var percentile = Math.round(((total - rank) / (total - 1)) * 100);
        return "".concat(percentile, "th percentile");
    }
    function revenuePerCustomer(income, customers) {
        if (typeof income !== 'number' || typeof customers !== 'number' || customers <= 0)
            return null;
        return income / customers;
    }
    function compareValueClass(value, baseline) {
        if (typeof value !== 'number' || typeof baseline !== 'number')
            return '';
        return value >= baseline ? 'tds-v-good' : 'tds-v-bad';
    }
    function normalizeCompanyNameForMatch(value) {
        return String(value || '')
            .trim()
            .toLowerCase()
            .replace(/\s+/g, ' ');
    }
    function isOwnCompareCompany(row, own) {
        if (!row || !own)
            return false;
        if (own.id !== null && row.id !== null &&
            String(row.id) === String(own.id)) {
            return true;
        }
        var ownName = normalizeCompanyNameForMatch(own.name);
        var rowName = normalizeCompanyNameForMatch(row.name);
        return Boolean(ownName && rowName && ownName === rowName);
    }
    function renderBenchmarkResults(panel, data, own, tier) {
        return __awaiter(this, void 0, void 0, function () {
            var el, rawRows, rows, needsSnapshot, snapshotUsed, snapshotError, snapshotMap, err_10, filtered, usableRows, hasDailyIncome, hasWeeklyIncome, hasDailyCustomers, hasWeeklyCustomers, metric, metricLabel, sorted, ownIndex, ownRow, currentResults, ownProfile, ownDetailed, ownCombined, hasAnyOwnValue, weeklyIncomeValues, dailyIncomeValues, weeklyCustomerValues, dailyCustomerValues, avgWeeklyIncome, medianWeeklyIncome, avgDailyIncome, medianDailyIncome, avgWeeklyCustomers, medianWeeklyCustomers, avgDailyCustomers, medianDailyCustomers, totalWeeklyIncome, ownWeeklyIncome, ownDailyIncome, ownWeeklyCustomers, ownDailyCustomers, incomeAbove, incomeLeader, ownMetricValue, gapToAbove, gapToLeader, ownWeeklyRpc, ownDailyRpc, weeklyRpcRows, dailyRpcRows, avgWeeklyRpc, medianWeeklyRpc, avgDailyRpc, ownWeeklyRpcIndex, weeklyCustomerRankRows, ownWeeklyCustomerIndex, html, effectiveOwnIndex, resolvedOwnIndex, targetRows, targetRows_1, targetRows_1_1, target, targetValue, needed, pctNeeded, availableFinancialFields;
            var e_42, _a;
            var _b, _c, _d, _e, _f, _g, _h, _j, _k;
            return __generator(this, function (_l) {
                switch (_l.label) {
                    case 0:
                        el = panel.querySelector('[data-tabpanel="benchmark"] #tds-bench-results');
                        if (!el)
                            return [2 /*return*/];
                        rawRows = extractCompareCompanies(data);
                        rows = rawRows.map(normalizeCompareCompany);
                        if (!rows.length) {
                            el.innerHTML = "\n        <div class=\"tds-card\">\n          <div class=\"tds-row\"><span class=\"tds-row-label\">Company type</span><span class=\"tds-row-value\">".concat(escapeHtml(String(own.typeName || own.typeId)), "</span></div>\n          <div class=\"tds-row\"><span class=\"tds-row-label\">Selected rating</span><span class=\"tds-row-value\">").concat(escapeHtml(compareTierLabel(tier, own.rating)), "</span></div>\n          <div class=\"tds-row\"><span class=\"tds-row-label\">Companies returned</span><span class=\"tds-row-value\">0</span></div>\n        </div>\n        <div class=\"tds-box tds-box-neutral\">Torn returned no companies matching this search filter.</div>");
                            return [2 /*return*/];
                        }
                        needsSnapshot = rows.some(function (row) {
                            return row.dailyIncome === null ||
                                row.weeklyIncome === null ||
                                row.dailyCustomers === null ||
                                row.weeklyCustomers === null;
                        });
                        snapshotUsed = false;
                        snapshotError = null;
                        if (!needsSnapshot) return [3 /*break*/, 4];
                        _l.label = 1;
                    case 1:
                        _l.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, getCompanySnapshotMap()];
                    case 2:
                        snapshotMap = _l.sent();
                        rows = mergeCompareFinancials(rows, snapshotMap);
                        snapshotUsed = true;
                        return [3 /*break*/, 4];
                    case 3:
                        err_10 = _l.sent();
                        snapshotError = err_10;
                        console.warn('[TDS] Compare snapshot financial enrichment failed:', err_10);
                        return [3 /*break*/, 4];
                    case 4:
                        filtered = rows.filter(function (row) {
                            if (tier === 'all')
                                return true;
                            if (row.rating === null)
                                return true;
                            if (tier === 'same') {
                                return own.rating === null || row.rating === own.rating;
                            }
                            if (tier === 'mid')
                                return row.rating >= 3 && row.rating <= 5;
                            if (tier === 'top')
                                return row.rating >= 8 && row.rating <= 10;
                            return true;
                        });
                        usableRows = filtered.length ? filtered : rows;
                        hasDailyIncome = usableRows.some(function (r) { return r.dailyIncome !== null; });
                        hasWeeklyIncome = usableRows.some(function (r) { return r.weeklyIncome !== null; });
                        hasDailyCustomers = usableRows.some(function (r) { return r.dailyCustomers !== null; });
                        hasWeeklyCustomers = usableRows.some(function (r) { return r.weeklyCustomers !== null; });
                        metric = hasWeeklyIncome
                            ? 'weeklyIncome'
                            : hasDailyIncome
                                ? 'dailyIncome'
                                : null;
                        metricLabel = metric === 'weeklyIncome'
                            ? 'Weekly Income'
                            : metric === 'dailyIncome'
                                ? 'Daily Income'
                                : 'Company';
                        sorted = __spreadArray([], __read(usableRows), false).sort(function (a, b) {
                            var _a, _b;
                            if (!metric)
                                return String(a.name || '').localeCompare(String(b.name || ''));
                            return ((_a = b[metric]) !== null && _a !== void 0 ? _a : -1) - ((_b = a[metric]) !== null && _b !== void 0 ? _b : -1);
                        });
                        ownIndex = sorted.findIndex(function (row) { return isOwnCompareCompany(row, own); });
                        ownRow = ownIndex >= 0 ? sorted[ownIndex] : null;
                        // If company/search does not include our own row, still build "Your Company"
                        // from the already-loaded company profile/detailed response. This makes the
                        // summary visible even when Torn's search result set omits the current company.
                        if (!ownRow) {
                            currentResults = state.lastResults;
                            ownProfile = currentResults ? findRaw(currentResults, 'company', 'profile') : null;
                            ownDetailed = currentResults ? findRaw(currentResults, 'company', 'detailed') : null;
                            ownCombined = __assign(__assign({}, (ownProfile || {})), (ownDetailed || {}));
                            ownRow = {
                                id: own.id,
                                name: own.name,
                                rating: own.rating,
                                dailyIncome: numericValue(findValueDeep(ownCombined, ['daily_income', 'dailyIncome'])),
                                weeklyIncome: numericValue(findValueDeep(ownCombined, ['weekly_income', 'weeklyIncome'])),
                                dailyCustomers: numericValue(findValueDeep(ownCombined, ['daily_customers', 'dailyCustomers'])),
                                weeklyCustomers: numericValue(findValueDeep(ownCombined, ['weekly_customers', 'weeklyCustomers'])),
                                employees: null,
                                raw: ownCombined,
                            };
                            hasAnyOwnValue = ownRow.dailyIncome !== null ||
                                ownRow.weeklyIncome !== null ||
                                ownRow.dailyCustomers !== null ||
                                ownRow.weeklyCustomers !== null;
                            if (!hasAnyOwnValue)
                                ownRow = null;
                        }
                        weeklyIncomeValues = usableRows.map(function (r) { return r.weeklyIncome; });
                        dailyIncomeValues = usableRows.map(function (r) { return r.dailyIncome; });
                        weeklyCustomerValues = usableRows.map(function (r) { return r.weeklyCustomers; });
                        dailyCustomerValues = usableRows.map(function (r) { return r.dailyCustomers; });
                        avgWeeklyIncome = averageNumeric(weeklyIncomeValues);
                        medianWeeklyIncome = medianNumeric(weeklyIncomeValues);
                        avgDailyIncome = averageNumeric(dailyIncomeValues);
                        medianDailyIncome = medianNumeric(dailyIncomeValues);
                        avgWeeklyCustomers = averageNumeric(weeklyCustomerValues);
                        medianWeeklyCustomers = medianNumeric(weeklyCustomerValues);
                        avgDailyCustomers = averageNumeric(dailyCustomerValues);
                        medianDailyCustomers = medianNumeric(dailyCustomerValues);
                        totalWeeklyIncome = weeklyIncomeValues
                            .filter(function (v) { return typeof v === 'number' && Number.isFinite(v); })
                            .reduce(function (sum, v) { return sum + v; }, 0);
                        ownWeeklyIncome = (_b = ownRow === null || ownRow === void 0 ? void 0 : ownRow.weeklyIncome) !== null && _b !== void 0 ? _b : null;
                        ownDailyIncome = (_c = ownRow === null || ownRow === void 0 ? void 0 : ownRow.dailyIncome) !== null && _c !== void 0 ? _c : null;
                        ownWeeklyCustomers = (_d = ownRow === null || ownRow === void 0 ? void 0 : ownRow.weeklyCustomers) !== null && _d !== void 0 ? _d : null;
                        ownDailyCustomers = (_e = ownRow === null || ownRow === void 0 ? void 0 : ownRow.dailyCustomers) !== null && _e !== void 0 ? _e : null;
                        incomeAbove = ownIndex > 0 ? (_g = (_f = sorted[ownIndex - 1]) === null || _f === void 0 ? void 0 : _f[metric]) !== null && _g !== void 0 ? _g : null : null;
                        incomeLeader = sorted.length ? (_j = (_h = sorted[0]) === null || _h === void 0 ? void 0 : _h[metric]) !== null && _j !== void 0 ? _j : null : null;
                        ownMetricValue = ownRow && metric ? ownRow[metric] : null;
                        gapToAbove = typeof incomeAbove === 'number' && typeof ownMetricValue === 'number'
                            ? Math.max(0, incomeAbove - ownMetricValue)
                            : null;
                        gapToLeader = typeof incomeLeader === 'number' && typeof ownMetricValue === 'number'
                            ? Math.max(0, incomeLeader - ownMetricValue)
                            : null;
                        ownWeeklyRpc = revenuePerCustomer(ownWeeklyIncome, ownWeeklyCustomers);
                        ownDailyRpc = revenuePerCustomer(ownDailyIncome, ownDailyCustomers);
                        weeklyRpcRows = usableRows
                            .map(function (r) { return ({
                            row: r,
                            value: revenuePerCustomer(r.weeklyIncome, r.weeklyCustomers),
                        }); })
                            .filter(function (x) { return typeof x.value === 'number'; })
                            .sort(function (a, b) { return b.value - a.value; });
                        dailyRpcRows = usableRows
                            .map(function (r) { return ({
                            row: r,
                            value: revenuePerCustomer(r.dailyIncome, r.dailyCustomers),
                        }); })
                            .filter(function (x) { return typeof x.value === 'number'; })
                            .sort(function (a, b) { return b.value - a.value; });
                        avgWeeklyRpc = averageNumeric(weeklyRpcRows.map(function (x) { return x.value; }));
                        medianWeeklyRpc = medianNumeric(weeklyRpcRows.map(function (x) { return x.value; }));
                        avgDailyRpc = averageNumeric(dailyRpcRows.map(function (x) { return x.value; }));
                        ownWeeklyRpcIndex = weeklyRpcRows.findIndex(function (x) {
                            return isOwnCompareCompany(x.row, own);
                        });
                        weeklyCustomerRankRows = usableRows
                            .filter(function (r) { return typeof r.weeklyCustomers === 'number'; })
                            .sort(function (a, b) { return b.weeklyCustomers - a.weeklyCustomers; });
                        ownWeeklyCustomerIndex = weeklyCustomerRankRows.findIndex(function (r) {
                            return isOwnCompareCompany(r, own);
                        });
                        html = "<div class=\"tds-card\">";
                        html += "<div class=\"tds-row\"><span class=\"tds-row-label\">Company type</span><span class=\"tds-row-value\">".concat(escapeHtml(String(own.typeName || own.typeId))).concat(own.typeName ? " (".concat(escapeHtml(String(own.typeId)), ")") : '', "</span></div>");
                        html += "<div class=\"tds-row\"><span class=\"tds-row-label\">Selected rating</span><span class=\"tds-row-value\">".concat(escapeHtml(compareTierLabel(tier, own.rating)), "</span></div>");
                        html += "<div class=\"tds-row\"><span class=\"tds-row-label\">Companies returned</span><span class=\"tds-row-value\">".concat(formatNumber(sorted.length), "</span></div>");
                        if (ownIndex >= 0 && metric) {
                            html += "<div class=\"tds-row\"><span class=\"tds-row-label\">Your rank by ".concat(metricLabel, "</span><span class=\"tds-row-value\">#").concat(ownIndex + 1, " / ").concat(sorted.length, " \u00B7 ").concat(formatPercentile(ownIndex + 1, sorted.length), "</span></div>");
                        }
                        html += "</div>";
                        if (ownRow) {
                            html += "<div class=\"tds-section-label\">Your company</div><div class=\"tds-card\">";
                            html += "<div class=\"tds-row\"><span class=\"tds-row-label\">Company</span><span class=\"tds-row-value\">".concat(escapeHtml(String(own.name || ownRow.name || 'Your company')), "</span></div>");
                            if (ownWeeklyIncome !== null) {
                                html += "<div class=\"tds-row\"><span class=\"tds-row-label\">Weekly income</span><span class=\"tds-row-value ".concat(compareValueClass(ownWeeklyIncome, avgWeeklyIncome), "\">").concat(formatMoney(ownWeeklyIncome), "</span></div>");
                                html += "<div class=\"tds-row\"><span class=\"tds-row-label\">vs weekly average</span><span class=\"tds-row-value ".concat(compareValueClass(ownWeeklyIncome, avgWeeklyIncome), "\">").concat(formatSignedPercent(percentageDifference(ownWeeklyIncome, avgWeeklyIncome)), "</span></div>");
                                html += "<div class=\"tds-row\"><span class=\"tds-row-label\">vs weekly median</span><span class=\"tds-row-value ".concat(compareValueClass(ownWeeklyIncome, medianWeeklyIncome), "\">").concat(formatSignedPercent(percentageDifference(ownWeeklyIncome, medianWeeklyIncome)), "</span></div>");
                            }
                            if (ownDailyIncome !== null) {
                                html += "<div class=\"tds-row\"><span class=\"tds-row-label\">Daily income</span><span class=\"tds-row-value ".concat(compareValueClass(ownDailyIncome, avgDailyIncome), "\">").concat(formatMoney(ownDailyIncome), "</span></div>");
                                html += "<div class=\"tds-row\"><span class=\"tds-row-label\">vs daily average</span><span class=\"tds-row-value ".concat(compareValueClass(ownDailyIncome, avgDailyIncome), "\">").concat(formatSignedPercent(percentageDifference(ownDailyIncome, avgDailyIncome)), "</span></div>");
                            }
                            if (ownWeeklyCustomers !== null) {
                                html += "<div class=\"tds-row\"><span class=\"tds-row-label\">Weekly customers</span><span class=\"tds-row-value ".concat(compareValueClass(ownWeeklyCustomers, avgWeeklyCustomers), "\">").concat(formatNumber(ownWeeklyCustomers), "</span></div>");
                                html += "<div class=\"tds-row\"><span class=\"tds-row-label\">vs weekly-customer average</span><span class=\"tds-row-value ".concat(compareValueClass(ownWeeklyCustomers, avgWeeklyCustomers), "\">").concat(formatSignedPercent(percentageDifference(ownWeeklyCustomers, avgWeeklyCustomers)), "</span></div>");
                            }
                            if (ownDailyCustomers !== null) {
                                html += "<div class=\"tds-row\"><span class=\"tds-row-label\">Daily customers</span><span class=\"tds-row-value ".concat(compareValueClass(ownDailyCustomers, avgDailyCustomers), "\">").concat(formatNumber(ownDailyCustomers), "</span></div>");
                            }
                            if (ownWeeklyRpc !== null) {
                                html += "<div class=\"tds-row\"><span class=\"tds-row-label\">Weekly revenue / customer</span><span class=\"tds-row-value ".concat(compareValueClass(ownWeeklyRpc, avgWeeklyRpc), "\">").concat(formatMoney(ownWeeklyRpc), "</span></div>");
                                html += "<div class=\"tds-row\"><span class=\"tds-row-label\">vs efficiency average</span><span class=\"tds-row-value ".concat(compareValueClass(ownWeeklyRpc, avgWeeklyRpc), "\">").concat(formatSignedPercent(percentageDifference(ownWeeklyRpc, avgWeeklyRpc)), "</span></div>");
                            }
                            if (ownIndex >= 0 && metric) {
                                html += "<div class=\"tds-row\"><span class=\"tds-row-label\">".concat(metricLabel, " rank</span><span class=\"tds-row-value\">#").concat(ownIndex + 1, " / ").concat(sorted.length, "</span></div>");
                                html += "<div class=\"tds-row\"><span class=\"tds-row-label\">Percentile</span><span class=\"tds-row-value\">".concat(formatPercentile(ownIndex + 1, sorted.length), "</span></div>");
                            }
                            if (ownWeeklyCustomerIndex >= 0) {
                                html += "<div class=\"tds-row\"><span class=\"tds-row-label\">Weekly customer rank</span><span class=\"tds-row-value\">#".concat(ownWeeklyCustomerIndex + 1, " / ").concat(weeklyCustomerRankRows.length, "</span></div>");
                            }
                            if (ownWeeklyRpcIndex >= 0) {
                                html += "<div class=\"tds-row\"><span class=\"tds-row-label\">Revenue / customer rank</span><span class=\"tds-row-value\">#".concat(ownWeeklyRpcIndex + 1, " / ").concat(weeklyRpcRows.length, "</span></div>");
                            }
                            html += "</div>";
                        }
                        if (ownRow && metric && typeof ownMetricValue === 'number') {
                            effectiveOwnIndex = ownIndex >= 0
                                ? ownIndex
                                : sorted.findIndex(function (row) { return typeof row[metric] === 'number' && row[metric] <= ownMetricValue; });
                            resolvedOwnIndex = effectiveOwnIndex >= 0 ? effectiveOwnIndex : sorted.length;
                            targetRows = [
                                { label: 'Next position', index: resolvedOwnIndex > 0 ? resolvedOwnIndex - 1 : null },
                                { label: 'Top 10', index: sorted.length >= 10 ? 9 : null },
                                { label: 'Top 5', index: sorted.length >= 5 ? 4 : null },
                                { label: '#1', index: sorted.length >= 1 ? 0 : null },
                            ];
                            html += "<div class=\"tds-section-label\">Targets</div><div class=\"tds-card\">";
                            try {
                                for (targetRows_1 = __values(targetRows), targetRows_1_1 = targetRows_1.next(); !targetRows_1_1.done; targetRows_1_1 = targetRows_1.next()) {
                                    target = targetRows_1_1.value;
                                    if (target.index === null || target.index < 0 || target.index >= sorted.length) {
                                        continue;
                                    }
                                    // If we're already above a target rank, report it as achieved.
                                    if (resolvedOwnIndex <= target.index) {
                                        html += "<div class=\"tds-row\"><span class=\"tds-row-label\">".concat(target.label, "</span><span class=\"tds-row-value tds-v-good\">Achieved</span></div>");
                                        continue;
                                    }
                                    targetValue = (_k = sorted[target.index]) === null || _k === void 0 ? void 0 : _k[metric];
                                    if (typeof targetValue !== 'number')
                                        continue;
                                    needed = Math.max(0, targetValue - ownMetricValue + 1);
                                    pctNeeded = ownMetricValue > 0 ? (needed / ownMetricValue) * 100 : null;
                                    html += "<div class=\"tds-row\"><span class=\"tds-row-label\">".concat(target.label, "</span><span class=\"tds-row-value\">").concat(formatMoney(needed)).concat(pctNeeded !== null ? " (".concat(pctNeeded.toFixed(1), "%)") : '', "</span></div>");
                                }
                            }
                            catch (e_42_1) { e_42 = { error: e_42_1 }; }
                            finally {
                                try {
                                    if (targetRows_1_1 && !targetRows_1_1.done && (_a = targetRows_1.return)) _a.call(targetRows_1);
                                }
                                finally { if (e_42) throw e_42.error; }
                            }
                            html += "<div class=\"tds-row\"><span class=\"tds-row-label\">Target metric</span><span class=\"tds-row-value\">".concat(escapeHtml(metricLabel), "</span></div>");
                            html += "</div>";
                        }
                        if (hasWeeklyIncome || hasDailyIncome) {
                            html += "<div class=\"tds-section-label\">Income performance</div><div class=\"tds-card\">";
                            if (hasWeeklyIncome) {
                                html += "<div class=\"tds-row\"><span class=\"tds-row-label\">Average weekly income</span><span class=\"tds-row-value\">".concat(avgWeeklyIncome !== null ? formatMoney(avgWeeklyIncome) : '—', "</span></div>");
                                html += "<div class=\"tds-row\"><span class=\"tds-row-label\">Median weekly income</span><span class=\"tds-row-value\">".concat(medianWeeklyIncome !== null ? formatMoney(medianWeeklyIncome) : '—', "</span></div>");
                                if (ownWeeklyIncome !== null) {
                                    html += "<div class=\"tds-row\"><span class=\"tds-row-label\">Your weekly income vs average</span><span class=\"tds-row-value ".concat(compareValueClass(ownWeeklyIncome, avgWeeklyIncome), "\">").concat(formatSignedPercent(percentageDifference(ownWeeklyIncome, avgWeeklyIncome)), "</span></div>");
                                    html += "<div class=\"tds-row\"><span class=\"tds-row-label\">Your weekly income vs median</span><span class=\"tds-row-value ".concat(compareValueClass(ownWeeklyIncome, medianWeeklyIncome), "\">").concat(formatSignedPercent(percentageDifference(ownWeeklyIncome, medianWeeklyIncome)), "</span></div>");
                                    if (totalWeeklyIncome > 0) {
                                        html += "<div class=\"tds-row\"><span class=\"tds-row-label\">Share of returned weekly income</span><span class=\"tds-row-value\">".concat(((ownWeeklyIncome / totalWeeklyIncome) * 100).toFixed(2), "%</span></div>");
                                    }
                                }
                            }
                            if (hasDailyIncome) {
                                html += "<div class=\"tds-row\"><span class=\"tds-row-label\">Average daily income</span><span class=\"tds-row-value\">".concat(avgDailyIncome !== null ? formatMoney(avgDailyIncome) : '—', "</span></div>");
                                html += "<div class=\"tds-row\"><span class=\"tds-row-label\">Median daily income</span><span class=\"tds-row-value\">".concat(medianDailyIncome !== null ? formatMoney(medianDailyIncome) : '—', "</span></div>");
                            }
                            if (ownIndex >= 0 && metric) {
                                html += "<div class=\"tds-row\"><span class=\"tds-row-label\">Gap to company above you</span><span class=\"tds-row-value\">".concat(gapToAbove !== null ? (gapToAbove === 0 ? 'You are #1' : formatMoney(gapToAbove)) : '—', "</span></div>");
                                html += "<div class=\"tds-row\"><span class=\"tds-row-label\">Gap to #1</span><span class=\"tds-row-value\">".concat(gapToLeader !== null ? (gapToLeader === 0 ? 'You are #1' : formatMoney(gapToLeader)) : '—', "</span></div>");
                            }
                            html += "</div>";
                        }
                        if (hasWeeklyCustomers || hasDailyCustomers) {
                            html += "<div class=\"tds-section-label\">Customer performance</div><div class=\"tds-card\">";
                            if (hasWeeklyCustomers) {
                                html += "<div class=\"tds-row\"><span class=\"tds-row-label\">Average weekly customers</span><span class=\"tds-row-value\">".concat(avgWeeklyCustomers !== null ? formatNumber(Math.round(avgWeeklyCustomers)) : '—', "</span></div>");
                                html += "<div class=\"tds-row\"><span class=\"tds-row-label\">Median weekly customers</span><span class=\"tds-row-value\">".concat(medianWeeklyCustomers !== null ? formatNumber(Math.round(medianWeeklyCustomers)) : '—', "</span></div>");
                                if (ownWeeklyCustomerIndex >= 0) {
                                    html += "<div class=\"tds-row\"><span class=\"tds-row-label\">Your weekly-customer rank</span><span class=\"tds-row-value\">#".concat(ownWeeklyCustomerIndex + 1, " / ").concat(weeklyCustomerRankRows.length, "</span></div>");
                                }
                            }
                            if (hasDailyCustomers) {
                                html += "<div class=\"tds-row\"><span class=\"tds-row-label\">Average daily customers</span><span class=\"tds-row-value\">".concat(avgDailyCustomers !== null ? formatNumber(Math.round(avgDailyCustomers)) : '—', "</span></div>");
                                html += "<div class=\"tds-row\"><span class=\"tds-row-label\">Median daily customers</span><span class=\"tds-row-value\">".concat(medianDailyCustomers !== null ? formatNumber(Math.round(medianDailyCustomers)) : '—', "</span></div>");
                            }
                            html += "</div>";
                        }
                        if ((hasWeeklyIncome && hasWeeklyCustomers) || (hasDailyIncome && hasDailyCustomers)) {
                            html += "<div class=\"tds-section-label\">Revenue efficiency</div><div class=\"tds-card\">";
                            if (hasWeeklyIncome && hasWeeklyCustomers) {
                                html += "<div class=\"tds-row\"><span class=\"tds-row-label\">Average weekly revenue / customer</span><span class=\"tds-row-value\">".concat(avgWeeklyRpc !== null ? formatMoney(avgWeeklyRpc) : '—', "</span></div>");
                                html += "<div class=\"tds-row\"><span class=\"tds-row-label\">Median weekly revenue / customer</span><span class=\"tds-row-value\">".concat(medianWeeklyRpc !== null ? formatMoney(medianWeeklyRpc) : '—', "</span></div>");
                                if (ownWeeklyRpc !== null) {
                                    html += "<div class=\"tds-row\"><span class=\"tds-row-label\">Your weekly revenue / customer</span><span class=\"tds-row-value\">".concat(formatMoney(ownWeeklyRpc), "</span></div>");
                                    html += "<div class=\"tds-row\"><span class=\"tds-row-label\">Your efficiency vs average</span><span class=\"tds-row-value ".concat(compareValueClass(ownWeeklyRpc, avgWeeklyRpc), "\">").concat(formatSignedPercent(percentageDifference(ownWeeklyRpc, avgWeeklyRpc)), "</span></div>");
                                }
                                if (ownWeeklyRpcIndex >= 0) {
                                    html += "<div class=\"tds-row\"><span class=\"tds-row-label\">Revenue / customer rank</span><span class=\"tds-row-value\">#".concat(ownWeeklyRpcIndex + 1, " / ").concat(weeklyRpcRows.length, "</span></div>");
                                }
                            }
                            if (hasDailyIncome && hasDailyCustomers && ownDailyRpc !== null) {
                                html += "<div class=\"tds-row\"><span class=\"tds-row-label\">Your daily revenue / customer</span><span class=\"tds-row-value\">".concat(formatMoney(ownDailyRpc), "</span></div>");
                                if (avgDailyRpc !== null) {
                                    html += "<div class=\"tds-row\"><span class=\"tds-row-label\">Daily efficiency vs average</span><span class=\"tds-row-value ".concat(compareValueClass(ownDailyRpc, avgDailyRpc), "\">").concat(formatSignedPercent(percentageDifference(ownDailyRpc, avgDailyRpc)), "</span></div>");
                                }
                            }
                            html += "</div>";
                        }
                        availableFinancialFields = [
                            hasDailyIncome ? 'Daily income' : null,
                            hasWeeklyIncome ? 'Weekly income' : null,
                            hasDailyCustomers ? 'Daily customers' : null,
                            hasWeeklyCustomers ? 'Weekly customers' : null,
                        ].filter(Boolean);
                        if (!availableFinancialFields.length) {
                            html += "<div class=\"tds-box tds-box-warn\">\n        Torn returned the companies, but no financial/customer figures could be matched for these rows.\n        ".concat(snapshotError
                                ? "The Company Snapshot fallback also failed: ".concat(escapeHtml(String(snapshotError.reason || 'unknown error')), ".")
                                : 'Compare will not invent financial values.', "\n      </div>");
                        }
                        else {
                            html += "<div class=\"tds-box tds-box-info\">\n        Financial fields available: <strong>".concat(escapeHtml(availableFinancialFields.join(', ')), "</strong>.\n        ").concat(snapshotUsed ? 'Missing search values were filled from Torn’s daily Company Snapshot.' : 'These values were supplied directly by Torn’s company search response.', "\n      </div>");
                        }
                        if (sorted.length > 25 || rows.length >= 100) {
                            html += "<div class=\"tds-box tds-box-warn\">\n        Showing <strong>".concat(Math.min(25, sorted.length), " companies</strong> in this table. Summary statistics above use all <strong>").concat(formatNumber(sorted.length), "</strong> companies returned by Torn.\n      </div>");
                        }
                        if (ownIndex >= 25 && ownRow) {
                            html += "<div class=\"tds-box tds-box-info\">\n        Your company ranks <strong>#".concat(ownIndex + 1, "</strong>, so it falls outside the Top 25 table below.\n        Your figures are still included in all summary statistics.\n      </div>");
                        }
                        html += "<div class=\"tds-section-label\">Top ".concat(Math.min(25, sorted.length)).concat(metric ? " \u2014 ".concat(metricLabel) : '', "</div>");
                        html += "<div style=\"overflow-x:auto;\"><table class=\"tds-table tds-compare-table\"><thead><tr>\n      <th>#</th>\n      <th>Company</th>\n      <th>\u2605</th>\n      ".concat(hasDailyIncome ? '<th>Daily Income</th>' : '', "\n      ").concat(hasWeeklyIncome ? '<th>Weekly Income</th>' : '', "\n      ").concat(hasDailyCustomers ? '<th>Daily Customers</th>' : '', "\n      ").concat(hasWeeklyCustomers ? '<th>Weekly Customers</th>' : '', "\n    </tr></thead><tbody>");
                        sorted.slice(0, 25).forEach(function (row, i) {
                            var _a, _b;
                            var isYou = own.id !== null &&
                                row.id !== null &&
                                String(row.id) === String(own.id);
                            html += "<tr style=\"".concat(isYou ? 'color:var(--tds-accent,#3ddc84);font-weight:700;' : '', "\">\n        <td>").concat(i + 1, "</td>\n        <td>").concat(escapeHtml(String((_a = row.name) !== null && _a !== void 0 ? _a : "#".concat((_b = row.id) !== null && _b !== void 0 ? _b : '?')))).concat(isYou ? ' (you)' : '', "</td>\n        <td>").concat(row.rating !== null ? "".concat(escapeHtml(String(row.rating)), "\u2605") : '—', "</td>\n        ").concat(hasDailyIncome ? "<td class=\"tds-num\">".concat(row.dailyIncome !== null ? formatMoney(row.dailyIncome) : '—', "</td>") : '', "\n        ").concat(hasWeeklyIncome ? "<td class=\"tds-num\">".concat(row.weeklyIncome !== null ? formatMoney(row.weeklyIncome) : '—', "</td>") : '', "\n        ").concat(hasDailyCustomers ? "<td class=\"tds-num\">".concat(row.dailyCustomers !== null ? formatNumber(row.dailyCustomers) : '—', "</td>") : '', "\n        ").concat(hasWeeklyCustomers ? "<td class=\"tds-num\">".concat(row.weeklyCustomers !== null ? formatNumber(row.weeklyCustomers) : '—', "</td>") : '', "\n      </tr>");
                        });
                        html += "</tbody></table></div>";
                        el.innerHTML = html;
                        return [2 /*return*/];
                }
            });
        });
    }
    var footerTicker = null;
    function formatElapsed(seconds) {
        var total = Math.max(0, Math.floor(Number(seconds) || 0));
        if (total < 60)
            return "".concat(total, "s");
        var minutes = Math.floor(total / 60);
        var secs = total % 60;
        if (minutes < 60)
            return "".concat(minutes, ":").concat(String(secs).padStart(2, '0'));
        var hours = Math.floor(minutes / 60);
        var mins = minutes % 60;
        return "".concat(hours, ":").concat(String(mins).padStart(2, '0'), ":").concat(String(secs).padStart(2, '0'));
    }
    function updateFooter(panel) {
        var status = panel.querySelector('#tds-footer-status');
        if (!status)
            return;
        if (!state.lastRunAt) {
            status.textContent = 'Last run: Never';
            return;
        }
        var secs = Math.floor((Date.now() - state.lastRunAt) / 1000);
        status.textContent = "Last run: ".concat(formatElapsed(secs));
    }
    function startFooterTicker(panel) {
        if (footerTicker)
            clearInterval(footerTicker);
        updateFooter(panel);
        footerTicker = setInterval(function () { return updateFooter(panel); }, 1000);
    }
    function loadPersistedDiagnostic(panel) {
        return __awaiter(this, void 0, void 0, function () {
            var latest, results, verdict, err_11;
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        _b.trys.push([0, 5, , 6]);
                        return [4 /*yield*/, LocalDB.getLatest('diagnostics')];
                    case 1:
                        latest = _b.sent();
                        if (!((_a = latest === null || latest === void 0 ? void 0 : latest.results) === null || _a === void 0 ? void 0 : _a.length))
                            return [2 /*return*/, false];
                        results = latest.results;
                        verdict = classifyAccess(results);
                        state.lastResults = results;
                        state.lastVerdict = verdict;
                        state.lastRunAt = Number(latest.timestamp) || Number(tdsGetValue(STORAGE_KEY_LAST_RUN_AT, 0)) || null;
                        if (state.lastRunAt)
                            tdsSetValue(STORAGE_KEY_LAST_RUN_AT, state.lastRunAt);
                        renderOverviewTab(panel, results, verdict);
                        renderDiagnosticsTab(panel, results);
                        return [4 /*yield*/, renderFinanceTab(panel)];
                    case 2:
                        _b.sent();
                        return [4 /*yield*/, renderStockTab(panel)];
                    case 3:
                        _b.sent();
                        renderTrainingTab(panel).catch(function (err) { return console.error('[TDS] Training render failed:', err); });
                        renderBenchmarkTab(panel);
                        renderOptimizeTab(panel);
                        startFooterTicker(panel);
                        return [4 /*yield*/, checkLicense(panel)];
                    case 4:
                        _b.sent();
                        return [2 /*return*/, true];
                    case 5:
                        err_11 = _b.sent();
                        console.warn('[TDS] Could not load persisted diagnostics:', err_11);
                        return [2 /*return*/, false];
                    case 6: return [2 /*return*/];
                }
            });
        });
    }
    function runFullDiagnostic(panel_1) {
        return __awaiter(this, arguments, void 0, function (panel, _a) {
            var err_12, apiKey, results, verdict;
            var _b = _a === void 0 ? {} : _a, _c = _b.force, force = _c === void 0 ? false : _c;
            return __generator(this, function (_d) {
                switch (_d.label) {
                    case 0:
                        if (state.diagnosticRunning)
                            return [2 /*return*/];
                        if (!force) return [3 /*break*/, 4];
                        tdsDeleteValue(STORAGE_KEY_LAST_RUN_AT);
                        _d.label = 1;
                    case 1:
                        _d.trys.push([1, 3, , 4]);
                        // Remove only the diagnostic capability records. Historical snapshots
                        // remain intact so the Finance trend is not destroyed by a rerun.
                        return [4 /*yield*/, LocalDB.clear('diagnostics')];
                    case 2:
                        // Remove only the diagnostic capability records. Historical snapshots
                        // remain intact so the Finance trend is not destroyed by a rerun.
                        _d.sent();
                        return [3 /*break*/, 4];
                    case 3:
                        err_12 = _d.sent();
                        console.warn('[TDS] Could not clear previous diagnostic state:', err_12);
                        return [3 /*break*/, 4];
                    case 4:
                        apiKey = tdsGetValue(STORAGE_KEY_APIKEY, '');
                        if (!apiKey) {
                            panel.querySelector('#tds-footer-status').textContent = 'Last run: Never';
                            switchTab(panel, 'settings');
                            return [2 /*return*/];
                        }
                        state.diagnosticRunning = true;
                        panel.querySelector('#tds-footer-status').textContent = 'Running diagnostic\u2026';
                        _d.label = 5;
                    case 5:
                        _d.trys.push([5, , 11, 12]);
                        return [4 /*yield*/, runDiagnostic()];
                    case 6:
                        results = _d.sent();
                        verdict = classifyAccess(results);
                        return [4 /*yield*/, takeSnapshotFromDiagnostic(results)];
                    case 7:
                        _d.sent();
                        state.lastResults = results;
                        state.lastVerdict = verdict;
                        state.lastRunAt = Date.now();
                        tdsSetValue(STORAGE_KEY_LAST_RUN_AT, state.lastRunAt);
                        renderOverviewTab(panel, results, verdict);
                        renderDiagnosticsTab(panel, results);
                        return [4 /*yield*/, renderFinanceTab(panel)];
                    case 8:
                        _d.sent();
                        return [4 /*yield*/, renderStockTab(panel)];
                    case 9:
                        _d.sent();
                        renderTrainingTab(panel).catch(function (err) { return console.error('[TDS] Training render failed:', err); });
                        renderBenchmarkTab(panel);
                        renderOptimizeTab(panel);
                        startFooterTicker(panel);
                        return [4 /*yield*/, checkLicense(panel, { force: force })];
                    case 10:
                        _d.sent();
                        return [3 /*break*/, 12];
                    case 11:
                        state.diagnosticRunning = false;
                        return [7 /*endfinally*/];
                    case 12: return [2 /*return*/];
                }
            });
        });
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
    var jobsBootTimer = null;
    var jobsObserver = null;
    var jobsBootPoll = null;
    function bootJobsPage() {
        return __awaiter(this, void 0, void 0, function () {
            var mount, panel, errorBox, hydrated, err_13, status;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        console.debug('[TDS] boot check', window.location.href, 'companyPage=', isJobsPage());
                        if (!isJobsPage()) {
                            removePanel();
                            return [2 /*return*/];
                        }
                        if (document.getElementById('tds-panel'))
                            return [2 /*return*/];
                        mount = findJobsMount();
                        if (!mount)
                            return [2 /*return*/];
                        detectTornColours();
                        try {
                            panel = buildPanel(mount);
                        }
                        catch (err) {
                            console.error('[TDS] Panel build failed:', err);
                            // PDA-visible fallback so a future compatibility error does not look
                            // like "the script did nothing".
                            if (!document.getElementById('tds-boot-error')) {
                                errorBox = document.createElement('div');
                                errorBox.id = 'tds-boot-error';
                                errorBox.style.cssText =
                                    'margin:10px;padding:10px;border:1px solid #d66;border-radius:6px;' +
                                        'background:#3a2222;color:#ffd0d0;font:12px sans-serif;position:relative;z-index:9999;';
                                errorBox.textContent =
                                    'Torn Company Management Suite v' + TDS_VERSION +
                                        ' loaded, but the dashboard could not be built. Check the TornPDA script console for [TDS] Panel build failed.';
                                try {
                                    (mount || document.body || document.documentElement).prepend(errorBox);
                                }
                                catch (_) { }
                            }
                            return [2 /*return*/];
                        }
                        return [4 /*yield*/, loadPersistedDiagnostic(panel)];
                    case 1:
                        hydrated = _a.sent();
                        if (hydrated)
                            return [2 /*return*/];
                        if (!tdsGetValue(STORAGE_KEY_APIKEY, '')) return [3 /*break*/, 6];
                        _a.label = 2;
                    case 2:
                        _a.trys.push([2, 4, , 5]);
                        return [4 /*yield*/, runFullDiagnostic(panel)];
                    case 3:
                        _a.sent();
                        return [3 /*break*/, 5];
                    case 4:
                        err_13 = _a.sent();
                        status = panel.querySelector('#tds-footer-status');
                        if (status)
                            status.textContent = 'Last run: Never';
                        console.error('[TDS] Automatic startup run failed:', err_13);
                        return [3 /*break*/, 5];
                    case 5: return [3 /*break*/, 7];
                    case 6:
                        updateFooter(panel);
                        switchTab(panel, 'settings');
                        _a.label = 7;
                    case 7: return [2 /*return*/];
                }
            });
        });
    }
    function scheduleJobsBoot() {
        clearTimeout(jobsBootTimer);
        jobsBootTimer = setTimeout(function () {
            bootJobsPage().catch(function (err) { return console.error('[TDS] Jobs page boot failed:', err); });
        }, 80);
    }
    function startJobsNavigationWatcher() {
        var routeEvents = ['hashchange', 'popstate', 'pageshow'];
        routeEvents.forEach(function (eventName) {
            return window.addEventListener(eventName, scheduleJobsBoot, { passive: true });
        });
        if (!jobsObserver && document.documentElement) {
            jobsObserver = new MutationObserver(function () {
                if (isJobsPage() && !document.getElementById('tds-panel'))
                    scheduleJobsBoot();
                if (!isJobsPage() && document.getElementById('tds-panel'))
                    removePanel();
            });
            // Observe documentElement rather than body because TornPDA/WebView can
            // replace major page containers during navigation.
            jobsObserver.observe(document.documentElement, { childList: true, subtree: true });
        }
        // PDA-safe fallback: retry briefly while Torn's mobile company DOM is
        // being assembled. Stop once the panel exists or after ~30 seconds.
        if (!jobsBootPoll) {
            var attempts_1 = 0;
            jobsBootPoll = setInterval(function () {
                attempts_1 += 1;
                if (isJobsPage()) {
                    if (!document.getElementById('tds-panel'))
                        scheduleJobsBoot();
                    else {
                        clearInterval(jobsBootPoll);
                        jobsBootPoll = null;
                    }
                }
                if (attempts_1 >= 60 && jobsBootPoll) {
                    clearInterval(jobsBootPoll);
                    jobsBootPoll = null;
                }
            }, 500);
        }
        scheduleJobsBoot();
    }
    function initialiseTds() {
        if (!document.getElementById('tds-styles'))
            injectStyles();
        startJobsNavigationWatcher();
    }
    // Works whether TornPDA injects the script at Start, End, or after the page
    // has already completed loading.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialiseTds, { once: true });
        window.addEventListener('load', initialiseTds, { once: true });
    }
    else {
        initialiseTds();
    }
})();
