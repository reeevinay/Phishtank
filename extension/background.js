/**
 * PhishTank Firefox Extension - Production Background Service Script
 * Proxies API requests to configured PhishTank backend (with localhost/127.0.0.1 defaults),
 * bypassing page-level CSP and mixed-content restrictions on HTTPS sites (Gmail, Outlook).
 */

async function getBackendUrl() {
  return new Promise((resolve) => {
    try {
      chrome.storage.sync.get(['backendUrl'], (result) => {
        resolve(result?.backendUrl || 'http://localhost:3000');
      });
    } catch {
      resolve('http://localhost:3000');
    }
  });
}

async function callBackend(payload) {
  const configuredUrl = await getBackendUrl();
  const cleanBase = configuredUrl.replace(/\/+$/, '');

  const endpoints = [
    `${cleanBase}/api/v1/analyze-dom`
  ];

  // If testing locally, also try 127.0.0.1 as dual-stack fallback
  if (cleanBase.includes('localhost')) {
    endpoints.push('http://127.0.0.1:3000/api/v1/analyze-dom');
  }

  let lastError = null;
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }
      return await res.json();
    } catch (err) {
      lastError = err;
      console.warn(`[PhishTank Background] Could not connect to ${url}, trying next endpoint...`, err);
    }
  }

  throw lastError || new Error(`Unable to connect to PhishTank server at ${configuredUrl}`);
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'ANALYZE_DOM') {
    callBackend(request.payload)
      .then((data) => {
        sendResponse({ success: true, data });
      })
      .catch((err) => {
        console.error('[PhishTank Background Proxy Error]', err);
        sendResponse({ success: false, error: err.message });
      });

    return true; // Keep message port open for asynchronous response
  }
});
