# PhishTank Firefox Extension (Manifest V3)

The **PhishTank Firefox Extension** enables one-click email threat analysis directly inside **Gmail**, **Outlook Web**, and local simulation environments without needing to download or upload `.eml` files.

---

## 🚀 Quick Start & Installation in Firefox

1. Open **Firefox**.
2. In the address bar, navigate to:
   ```text
   about:debugging#/runtime/this-firefox
   ```
3. Click the **"Load Temporary Add-on..."** button.
4. Browse to this project's `extension/` directory and select:
   ```text
   extension/manifest.json
   ```
5. The **PhishTank Email Threat Scanner** extension is now loaded and active!

---

## 🧪 Local Testing via Mock Webmail

You don't need a real phishing email in your personal inbox to test the extension:

1. Ensure the PhishTank API server is running on `http://localhost:3000` (`npm start`).
2. Open the mock webmail simulation page in Firefox:
   ```text
   http://localhost:3000/mock-webmail.html
   ```
3. Notice the **"🛡️ Report / Scan with PhishTank"** button injected in the toolbar (or floating at bottom-right).
4. Click the button or click the extension icon in Firefox's toolbar to open the popup and click **"Scan Current Email"**.
5. Observe:
   - A color-coded security banner injected directly above the email body:
     - 🚨 **CRITICAL THREAT: MALICIOUS EMAIL (Score: 100/100)** for the CEO spoofing spear-phish.
     - 🛡️ **PHISHTANK VERIFIED: CLEAN (Score: 0/100)** when you click "Load Benign Sample".
   - The popup displays the live 0–100 risk gauge, triggered rules (`SPF_FAIL`, `DISPLAY_NAME_SPOOFING`, `TYPOSQUATTING_URL`, `DANGEROUS_ATTACHMENT`), and reasons.
   - The incident is automatically persisted into `phishtank.db` and immediately visible in the main SOC dashboard at `http://localhost:3000`.

---

## 🛠️ Architecture

- **`manifest.json`**: Firefox Manifest V3 with Gecko extension ID (`phishtank-scanner@phishtank.local`), permissions for `activeTab`, `scripting`, and host permissions.
- **`content.js`**: Scrapes Gmail (`span.gD`, `h2.hP`, `div.a3s`, `span.aV3`), Outlook Web (`SenderPersona`, `rps_`, `attachment`), and mock webmail DOMs. Injects toolbar triggers and security banners.
- **`content.css`**: Styling for the injected scan button and color-coded security alerts.
- **`popup.html` & `popup.js`**: Dark-mode cybersecurity popup UI with live risk gauge, rule chips, and backend health status.
- **`POST /api/v1/analyze-dom`**: Backend endpoint in `src/server.ts` evaluating scraped DOM payloads and updating SQLite.
