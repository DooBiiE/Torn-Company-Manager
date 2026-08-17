// ==UserScript==
// @name         Torn Company Manager - PDA
// @namespace    torn-company-manager-pda
// @version      0.7.0
// @description  Read-only Torn company management dashboard designed for Torn PDA/mobile. Local storage only.
// @author       you
// @match        https://www.torn.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    /*
     * ================================================================
     * TORN COMPANY MANAGER - PDA EDITION
     * ================================================================
     *
     * Design goals:
     *
     *  - PDA/mobile first
     *  - Bottom-left floating button
     *  - Touch + mouse dragging
     *  - Local-only settings/snapshots
     *  - Read-only Torn API usage
     *  - No external services
     *  - Safe to reload/re-enter Torn pages
     *
     * ================================================================
     */

    const VERSION = '0.7.0';

    const API_BASE = 'https://api.torn.com';

    const KEY_API = 'tcm_api_key';
    const KEY_POS_BUTTON = 'tcm_button_position';
    const KEY_POS_PANEL = 'tcm_panel_position';
    const KEY_THEME = 'tcm_theme';
    const KEY_PDA = 'tcm_pda_mode';

    const ROOT_ID = 'tcm-root';

    const MIN_API_INTERVAL = 900;

    let lastApiCall = 0;

    const state = {
        results: null,
        verdict: null,
        running: false,
        currentTab: 'overview'
    };

    const themes = {
        green: '#3ddc84',
        blue: '#4da3ff',
        purple: '#b18cff',
        amber: '#f5a623',
        cyan: '#39d0d8',
        pink: '#ff6bb5'
    };

    // ================================================================
    // UTILITY
    // ================================================================

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, function (c) {
            return {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
            }[c];
        });
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function getTheme() {
        return GM_getValue(KEY_THEME, 'green');
    }

    function accent() {
        return themes[getTheme()] || themes.green;
    }

    // ================================================================
    // API
    // ================================================================

    async function tornApi(section, selections) {

        const key = GM_getValue(KEY_API, '').trim();

        if (!key) {
            throw {
                code: '',
                reason: 'No Torn API key has been configured.'
            };
        }

        const now = Date.now();

        const wait = Math.max(
            0,
            MIN_API_INTERVAL - (now - lastApiCall)
        );

        if (wait > 0) {
            await sleep(wait);
        }

        lastApiCall = Date.now();

        const url =
            API_BASE +
            '/' +
            section +
            '?' +
            'selections=' +
            encodeURIComponent(selections) +
            '&key=' +
            encodeURIComponent(key);

        let response;

        try {
            response = await fetch(url, {
                method: 'GET',
                cache: 'no-store'
            });
        } catch (e) {
            throw {
                code: '',
                reason: 'Network error contacting api.torn.com.'
            };
        }

        if (!response.ok) {
            throw {
                code: response.status,
                reason: 'Torn API returned HTTP ' + response.status
            };
        }

        let json;

        try {
            json = await response.json();
        } catch (e) {
            throw {
                code: '',
                reason: 'Torn returned an invalid response.'
            };
        }

        if (json.error) {
            throw {
                code: json.error.code,
                reason: json.error.error
            };
        }

        return json;
    }

    // ================================================================
    // DIAGNOSTICS
    // ================================================================

    const probes = [
        {
            section: 'company',
            selections: 'profile',
            label: 'Company profile'
        },
        {
            section: 'company',
            selections: 'employees',
            label: 'Employee roster'
        },
        {
            section: 'company',
            selections: 'detailed',
            label: 'Company financials'
        },
        {
            section: 'company',
            selections: 'stock',
            label: 'Company stock'
        },
        {
            section: 'company',
            selections: 'applications',
            label: 'Pending applications'
        },
        {
            section: 'user',
            selections: 'basic',
            label: 'Your profile'
        },
        {
            section: 'user',
            selections: 'workstats',
            label: 'Your working stats'
        }
    ];

    async function runDiagnostics() {

        const results = [];

        for (const probe of probes) {

            try {

                const data = await tornApi(
                    probe.section,
                    probe.selections
                );

                results.push({
                    ...probe,
                    status: 'ok',
                    data: data,
                    keys: Object.keys(data || {})
                });

            } catch (err) {

                results.push({
                    ...probe,
                    status: 'blocked',
                    code: err.code,
                    reason: err.reason
                });
            }

            renderDiagnosticsProgress(results);
        }

        return results;
    }

    function getResult(results, section, selections) {
        return results.find(
            r =>
                r.section === section &&
                r.selections === selections
        );
    }

    function classify(results) {

        const detailed = getResult(
            results,
            'company',
            'detailed'
        );

        const stock = getResult(
            results,
            'company',
            'stock'
        );

        const applications = getResult(
            results,
            'company',
            'applications'
        );

        const employees = getResult(
            results,
            'company',
            'employees'
        );

        const director =
            detailed?.status === 'ok' &&
            stock?.status === 'ok' &&
            applications?.status === 'ok';

        if (director) {
            return {
                level: 'director',
                title: 'Director access confirmed',
                text:
                    'The Torn API is allowing the company financial, stock and application selections.'
            };
        }

        if (employees?.status === 'ok') {
            return {
                level: 'employee',
                title: 'Employee/company access detected',
                text:
                    'The employee roster is accessible, while one or more director-level selections are blocked by Torn.'
            };
        }

        return {
            level: 'unknown',
            title: 'Access level not determined',
            text:
                'Run the diagnostic to determine which Torn API selections this key can access.'
        };
    }

    // ================================================================
    // ROOT
    // ================================================================

    function createRoot() {

        if (document.getElementById(ROOT_ID)) {
            return document.getElementById(ROOT_ID);
        }

        const root = document.createElement('div');

        root.id = ROOT_ID;

        root.innerHTML = `
            <div id="tcm-button">
                <span class="tcm-button-icon">◉</span>
                <span class="tcm-button-text">Company</span>
            </div>

            <section id="tcm-panel">

                <header id="tcm-header">

                    <div class="tcm-title">
                        <span class="tcm-dot">●</span>
                        <span>Torn Company Manager</span>
                        <small>v${VERSION}</small>
                    </div>

                    <div class="tcm-header-actions">

                        <button
                            type="button"
                            data-action="refresh"
                            aria-label="Refresh"
                        >↻</button>

                        <button
                            type="button"
                            data-action="settings"
                            aria-label="Settings"
                        >⚙</button>

                        <button
                            type="button"
                            data-action="close"
                            aria-label="Close"
                        >×</button>

                    </div>

                </header>

                <nav id="tcm-tabs">

                    <button data-tab="overview">
                        OVERVIEW
                    </button>

                    <button data-tab="diagnostics">
                        DIAGNOSTICS
                    </button>

                    <button data-tab="finance">
                        FINANCE
                    </button>

                    <button data-tab="settings">
                        SETTINGS
                    </button>

                </nav>

                <main id="tcm-body">

                    <div
                        class="tcm-page"
                        data-page="overview"
                    ></div>

                    <div
                        class="tcm-page"
                        data-page="diagnostics"
                        hidden
                    ></div>

                    <div
                        class="tcm-page"
                        data-page="finance"
                        hidden
                    ></div>

                    <div
                        class="tcm-page"
                        data-page="settings"
                        hidden
                    ></div>

                </main>

                <footer id="tcm-footer">
                    <span id="tcm-status">
                        Ready
                    </span>

                    <span>
                        PDA
                    </span>
                </footer>

            </section>
        `;

        document.body.appendChild(root);

        return root;
    }

    // ================================================================
    // CSS
    // ================================================================

    function injectCSS() {

        if (document.getElementById('tcm-style')) {
            return;
        }

        const style = document.createElement('style');

        style.id = 'tcm-style';

        style.textContent = `

            #${ROOT_ID} {
                --tcm-accent: ${accent()};

                position: fixed !important;
                left: 0 !important;
                top: 0 !important;

                width: 0 !important;
                height: 0 !important;

                z-index: 2147483646 !important;

                pointer-events: none !important;

                font-family:
                    -apple-system,
                    BlinkMacSystemFont,
                    "Segoe UI",
                    sans-serif !important;
            }

            #tcm-button {
                position: fixed !important;

                left: 12px !important;
                bottom: 18px !important;

                width: auto !important;
                height: 42px !important;

                padding:
                    0 13px !important;

                display: flex !important;
                align-items: center !important;
                gap: 7px !important;

                background:
                    #10141c !important;

                color:
                    var(--tcm-accent) !important;

                border:
                    1px solid #303746 !important;

                border-radius:
                    10px !important;

                box-shadow:
                    0 5px 18px rgba(0,0,0,.55) !important;

                font-size:
                    12px !important;

                font-weight:
                    700 !important;

                line-height:
                    1 !important;

                cursor:
                    grab !important;

                user-select:
                    none !important;

                -webkit-user-select:
                    none !important;

                touch-action:
                    none !important;

                pointer-events:
                    auto !important;

                z-index:
                    2147483647 !important;
            }

            #tcm-button:active {
                cursor: grabbing !important;
            }

            #tcm-button .tcm-button-icon {
                color:
                    var(--tcm-accent) !important;

                font-size:
                    13px !important;
            }

            #tcm-panel {

                position: fixed !important;

                left: 12px !important;
                bottom: 70px !important;

                width:
                    min(430px, calc(100vw - 24px)) !important;

                height:
                    min(650px, calc(100vh - 90px)) !important;

                max-height:
                    calc(100vh - 90px) !important;

                display: none;

                flex-direction: column;

                background:
                    #090c11 !important;

                color:
                    #dce0e7 !important;

                border:
                    1px solid #262c38 !important;

                border-radius:
                    12px !important;

                box-shadow:
                    0 12px 40px rgba(0,0,0,.70) !important;

                overflow:
                    hidden !important;

                z-index:
                    2147483647 !important;

                pointer-events:
                    auto !important;

                isolation:
                    isolate !important;
            }

            #tcm-panel.tcm-visible {
                display:
                    flex !important;
            }

            #tcm-header {

                flex:
                    0 0 auto;

                display:
                    flex;

                align-items:
                    center;

                justify-content:
                    space-between;

                min-height:
                    46px;

                padding:
                    0 9px 0 12px;

                background:
                    #0e1219;

                border-bottom:
                    1px solid #202631;

                cursor:
                    grab;

                touch-action:
                    none;

                user-select:
                    none;
            }

            #tcm-header.tcm-dragging {
                cursor:
                    grabbing;
            }

            .tcm-title {

                display:
                    flex;

                align-items:
                    baseline;

                gap:
                    5px;

                font-size:
                    12px;

                font-weight:
                    800;

                color:
                    var(--tcm-accent);
            }

            .tcm-title small {
                color:
                    #555d6c;

                font-size:
                    9px;

                font-weight:
                    500;
            }

            .tcm-dot {
                font-size:
                    8px;
            }

            .tcm-header-actions {

                display:
                    flex;

                gap:
                    4px;
            }

            .tcm-header-actions button {

                width:
                    30px;

                height:
                    30px;

                padding:
                    0;

                border:
                    1px solid #2a303c;

                border-radius:
                    6px;

                background:
                    #11151d;

                color:
                    #9aa2b0;

                font-size:
                    16px;

                cursor:
                    pointer;

                touch-action:
                    manipulation;
            }

            .tcm-header-actions button:active {
                background:
                    #202631;
            }

            #tcm-tabs {

                display:
                    flex;

                overflow-x:
                    auto;

                flex:
                    0 0 auto;

                padding:
                    7px 8px 0;

                background:
                    #0a0d12;

                border-bottom:
                    1px solid #202631;

                scrollbar-width:
                    none;
            }

            #tcm-tabs::-webkit-scrollbar {
                display:
                    none;
            }

            #tcm-tabs button {

                flex:
                    0 0 auto;

                border:
                    0;

                border-bottom:
                    2px solid transparent;

                background:
                    transparent;

                color:
                    #596171;

                padding:
                    8px 9px 9px;

                font-size:
                    10px;

                font-weight:
                    800;

                letter-spacing:
                    .04em;

                cursor:
                    pointer;
            }

            #tcm-tabs button.tcm-active {

                color:
                    var(--tcm-accent);

                border-bottom-color:
                    var(--tcm-accent);
            }

            #tcm-body {

                flex:
                    1 1 auto;

                min-height:
                    0;

                overflow-y:
                    auto;

                overflow-x:
                    hidden;

                -webkit-overflow-scrolling:
                    touch;

                padding:
                    12px;
            }

            .tcm-page[hidden] {
                display:
                    none !important;
            }

            .tcm-card {

                background:
                    #11151d;

                border:
                    1px solid #202631;

                border-radius:
                    8px;

                padding:
                    12px;

                margin-bottom:
                    10px;
            }

            .tcm-label {

                color:
                    #5f6878;

                font-size:
                    9px;

                font-weight:
                    800;

                letter-spacing:
                    .08em;

                text-transform:
                    uppercase;

                margin:
                    14px 0 7px;
            }

            .tcm-label:first-child {
                margin-top:
                    0;
            }

            .tcm-message {

                padding:
                    11px 12px;

                border-radius:
                    8px;

                background:
                    #11151d;

                border:
                    1px solid #252c38;

                color:
                    #9da5b2;

                font-size:
                    12px;

                line-height:
                    1.5;

                margin-bottom:
                    10px;
            }

            .tcm-good {

                border-color:
                    rgba(61,220,132,.35);

                background:
                    rgba(61,220,132,.07);

                color:
                    #a8e8c0;
            }

            .tcm-warn {

                border-color:
                    rgba(245,166,35,.35);

                background:
                    rgba(245,166,35,.07);

                color:
                    #edc681;
            }

            .tcm-danger {

                border-color:
                    rgba(255,92,92,.35);

                background:
                    rgba(255,92,92,.07);

                color:
                    #ffb4b4;
            }

            .tcm-row {

                display:
                    flex;

                justify-content:
                    space-between;

                gap:
                    10px;

                padding:
                    7px 0;

                border-bottom:
                    1px solid #1a1f28;

                font-size:
                    11px;
            }

            .tcm-row:last-child {
                border-bottom:
                    0;
            }

            .tcm-row-name {
                color:
                    #8e97a5;
            }

            .tcm-row-value {
                color:
                    #e5e8ed;

                font-weight:
                    700;

                text-align:
                    right;

                word-break:
                    break-word;
            }

            .tcm-badge {

                display:
                    inline-block;

                padding:
                    3px 6px;

                border-radius:
                    5px;

                font-size:
                    9px;

                font-weight:
                    800;
            }

            .tcm-badge-ok {

                color:
                    #3ddc84;

                background:
                    rgba(61,220,132,.12);

                border:
                    1px solid rgba(61,220,132,.25);
            }

            .tcm-badge-blocked {

                color:
                    #ff8585;

                background:
                    rgba(255,92,92,.10);

                border:
                    1px solid rgba(255,92,92,.25);
            }

            .tcm-employee {

                padding:
                    9px 0;

                border-bottom:
                    1px solid #1a1f28;
            }

            .tcm-employee:last-child {
                border-bottom:
                    0;
            }

            .tcm-employee-name {

                color:
                    #e5e8ed;

                font-size:
                    12px;

                font-weight:
                    800;
            }

            .tcm-employee-meta {

                color:
                    #697282;

                font-size:
                    10px;

                margin-top:
                    2px;
            }

            .tcm-button-row {

                display:
                    flex;

                gap:
                    7px;

                margin-top:
                    9px;
            }

            .tcm-button-row button {

                flex:
                    1;

                min-height:
                    36px;

                border-radius:
                    7px;

                font-size:
                    11px;

                font-weight:
                    800;

                cursor:
                    pointer;

                touch-action:
                    manipulation;
            }

            .tcm-primary {

                border:
                    0;

                background:
                    var(--tcm-accent);

                color:
                    #07120b;
            }

            .tcm-secondary {

                border:
                    1px solid #2b313d;

                background:
                    #12161e;

                color:
                    #a7afbb;
            }

            .tcm-input {

                width:
                    100%;

                box-sizing:
                    border-box;

                min-height:
                    38px;

                padding:
                    8px;

                border:
                    1px solid #2a303c;

                border-radius:
                    7px;

                background:
                    #090c11;

                color:
                    #e5e8ed;

                font-family:
                    monospace;

                font-size:
                    11px;
            }

            .tcm-input:focus {
                outline:
                    none;

                border-color:
                    var(--tcm-accent);
            }

            .tcm-swatches {

                display:
                    flex;

                gap:
                    8px;

                flex-wrap:
                    wrap;
            }

            .tcm-swatch {

                width:
                    30px;

                height:
                    30px;

                border-radius:
                    50%;

                border:
                    2px solid transparent;

                cursor:
                    pointer;
            }

            .tcm-swatch.active {
                border-color:
                    #fff;
            }

            #tcm-footer {

                flex:
                    0 0 auto;

                display:
                    flex;

                justify-content:
                    space-between;

                padding:
                    7px 11px;

                background:
                    #0e1219;

                border-top:
                    1px solid #202631;

                color:
                    #4f5867;

                font-size:
                    9px;
            }

            #tcm-status {
                color:
                    var(--tcm-accent);
            }

            @media (max-width: 520px) {

                #tcm-panel {

                    left:
                        8px !important;

                    right:
                        8px !important;

                    bottom:
                        68px !important;

                    width:
                        auto !important;

                    height:
                        calc(100vh - 84px) !important;

                    max-height:
                        calc(100vh - 84px) !important;

                    border-radius:
                        10px !important;
                }

                #tcm-button {

                    left:
                        10px !important;

                    bottom:
                        12px !important;
                }
            }

        `;

        document.head.appendChild(style);
    }

    // ================================================================
    // POSITIONING
    // ================================================================

    function clampPosition(left, top, element) {

        const rect = element.getBoundingClientRect();

        const width = rect.width || 100;
        const height = rect.height || 40;

        const maxLeft =
            Math.max(4, window.innerWidth - width - 4);

        const maxTop =
            Math.max(4, window.innerHeight - height - 4);

        return {
            left: Math.min(
                Math.max(4, left),
                maxLeft
            ),

            top: Math.min(
                Math.max(4, top),
                maxTop
            )
        };
    }

    function savePosition(key, element) {

        const rect =
            element.getBoundingClientRect();

        GM_setValue(key, {
            left: rect.left,
            top: rect.top
        });
    }

    function restorePosition(
        element,
        key,
        defaultLeft,
        defaultTop
    ) {

        const saved =
            GM_getValue(key, null);

        let left = defaultLeft;
        let top = defaultTop;

        if (
            saved &&
            typeof saved.left === 'number' &&
            typeof saved.top === 'number'
        ) {
            left = saved.left;
            top = saved.top;
        }

        const pos =
            clampPosition(
                left,
                top,
                element
            );

        element.style.left =
            pos.left + 'px';

        element.style.top =
            pos.top + 'px';

        element.style.right =
            'auto';

        element.style.bottom =
            'auto';
    }

    // ================================================================
    // DRAG
    // ================================================================

    function makeDraggable(
        handle,
        target,
        storageKey,
        ignoreButtons
    ) {

        let active = false;
        let moved = false;

        let startX = 0;
        let startY = 0;

        let originX = 0;
        let originY = 0;

        let pointerId = null;

        handle.addEventListener(
            'pointerdown',
            function (event) {

                if (
                    ignoreButtons &&
                    event.target.closest('button')
                ) {
                    return;
                }

                active = true;
                moved = false;

                pointerId =
                    event.pointerId;

                startX =
                    event.clientX;

                startY =
                    event.clientY;

                const rect =
                    target.getBoundingClientRect();

                originX =
                    rect.left;

                originY =
                    rect.top;

                try {
                    handle.setPointerCapture(
                        pointerId
                    );
                } catch (_) {}

                handle.classList.add(
                    'tcm-dragging'
                );

                event.preventDefault();
            },
            { passive: false }
        );

        handle.addEventListener(
            'pointermove',
            function (event) {

                if (
                    !active ||
                    event.pointerId !== pointerId
                ) {
                    return;
                }

                const dx =
                    event.clientX - startX;

                const dy =
                    event.clientY - startY;

                if (
                    Math.abs(dx) > 5 ||
                    Math.abs(dy) > 5
                ) {
                    moved = true;
                }

                const pos =
                    clampPosition(
                        originX + dx,
                        originY + dy,
                        target
                    );

                target.style.left =
                    pos.left + 'px';

                target.style.top =
                    pos.top + 'px';

                target.style.right =
                    'auto';

                target.style.bottom =
                    'auto';

                event.preventDefault();
            },
            { passive: false }
        );

        function finish(event) {

            if (!active) {
                return;
            }

            active = false;

            handle.classList.remove(
                'tcm-dragging'
            );

            if (moved) {
                savePosition(
                    storageKey,
                    target
                );

                target.dataset.dragged =
                    '1';
            }

            try {
                handle.releasePointerCapture(
                    pointerId
                );
            } catch (_) {}

            pointerId = null;

            if (event) {
                event.preventDefault();
            }
        }

        handle.addEventListener(
            'pointerup',
            finish,
            { passive: false }
        );

        handle.addEventListener(
            'pointercancel',
            finish,
            { passive: false }
        );
    }

    // ================================================================
    // TABS
    // ================================================================

    function showTab(root, tab) {

        state.currentTab = tab;

        root
            .querySelectorAll('#tcm-tabs button')
            .forEach(button => {

                button.classList.toggle(
                    'tcm-active',
                    button.dataset.tab === tab
                );
            });

        root
            .querySelectorAll('.tcm-page')
            .forEach(page => {

                page.hidden =
                    page.dataset.page !== tab;
            });
    }

    // ================================================================
    // OVERVIEW
    // ================================================================

    function renderOverview(root) {

        const page =
            root.querySelector(
                '[data-page="overview"]'
            );

        if (!state.results) {

            page.innerHTML = `
                <div class="tcm-message">
                    <strong>Company Manager</strong><br><br>
                    This is the PDA version of the
                    Torn Company Manager.
                    <br><br>
                    Add your Torn API key in
                    <strong>Settings</strong>,
                    then run the diagnostic.
                </div>
            `;

            return;
        }

        const verdict =
            state.verdict;

        const boxClass =
            verdict.level === 'director'
                ? 'tcm-good'
                : verdict.level === 'employee'
                    ? 'tcm-warn'
                    : 'tcm-danger';

        let html = `
            <div class="tcm-message ${boxClass}">
                <strong>
                    ${escapeHtml(verdict.title)}
                </strong>
                <br>
                ${escapeHtml(verdict.text)}
            </div>
        `;

        const company =
            getResult(
                state.results,
                'company',
                'profile'
            );

        if (
            company &&
            company.status === 'ok'
        ) {

            html += `
                <div class="tcm-label">
                    Company
                </div>

                <div class="tcm-card">
            `;

            Object
                .entries(company.data || {})
                .slice(0, 10)
                .forEach(([key, value]) => {

                    if (
                        value &&
                        typeof value === 'object'
                    ) {
                        return;
                    }

                    html += `
                        <div class="tcm-row">
                            <span class="tcm-row-name">
                                ${escapeHtml(key)}
                            </span>

                            <span class="tcm-row-value">
                                ${escapeHtml(value)}
                            </span>
                        </div>
                    `;
                });

            html += `
                </div>
            `;
        }

        const employees =
            getResult(
                state.results,
                'company',
                'employees'
            );

        html += `
            <div class="tcm-label">
                Employees
            </div>
        `;

        if (
            employees &&
            employees.status === 'ok'
        ) {

            const raw =
                employees.data || {};

            const employeeKey =
                Object.keys(raw).find(
                    key =>
                        key
                            .toLowerCase()
                            .includes('employee')
                );

            let list =
                employeeKey
                    ? raw[employeeKey]
                    : null;

            if (
                list &&
                !Array.isArray(list)
            ) {
                list =
                    Object.entries(list);
            }

            if (!Array.isArray(list)) {
                list = [];
            }

            html += `
                <div class="tcm-card">
            `;

            if (!list.length) {

                html += `
                    <div class="tcm-message">
                        Torn returned the employee
                        selection, but no employee
                        list could be identified.
                    </div>
                `;

            } else {

                list.slice(0, 25)
                    .forEach(entry => {

                        let employee;

                        if (
                            Array.isArray(entry)
                        ) {
                            employee =
                                entry[1];
                        } else {
                            employee =
                                entry;
                        }

                        const name =
                            employee?.name ||
                            'Unknown';

                        const position =
                            employee?.position ||
                            '';

                        html += `
                            <div class="tcm-employee">

                                <div class="tcm-employee-name">
                                    ${escapeHtml(name)}
                                </div>

                                <div class="tcm-employee-meta">
                                    ${escapeHtml(position)}
                                </div>

                            </div>
                        `;
                    });
            }

            html += `
                </div>
            `;

        } else {

            html += `
                <div class="tcm-message">
                    Employee roster is not
                    accessible with this API key.
                    See Diagnostics.
                </div>
            `;
        }

        page.innerHTML = html;
    }

    // ================================================================
    // DIAGNOSTICS
    // ================================================================

    function renderDiagnosticsProgress(results) {

        const root =
            document.getElementById(ROOT_ID);

        if (!root) {
            return;
        }

        const page =
            root.querySelector(
                '[data-page="diagnostics"]'
            );

        let html = `
            <div class="tcm-label">
                API capability check
            </div>

            <div class="tcm-card">
        `;

        results.forEach(result => {

            if (result.status === 'ok') {

                html += `
                    <div class="tcm-row">

                        <span class="tcm-row-name">
                            ${escapeHtml(result.label)}
                        </span>

                        <span>
                            <span class="tcm-badge tcm-badge-ok">
                                ACCESSIBLE
                            </span>
                        </span>

                    </div>
                `;

            } else {

                html += `
                    <div class="tcm-row">

                        <span class="tcm-row-name">

                            ${escapeHtml(result.label)}

                            <br>

                            <small>
                                Torn ${escapeHtml(result.code || '')}:
                                ${escapeHtml(result.reason || '')}
                            </small>

                        </span>

                        <span>
                            <span class="tcm-badge tcm-badge-blocked">
                                BLOCKED
                            </span>
                        </span>

                    </div>
                `;
            }
        });

        html += `
            </div>
        `;

        page.innerHTML = html;
    }

    function renderDiagnostics(root) {

        if (!state.results) {

            renderDiagnosticsProgress([]);

            return;
        }

        renderDiagnosticsProgress(
            state.results
        );
    }

    // ================================================================
    // FINANCE
    // ================================================================

    function renderFinance(root) {

        const page =
            root.querySelector(
                '[data-page="finance"]'
            );

        const result =
            getResult(
                state.results || [],
                'company',
                'detailed'
            );

        if (
            !result ||
            result.status !== 'ok'
        ) {

            page.innerHTML = `
                <div class="tcm-label">
                    Finance
                </div>

                <div class="tcm-message tcm-warn">
                    <strong>
                        Director access required
                    </strong>

                    <br><br>

                    Torn has not granted this API key
                    access to the company detailed
                    selection.
                </div>
            `;

            return;
        }

        page.innerHTML = `
            <div class="tcm-label">
                Torn API financial data
            </div>

            <div class="tcm-message tcm-good">
                The company detailed selection
                is accessible.
            </div>

            <div class="tcm-card">

                ${Object
                    .entries(result.data || {})
                    .map(([key, value]) => {

                        if (
                            value &&
                            typeof value === 'object'
                        ) {
                            return '';
                        }

                        return `
                            <div class="tcm-row">
                                <span class="tcm-row-name">
                                    ${escapeHtml(key)}
                                </span>

                                <span class="tcm-row-value">
                                    ${escapeHtml(value)}
                                </span>
                            </div>
                        `;
                    })
                    .join('')}

            </div>
        `;
    }

    // ================================================================
    // SETTINGS
    // ================================================================

    function renderSettings(root) {

        const page =
            root.querySelector(
                '[data-page="settings"]'
            );

        const currentKey =
            GM_getValue(KEY_API, '');

        const currentTheme =
            getTheme();

        const pda =
            GM_getValue(KEY_PDA, true);

        page.innerHTML = `

            <div class="tcm-label">
                Torn API Key
            </div>

            <div class="tcm-message">
                Your API key is stored using
                Tampermonkey/Violentmonkey's
                local storage.
                <br><br>
                It is only used to communicate
                with <strong>api.torn.com</strong>.
            </div>

            <input
                id="tcm-api-key"
                class="tcm-input"
                type="password"
                autocomplete="off"
                placeholder="Paste Torn API key"
            />

            <div class="tcm-button-row">

                <button
                    type="button"
                    class="tcm-primary"
                    id="tcm-save-key"
                >
                    SAVE KEY
                </button>

                <button
                    type="button"
                    class="tcm-secondary"
                    id="tcm-run"
                >
                    RUN TEST
                </button>

            </div>

            <div class="tcm-label">
                PDA Mode
            </div>

            <div class="tcm-card">

                <div class="tcm-row">

                    <span class="tcm-row-name">
                        PDA/mobile layout
                    </span>

                    <span class="tcm-row-value">
                        ${pda ? 'ON' : 'OFF'}
                    </span>

                </div>

                <div class="tcm-button-row">

                    <button
                        type="button"
                        class="tcm-primary"
                        id="tcm-pda-toggle"
                    >
                        ${pda ? 'DISABLE' : 'ENABLE'}
                    </button>

                </div>

            </div>

            <div class="tcm-label">
                Colour
            </div>

            <div class="tcm-card">

                <div class="tcm-swatches">

                    ${Object
                        .entries(themes)
                        .map(([name, colour]) => `
                            <div
                                class="tcm-swatch ${
                                    name === currentTheme
                                        ? 'active'
                                        : ''
                                }"
                                data-theme="${name}"
                                style="background:${colour}"
                                title="${name}"
                            ></div>
                        `)
                        .join('')}

                </div>

            </div>

            <div class="tcm-label">
                Position
            </div>

            <div class="tcm-card">

                <div class="tcm-message">
                    You can drag the <strong>Company</strong>
                    button and the panel header
                    anywhere on the screen.
                    <br><br>
                    If either gets lost, use the
                    button below.
                </div>

                <div class="tcm-button-row">

                    <button
                        type="button"
                        class="tcm-secondary"
                        id="tcm-reset-position"
                    >
                        RESET POSITIONS
                    </button>

                </div>

            </div>

            <div class="tcm-label">
                Script
            </div>

            <div class="tcm-card">

                <div class="tcm-row">
                    <span class="tcm-row-name">
                        Version
                    </span>

                    <span class="tcm-row-value">
                        ${VERSION}
                    </span>
                </div>

                <div class="tcm-row">
                    <span class="tcm-row-name">
                        Mode
                    </span>

                    <span class="tcm-row-value">
                        PDA
                    </span>
                </div>

                <div class="tcm-row">
                    <span class="tcm-row-name">
                        External server
                    </span>

                    <span class="tcm-row-value">
                        None
                    </span>
                </div>

            </div>
        `;

        page.querySelector('#tcm-api-key').value =
            currentKey;

        page.querySelector(
            '#tcm-save-key'
        ).addEventListener(
            'click',
            function () {

                const value =
                    page
                        .querySelector('#tcm-api-key')
                        .value
                        .trim();

                GM_setValue(
                    KEY_API,
                    value
                );

                setStatus(
                    root,
                    value
                        ? 'API key saved'
                        : 'API key cleared'
                );
            }
        );

        page.querySelector(
            '#tcm-run'
        ).addEventListener(
            'click',
            function () {

                showTab(
                    root,
                    'diagnostics'
                );

                runFullTest(root);
            }
        );

        page.querySelector(
            '#tcm-pda-toggle'
        ).addEventListener(
            'click',
            function () {

                const newValue =
                    !GM_getValue(
                        KEY_PDA,
                        true
                    );

                GM_setValue(
                    KEY_PDA,
                    newValue
                );

                renderSettings(root);
            }
        );

        page
            .querySelectorAll('.tcm-swatch')
            .forEach(swatch => {

                swatch.addEventListener(
                    'click',
                    function () {

                        GM_setValue(
                            KEY_THEME,
                            swatch.dataset.theme
                        );

                        const rootEl =
                            document.getElementById(
                                ROOT_ID
                            );

                        if (rootEl) {
                            rootEl.style.setProperty(
                                '--tcm-accent',
                                themes[
                                    swatch.dataset.theme
                                ]
                            );
                        }

                        renderSettings(root);
                    }
                );
            });

        page.querySelector(
            '#tcm-reset-position'
        ).addEventListener(
            'click',
            resetPositions
        );
    }

    // ================================================================
    // STATUS
    // ================================================================

    function setStatus(root, text) {

        const status =
            root.querySelector(
                '#tcm-status'
            );

        if (status) {
            status.textContent = text;
        }
    }

    // ================================================================
    // FULL TEST
    // ================================================================

    async function runFullTest(root) {

        if (state.running) {
            return;
        }

        state.running = true;

        setStatus(
            root,
            'Testing Torn API…'
        );

        root.querySelector(
            '[data-page="diagnostics"]'
        ).innerHTML = `
            <div class="tcm-message">
                Running Torn API capability test…
                <br><br>
                This may take a few seconds because
                the requests are deliberately
                rate-limited.
            </div>
        `;

        try {

            state.results =
                await runDiagnostics();

            state.verdict =
                classify(state.results);

            renderOverview(root);
            renderDiagnostics(root);
            renderFinance(root);

            setStatus(
                root,
                'Test complete'
            );

        } catch (error) {

            setStatus(
                root,
                'Test failed'
            );

        } finally {

            state.running = false;
        }
    }

    // ================================================================
    // RESET POSITIONS
    // ================================================================

    function resetPositions() {

        GM_deleteValue(
            KEY_POS_BUTTON
        );

        GM_deleteValue(
            KEY_POS_PANEL
        );

        const root =
            document.getElementById(
                ROOT_ID
            );

        if (!root) {
            return;
        }

        const button =
            root.querySelector(
                '#tcm-button'
            );

        const panel =
            root.querySelector(
                '#tcm-panel'
            );

        button.style.left = '10px';
        button.style.bottom = '12px';
        button.style.top = 'auto';
        button.style.right = 'auto';

        panel.style.left = '12px';
        panel.style.bottom = '70px';
        panel.style.top = 'auto';
        panel.style.right = 'auto';

        setStatus(
            root,
            'Positions reset'
        );
    }

    // ================================================================
    // EVENTS
    // ================================================================

    function setupEvents(root) {

        const button =
            root.querySelector(
                '#tcm-button'
            );

        const panel =
            root.querySelector(
                '#tcm-panel'
            );

        const header =
            root.querySelector(
                '#tcm-header'
            );

        // ------------------------------------------------------------
        // BUTTON DRAG
        // ------------------------------------------------------------

        makeDraggable(
            button,
            button,
            KEY_POS_BUTTON,
            false
        );

        // ------------------------------------------------------------
        // PANEL DRAG
        // ------------------------------------------------------------

        makeDraggable(
            header,
            panel,
            KEY_POS_PANEL,
            true
        );

        // ------------------------------------------------------------
        // BUTTON OPEN
        // ------------------------------------------------------------

        button.addEventListener(
            'click',
            function () {

                if (
                    button.dataset.dragged === '1'
                ) {

                    button.dataset.dragged =
                        '0';

                    return;
                }

                panel.classList.toggle(
                    'tcm-visible'
                );

                if (
                    panel.classList.contains(
                        'tcm-visible'
                    )
                ) {

                    showTab(
                        root,
                        state.currentTab
                    );
                }
            }
        );

        // ------------------------------------------------------------
        // HEADER BUTTONS
        // ------------------------------------------------------------

        root
            .querySelector(
                '[data-action="close"]'
            )
            .addEventListener(
                'click',
                function () {

                    panel.classList.remove(
                        'tcm-visible'
                    );
                }
            );

        root
            .querySelector(
                '[data-action="settings"]'
            )
            .addEventListener(
                'click',
                function () {

                    showTab(
                        root,
                        'settings'
                    );
                }
            );

        root
            .querySelector(
                '[data-action="refresh"]'
            )
            .addEventListener(
                'click',
                function () {

                    showTab(
                        root,
                        'diagnostics'
                    );

                    runFullTest(root);
                }
            );

        // ------------------------------------------------------------
        // TABS
        // ------------------------------------------------------------

        root
            .querySelectorAll(
                '#tcm-tabs button'
            )
            .forEach(tabButton => {

                tabButton.addEventListener(
                    'click',
                    function () {

                        showTab(
                            root,
                            tabButton.dataset.tab
                        );
                    }
                );
            });

        // ------------------------------------------------------------
        // WINDOW RESIZE
        // ------------------------------------------------------------

        window.addEventListener(
            'resize',
            function () {

                const buttonRect =
                    button.getBoundingClientRect();

                const buttonPos =
                    clampPosition(
                        buttonRect.left,
                        buttonRect.top,
                        button
                    );

                button.style.left =
                    buttonPos.left + 'px';

                button.style.top =
                    buttonPos.top + 'px';

                button.style.right =
                    'auto';

                button.style.bottom =
                    'auto';

                if (
                    panel.classList.contains(
                        'tcm-visible'
                    )
                ) {

                    const panelRect =
                        panel.getBoundingClientRect();

                    const panelPos =
                        clampPosition(
                            panelRect.left,
                            panelRect.top,
                            panel
                        );

                    panel.style.left =
                        panelPos.left + 'px';

                    panel.style.top =
                        panelPos.top + 'px';

                    panel.style.right =
                        'auto';

                    panel.style.bottom =
                        'auto';
                }
            }
        );
    }

    // ================================================================
    // BOOT
    // ================================================================

    function boot() {

        if (
            !document.body ||
            !document.head
        ) {
            return;
        }

        /*
         * If the old version somehow left its UI behind,
         * remove it before creating this version.
         */

        const old =
            document.getElementById(
                ROOT_ID
            );

        if (old) {
            old.remove();
        }

        const oldStyle =
            document.getElementById(
                'tcm-style'
            );

        if (oldStyle) {
            oldStyle.remove();
        }

        injectCSS();

        const root =
            createRoot();

        root.style.setProperty(
            '--tcm-accent',
            accent()
        );

        const button =
            root.querySelector(
                '#tcm-button'
            );

        const panel =
            root.querySelector(
                '#tcm-panel'
            );

        // ------------------------------------------------------------
        // RESTORE BUTTON POSITION
        // ------------------------------------------------------------

        const savedButton =
            GM_getValue(
                KEY_POS_BUTTON,
                null
            );

        if (
            savedButton &&
            typeof savedButton.left === 'number' &&
            typeof savedButton.top === 'number'
        ) {

            button.style.left =
                savedButton.left + 'px';

            button.style.top =
                savedButton.top + 'px';

            button.style.right =
                'auto';

            button.style.bottom =
                'auto';

        } else {

            // IMPORTANT:
            // PDA default = bottom left.

            button.style.left =
                '10px';

            button.style.bottom =
                '12px';
        }

        // ------------------------------------------------------------
        // RESTORE PANEL POSITION
        // ------------------------------------------------------------

        const savedPanel =
            GM_getValue(
                KEY_POS_PANEL,
                null
            );

        if (
            savedPanel &&
            typeof savedPanel.left === 'number' &&
            typeof savedPanel.top === 'number'
        ) {

            panel.style.left =
                savedPanel.left + 'px';

            panel.style.top =
                savedPanel.top + 'px';

            panel.style.right =
                'auto';

            panel.style.bottom =
                'auto';

        } else {

            panel.style.left =
                '12px';

            panel.style.bottom =
                '70px';
        }

        // ------------------------------------------------------------
        // INITIAL CONTENT
        // ------------------------------------------------------------

        renderOverview(root);
        renderDiagnostics(root);
        renderFinance(root);
        renderSettings(root);

        showTab(
            root,
            'overview'
        );

        setupEvents(root);

        setStatus(
            root,
            'Ready'
        );
    }

    // ================================================================
    // START
    // ================================================================

    if (
        document.readyState === 'loading'
    ) {

        document.addEventListener(
            'DOMContentLoaded',
            boot,
            { once: true }
        );

    } else {

        boot();
    }

})();
