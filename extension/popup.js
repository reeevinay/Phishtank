/**
 * PhishTank Firefox Extension - Popup Script
 */

document.addEventListener('DOMContentLoaded', async () => {
  const BACKEND_HEALTH = 'http://localhost:3000/api/v1/health';
  const BACKEND_ANALYZE_DOM = 'http://localhost:3000/api/v1/analyze-dom';

  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const previewSubject = document.getElementById('previewSubject');
  const previewSender = document.getElementById('previewSender');
  const scanBtn = document.getElementById('scanBtn');
  const scanBtnText = document.getElementById('scanBtnText');
  const resultSection = document.getElementById('resultSection');
  const scoreBox = document.getElementById('scoreBox');
  const scoreNum = document.getElementById('scoreNum');
  const verdictBadge = document.getElementById('verdictBadge');
  const timingBadge = document.getElementById('timingBadge');
  const rulesList = document.getElementById('rulesList');
  const reasonsUl = document.getElementById('reasonsUl');

  let currentScrapedData = null;

  // 1. Check Backend Connectivity
  try {
    const res = await fetch(BACKEND_HEALTH);
    if (res.ok) {
      statusDot.style.background = '#10b981';
      statusText.innerText = 'SOC Online';
    } else {
      throw new Error();
    }
  } catch {
    statusDot.style.background = '#ef4444';
    statusText.innerText = 'SOC Offline';
  }

  // 2. Fetch context from active tab
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      chrome.tabs.sendMessage(tab.id, { action: 'SCRAPE_EMAIL' }, (response) => {
        if (chrome.runtime.lastError || !response || !response.data) {
          previewSubject.innerText = 'No webmail detected';
          previewSender.innerText = 'Open an email in Gmail, Outlook, or mock webmail';
          return;
        }

        currentScrapedData = response.data;
        previewSubject.innerText = currentScrapedData.subject || '(No Subject)';
        previewSender.innerText = `From: ${currentScrapedData.sender || 'Unknown'}`;
      });
    }
  } catch (err) {
    console.warn('Could not query active tab:', err);
  }

  // 3. Scan Button Click Handler
  scanBtn.addEventListener('click', async () => {
    scanBtn.classList.add('scanning');
    scanBtnText.innerText = 'Analyzing Heuristics...';

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      // Trigger scan in content script (which both analyzes and injects banner on webmail page)
      if (tab && tab.id) {
        chrome.tabs.sendMessage(tab.id, { action: 'SCAN_EMAIL' }, (response) => {
          if (response && response.result) {
            renderResult(response.result.incident || response.result);
          } else if (currentScrapedData) {
            // Direct fetch fallback if content script did not return result directly
            fallbackDirectScan();
          } else {
            alert('Failed to scan email. Ensure an email is open in the active tab.');
          }
          resetBtn();
        });
      } else if (currentScrapedData) {
        await fallbackDirectScan();
        resetBtn();
      } else {
        alert('No email data available to scan.');
        resetBtn();
      }
    } catch (err) {
      console.error(err);
      alert('Error during scan: ' + err.message);
      resetBtn();
    }
  });

  async function fallbackDirectScan() {
    try {
      const res = await fetch(BACKEND_ANALYZE_DOM, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentScrapedData)
      });
      const data = await res.json();
      if (data.incident || data.id) {
        renderResult(data.incident || data);
      }
    } catch (err) {
      alert('Direct scan error: ' + err.message);
    }
  }

  function resetBtn() {
    scanBtn.classList.remove('scanning');
    scanBtnText.innerText = 'Re-Scan Current Email';
  }

  function renderResult(item) {
    resultSection.style.display = 'block';

    const score = item.score !== undefined ? item.score : 0;
    const verdict = item.verdict || 'CLEAN';
    const rules = item.triggeredRules || (item.details && item.details.triggeredRules) || [];
    const reasons = item.reasons || (item.details && item.details.reasons) || [];
    const details = item.details || {};

    scoreNum.innerText = score;
    verdictBadge.innerText = verdict;

    // Timing & Cache Badge
    const isCached = Boolean(details.cached);
    const timeMs = details.processingTimeMs || 1;
    if (isCached) {
      timingBadge.innerText = `⚡ Cache Hit (${timeMs}ms)`;
      timingBadge.style.color = '#38bdf8';
    } else {
      timingBadge.innerText = `⏱️ Proc Time: ${timeMs}ms`;
      timingBadge.style.color = '#818cf8';
    }

    // Dynamic color theme
    scoreBox.className = 'score-box';
    verdictBadge.className = 'verdict-badge';

    if (verdict === 'MALICIOUS') {
      scoreBox.classList.add('malicious-theme');
      verdictBadge.classList.add('malicious-theme');
    } else if (verdict === 'SUSPICIOUS') {
      scoreBox.classList.add('suspicious-theme');
      verdictBadge.classList.add('suspicious-theme');
    } else {
      scoreBox.classList.add('clean-theme');
      verdictBadge.classList.add('clean-theme');
    }

    // Rules tags
    if (rules.length === 0) {
      rulesList.innerHTML = '<span class="rule-chip" style="color:#34d399">ALL_CHECKS_PASSED</span>';
    } else {
      rulesList.innerHTML = rules.map(r => `<span class="rule-chip">${r}</span>`).join('');
    }

    // Reasons
    if (reasons.length === 0) {
      reasonsUl.innerHTML = '<li>✓ No suspicious indicators detected. Email verified clean.</li>';
    } else {
      reasonsUl.innerHTML = reasons.map(r => `<li>${r}</li>`).join('');
    }
  }
});
