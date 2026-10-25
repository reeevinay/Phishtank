/**
 * PhishTank Firefox Extension - Content Script (Optimized for Real Gmail & Outlook)
 * Scrapes open emails, proxies analysis through extension background script (bypassing CSP/mixed-content),
 * and injects interactive security alerts.
 */

(function () {
  /**
   * Scrapes metadata from currently open/expanded email in Gmail, Outlook Web, or Mock Webmail.
   */
  function scrapeEmail() {
    let senderName = '';
    let senderEmail = '';
    let replyTo = '';
    let subject = '';
    const urls = new Set();
    const attachments = [];
    let rawHeaders = '';

    // Prefer currently expanded/active message in a Gmail conversation thread
    const activeThreadItem =
      document.querySelector('div.adn.ads') ||
      document.querySelector('div[data-message-id]:not([aria-hidden="true"])') ||
      document;

    // 1. Scrape Sender Name & Email
    const gmailSender = activeThreadItem.querySelector('span.gD') || document.querySelector('span.gD');
    if (gmailSender) {
      senderEmail = gmailSender.getAttribute('email') || '';
      senderName = gmailSender.getAttribute('name') || gmailSender.innerText.trim();

      // Fallback: extract email address from formatted text
      if (!senderEmail && gmailSender.innerText.includes('@')) {
        const match = gmailSender.innerText.match(/<([^>]+)>/) || gmailSender.innerText.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
        if (match) senderEmail = match[1];
      }
    }

    // Outlook Web Fallback
    if (!senderEmail) {
      const outlookSender = document.querySelector('div[data-testid="SenderPersona"], span[title*="@"], div.l89YQ');
      if (outlookSender) {
        senderEmail = outlookSender.getAttribute('title') || '';
        senderName = outlookSender.innerText.trim();
        if (senderEmail && !senderEmail.includes('@')) {
          senderName = senderEmail;
          senderEmail = '';
        }
      }
    }

    // 2. Scrape Subject
    const subjectEl =
      document.querySelector('h2.hP') ||
      document.querySelector('div[role="main"] h2') ||
      document.querySelector('div[role="heading"][aria-level="2"]') ||
      document.querySelector('span.allowTextSelection');

    if (subjectEl) {
      subject = subjectEl.innerText.trim();
    } else if (document.title && document.title.includes('Gmail')) {
      subject = document.title.replace(/ - Gmail.*$/, '').replace(/ - Google Accounts.*$/, '').trim();
    }

    // 3. Scrape Message Body & URLs
    const bodyEl =
      activeThreadItem.querySelector('div.a3s') ||
      document.querySelector('div.a3s') ||
      document.querySelector('div[aria-label="Message body"]') ||
      document.querySelector('div.rps_') ||
      document.querySelector('.email-body');

    if (bodyEl) {
      const links = bodyEl.querySelectorAll('a[href]');
      links.forEach((a) => {
        const href = a.getAttribute('href');
        if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
          try {
            const urlObj = new URL(href);
            // Unwrap Google's redirect tracking
            if (urlObj.hostname.includes('google.com') && urlObj.searchParams.has('q')) {
              urls.add(urlObj.searchParams.get('q'));
            } else {
              urls.add(href);
            }
          } catch {
            urls.add(href);
          }
        }
      });
    }

    // 4. Scrape Attachments
    const gmailAtts = activeThreadItem.querySelectorAll('span.aV3, div[role="listitem"] span.aV3');
    gmailAtts.forEach((att) => {
      const name = att.innerText.trim();
      if (name && !attachments.includes(name)) attachments.push(name);
    });

    const outlookAtts = document.querySelectorAll('div[data-testid="attachment"], div[role="list"] span[title]');
    outlookAtts.forEach((att) => {
      const name = att.getAttribute('title') || att.innerText.trim();
      if (name && !attachments.includes(name)) attachments.push(name);
    });

    // 5. Scrape Raw Headers (if present in DOM inspection panel or mock headers element)
    const headersEl = document.querySelector('#rawHeaders, [data-raw-headers]');
    if (headersEl) {
      rawHeaders = headersEl.getAttribute('data-raw-headers') || headersEl.innerText || '';
    }

    const replyToEl = document.querySelector('[data-reply-to], span.reply-to');
    if (replyToEl) {
      replyTo = replyToEl.getAttribute('data-reply-to') || replyToEl.innerText.trim();
    }

    return {
      sender: senderEmail || senderName || 'Unknown Sender',
      senderName: senderName || 'Unknown',
      senderEmail: senderEmail || '',
      replyTo,
      subject: subject || 'No Subject',
      urls: Array.from(urls),
      attachments,
      rawHeaders
    };
  }

  /**
   * Scans the active email via background script proxy to bypass page CSP/mixed-content restrictions.
   */
  function scanCurrentEmail(btnEl) {
    return new Promise((resolve) => {
      const data = scrapeEmail();

      if (!data.subject && !data.senderEmail && data.urls.length === 0) {
        alert('PhishTank Scanner: Please open an email first before scanning.');
        resolve(null);
        return;
      }

      if (btnEl) {
        btnEl.classList.add('scanning');
        btnEl.innerHTML = '<span>⏳</span> Analyzing Heuristics...';
      }

      // Delegate HTTP request to extension background script (immune to Gmail CSP and mixed-content)
      chrome.runtime.sendMessage({ action: 'ANALYZE_DOM', payload: data }, async (response) => {
        let finalIncident = null;

        if (response && response.success && response.data) {
          finalIncident = response.data.incident || response.data;
        } else {
          // Fallback: If background script wasn't responding (e.g. extension needs reload), attempt direct fetch
          console.warn('[PhishTank Content] Background proxy failed, attempting direct fetch...', response?.error);
          try {
            const directRes = await fetch('http://localhost:3000/api/v1/analyze-dom', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(data)
            });
            if (directRes.ok) {
              const directData = await directRes.json();
              finalIncident = directData.incident || directData;
            }
          } catch (directErr) {
            console.error('[PhishTank Content] Direct fetch fallback also failed:', directErr);
          }
        }

        if (btnEl) {
          btnEl.classList.remove('scanning');
          btnEl.innerHTML = '<span>🛡️</span> Report / Scan with PhishTank';
        }

        if (finalIncident) {
          injectSecurityBanner(finalIncident);
          resolve(finalIncident);
        } else {
          const detail = response?.error || 'Connection refused';
          alert(
            `PhishTank Error: Could not connect to PhishTank server at http://localhost:3000 (${detail}).\n\n` +
            `Fix:\n` +
            `1. Make sure the server is running ("npm start").\n` +
            `2. In Firefox, go to about:debugging#/runtime/this-firefox and click "Reload" under PhishTank Email Threat Scanner, then refresh this Gmail tab.`
          );
          resolve(null);
        }
      });
    });
  }

  /**
   * Injects a color-coded security banner directly above the email body.
   */
  function injectSecurityBanner(incident) {
    const existing = document.getElementById('phishtankSecurityBanner');
    if (existing) existing.remove();

    const activeThreadItem =
      document.querySelector('div.adn.ads') ||
      document.querySelector('div[data-message-id]:not([aria-hidden="true"])') ||
      document;

    const bodyAnchor =
      activeThreadItem.querySelector('div.a3s') ||
      document.querySelector('div.a3s') ||
      document.querySelector('div[aria-label="Message body"]') ||
      document.querySelector('.email-body') ||
      document.querySelector('h2.hP');

    if (!bodyAnchor) return;

    const banner = document.createElement('div');
    banner.id = 'phishtankSecurityBanner';

    const verdict = incident.verdict || 'CLEAN';
    const score = incident.score !== undefined ? incident.score : 0;
    const rules = incident.triggeredRules || (incident.details && incident.details.triggeredRules) || [];
    const reasons = incident.reasons || (incident.details && incident.details.reasons) || [];

    let bannerClass = 'phishtank-banner-clean';
    let badgeClass = 'phishtank-badge-clean';
    let icon = '🟢';
    let titleText = `PHISHTANK VERIFIED: CLEAN (Score: ${score}/100)`;
    let advisory = 'All cryptographic checks passed. No suspicious links, lookalike domains, or dangerous extensions found.';

    if (verdict === 'MALICIOUS') {
      bannerClass = 'phishtank-banner-malicious';
      badgeClass = 'phishtank-badge-malicious';
      icon = '🚨';
      titleText = `CRITICAL THREAT: MALICIOUS EMAIL (Score: ${score}/100)`;
      advisory = '⚠️ High-confidence phishing attack detected. Do NOT click any links, open attachments, or wire funds.';
    } else if (verdict === 'SUSPICIOUS') {
      bannerClass = 'phishtank-banner-suspicious';
      badgeClass = 'phishtank-badge-suspicious';
      icon = '⚠️';
      titleText = `SECURITY WARNING: SUSPICIOUS EMAIL (Score: ${score}/100)`;
      advisory = 'Caution: Multiple anomaly indicators or external free mail spoofing detected.';
    }

    const rulesHtml = rules.length > 0
      ? rules.map(r => `<span class="phishtank-rule-tag">${r}</span>`).join('')
      : '<span class="phishtank-rule-tag">ALL_CHECKS_PASSED</span>';

    const reasonsHtml = reasons.length > 0
      ? `<ul class="phishtank-reasons-list">${reasons.map(r => `<li>• ${r}</li>`).join('')}</ul>`
      : '';

    banner.className = `phishtank-security-banner ${bannerClass}`;
    banner.innerHTML = `
      <div class="phishtank-banner-header">
        <div class="phishtank-banner-title">
          <span>${icon}</span>
          <span>${titleText}</span>
          <span class="phishtank-badge ${badgeClass}">${verdict}</span>
        </div>
        <button class="phishtank-dismiss-btn" title="Dismiss Banner" id="phishtankDismissBtn">&times;</button>
      </div>

      <p style="margin: 4px 0 8px 0; font-size: 13px; font-weight: 500;">${advisory}</p>

      <div style="margin: 6px 0;">${rulesHtml}</div>
      ${reasonsHtml}

      <div class="phishtank-banner-actions">
        <a href="http://localhost:3000" target="_blank" class="phishtank-action-btn">
          View in SOC Dashboard &rarr;
        </a>
        <span style="font-size: 11px; opacity: 0.7; margin-left: auto;">
          Incident ID: ${incident.id || 'N/A'}
        </span>
      </div>
    `;

    bodyAnchor.parentNode.insertBefore(banner, bodyAnchor);

    const dismissBtn = banner.querySelector('#phishtankDismissBtn');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', () => banner.remove());
    }

    // Smooth scroll into view
    banner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /**
   * Injects the scan button into Gmail toolbar and floating in bottom-right.
   */
  function injectButtons() {
    const hasEmailOpen = document.querySelector('span.gD, h2.hP, div[data-testid="SenderPersona"], .email-content, div.a3s');
    if (!hasEmailOpen) return;

    // 1. In-Header Button
    const headerToolbar =
      document.querySelector('.gH') ||               // Gmail subject line container
      document.querySelector('.ha') ||               // Gmail header wrapper
      document.querySelector('.gE.iv') ||            // Gmail sender area
      document.querySelector('#emailToolbar') ||     // Mock Webmail toolbar
      document.querySelector('.email-toolbar');

    if (headerToolbar && !document.getElementById('phishtankScanBtn')) {
      const btn = document.createElement('button');
      btn.id = 'phishtankScanBtn';
      btn.type = 'button';
      btn.className = 'phishtank-scan-btn';
      btn.innerHTML = '<span>🛡️</span> Report / Scan with PhishTank';
      btn.addEventListener('click', () => scanCurrentEmail(btn));
      headerToolbar.appendChild(btn);
    }

    // 2. Floating Action Button (Always available in bottom-right of viewport)
    if (!document.getElementById('phishtankFloatingBtn')) {
      const floatingContainer = document.createElement('div');
      floatingContainer.id = 'phishtankFloatingBtn';
      floatingContainer.className = 'phishtank-floating-trigger';

      const floatBtn = document.createElement('button');
      floatBtn.type = 'button';
      floatBtn.className = 'phishtank-scan-btn';
      floatBtn.style.padding = '10px 18px';
      floatBtn.style.fontSize = '14px';
      floatBtn.style.boxShadow = '0 6px 20px rgba(79, 70, 229, 0.6)';
      floatBtn.innerHTML = '<span>🛡️</span> Scan Email with PhishTank';
      floatBtn.addEventListener('click', () => scanCurrentEmail(floatBtn));

      floatingContainer.appendChild(floatBtn);
      document.body.appendChild(floatingContainer);
    }
  }

  // Use MutationObserver for instant detection when user clicks emails in Gmail SPA
  const observer = new MutationObserver(() => {
    injectButtons();
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Fallback timer
  setInterval(injectButtons, 2000);

  // Message listener for popup communication
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'SCRAPE_EMAIL') {
      sendResponse({ success: true, data: scrapeEmail() });
      return false;
    }
    if (request.action === 'SCAN_EMAIL') {
      scanCurrentEmail().then((res) => {
        sendResponse({ success: Boolean(res), result: res });
      });
      return true; // asynchronous response
    }
  });

  // Initial injection attempt
  setTimeout(injectButtons, 1000);
})();
