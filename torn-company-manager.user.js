// ==UserScript==
// @name         Torn Company Management Suite
// @namespace    torn-company-management-suite
// @version      1.3.10
// @description  Torn Company Management Suite PDA compatibility shell
// @author       DooBiiE
// @match        https://www.torn.com/*
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  var VERSION = '1.3.10';

  function isCompanyPage() {
    var href = String(window.location.href || '');
    var path = String(window.location.pathname || '');
    return /\/companies\.php(?:[?#]|$)/i.test(href) ||
           /\/companies\.php\/?$/i.test(path);
  }

  function addStyles() {
    if (document.getElementById('tds-pda-test-style')) return;

    var style = document.createElement('style');
    style.id = 'tds-pda-test-style';
    style.textContent =
      '#tds-panel{' +
      'box-sizing:border-box;width:100%;margin:12px 0;padding:0;' +
      'background:#2b2b2b;color:#ddd;border:1px solid #555;' +
      'border-radius:8px;font:13px Arial,sans-serif;overflow:hidden;' +
      'position:relative;z-index:50}' +
      '#tds-header{padding:12px;background:#383838;border-bottom:1px solid #555}' +
      '#tds-brand{font-weight:bold;color:#3ddc84}' +
      '#tds-tabs{padding:8px;background:#303030;border-bottom:1px solid #555}' +
      '.tds-tab{display:inline-block;margin-right:12px;color:#bbb}' +
      '#tds-body{padding:12px}' +
      '.tds-box{padding:10px;border:1px solid #555;border-radius:6px;background:#333}' +
      '#tds-footer{padding:8px 12px;background:#383838;border-top:1px solid #555;font-size:11px}';

    document.head.appendChild(style);
  }

  function findMount() {
    var selectors = [
      '.companies-wrap',
      '#companies-page',
      '.content-wrapper',
      '#main-container',
      '#mainContainer',
      '.cont-gray',
      'main',
      '[role="main"]'
    ];

    var i;
    var el;

    for (i = 0; i < selectors.length; i += 1) {
      el = document.querySelector(selectors[i]);
      if (el) return el;
    }

    return document.body;
  }

  function buildPanel() {
    if (!isCompanyPage()) return;
    if (document.getElementById('tds-panel')) return;

    addStyles();

    var mount = findMount();
    if (!mount) return;

    var panel = document.createElement('section');
    panel.id = 'tds-panel';

    var header = document.createElement('div');
    header.id = 'tds-header';

    var brand = document.createElement('span');
    brand.id = 'tds-brand';
    brand.textContent = 'TORN COMPANY MANAGEMENT SUITE v' + VERSION;
    header.appendChild(brand);

    var tabs = document.createElement('div');
    tabs.id = 'tds-tabs';

    var tabNames = [
      'OVERVIEW',
      'COMPANY FINANCIALS',
      'STOCK',
      'TRAINING',
      'EMPLOYEE EFFECTIVENESS',
      'COMPARE',
      'SETTINGS',
      'DIAGNOSTICS'
    ];

    var i;
    for (i = 0; i < tabNames.length; i += 1) {
      var tab = document.createElement('span');
      tab.className = 'tds-tab';
      tab.textContent = tabNames[i];
      tabs.appendChild(tab);
    }

    var body = document.createElement('div');
    body.id = 'tds-body';

    var box = document.createElement('div');
    box.className = 'tds-box';

    var strong = document.createElement('strong');
    strong.textContent = 'PDA minimal shell loaded successfully.';
    box.appendChild(strong);
    box.appendChild(document.createElement('br'));
    box.appendChild(document.createTextNode(
      'This test contains no API calls, GM functions, IndexedDB, template literals, optional chaining, nullish coalescing, async/await, object spread, or advanced application code.'
    ));

    body.appendChild(box);

    var footer = document.createElement('div');
    footer.id = 'tds-footer';
    footer.textContent = 'Torn Company Management Suite v' + VERSION + ' - PDA minimal shell';

    panel.appendChild(header);
    panel.appendChild(tabs);
    panel.appendChild(body);
    panel.appendChild(footer);

    if (mount.firstChild) {
      mount.insertBefore(panel, mount.firstChild);
    } else {
      mount.appendChild(panel);
    }

    console.log('[TDS] PDA minimal shell mounted');
  }

  function start() {
    console.log('[TDS] v' + VERSION + ' minimal script started');

    buildPanel();

    var attempts = 0;
    var timer = window.setInterval(function () {
      attempts += 1;
      buildPanel();

      if (document.getElementById('tds-panel') || attempts >= 60) {
        window.clearInterval(timer);
      }
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
}());
