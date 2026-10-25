import { simpleParser, ParsedMail } from 'mailparser';
import crypto from 'crypto';
import path from 'path';
import { cacheService } from './cache';

export interface ThreatAnalysisResult {
  id: string;
  sender: string;
  fromName: string;
  recipient: string;
  subject: string;
  date: string;
  score: number;
  verdict: 'CLEAN' | 'SUSPICIOUS' | 'MALICIOUS';
  reasons: string[];
  triggeredRules: string[];
  urls: string[];
  fileHashes: string[];
  attachmentDetails: {
    filename: string;
    extension: string;
    hash: string;
    dangerous: boolean;
    size: number;
    cached?: boolean;
  }[];
  details: {
    reasons: string[];
    triggeredRules: string[];
    urls: string[];
    fileHashes: string[];
    summary: string;
    rawAuthResults?: string;
    cached?: boolean;
    processingTimeMs?: number;
    emailHash?: string;
  };
}

const TARGET_DOMAINS = ['microsoft.com', 'google.com', 'threatcop.com', 'paypal.com'];

const DANGEROUS_EXTENSIONS = new Set(['.exe', '.scr', '.vbs', '.bat', '.ps1', '.iso']);

const FREE_MAIL_DOMAINS = new Set([
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'aol.com',
  'icloud.com',
  'mail.com',
  'proton.me',
  'protonmail.com',
  'zoho.com',
  'yandex.com'
]);

const EXECUTIVE_TITLE_REGEX = /\b(ceo|cfo|cto|cio|coo|president|director|executive|administrator|admin|it\s+support|helpdesk|payroll|security|it\s+department)\b/i;

/**
 * Calculates the Levenshtein edit distance between two strings.
 */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,       // deletion
        dp[i][j - 1] + 1,       // insertion
        dp[i - 1][j - 1] + cost // substitution
      );
    }
  }
  return dp[m][n];
}

/**
 * Extracts all unique URLs from plain text and HTML email content.
 */
export function extractUrls(text?: string, html?: string | boolean): string[] {
  const htmlContent = typeof html === 'string' ? html : '';
  const combined = `${text || ''} ${htmlContent}`;
  const urlRegex = /https?:\/\/[^\s"'<>\\]+/gi;
  const matches = combined.match(urlRegex) || [];
  const uniqueUrls = new Set<string>();

  for (const rawUrl of matches) {
    try {
      const cleaned = rawUrl.replace(/[.,;:)]+$/, '');
      const parsed = new URL(cleaned);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        uniqueUrls.add(cleaned);
      }
    } catch {
      // Ignore invalid or malformed URL formats
    }
  }
  return Array.from(uniqueUrls);
}

/**
 * Analyzes an EML buffer and evaluates email security threat score (0-100).
 * Leverages Redis / In-Memory cache for O(1) deduplication of bulk emails,
 * cached attachment hashes, and URL lookups.
 */
export async function analyzeEmail(emlBuffer: Buffer, assignedId?: string): Promise<ThreatAnalysisResult> {
  const startTime = Date.now();
  const emailHash = crypto.createHash('sha256').update(emlBuffer).digest('hex');

  // 1. Check if the identical email has already been analyzed in cache
  const cachedEmail = await cacheService.getEmailVerdict<ThreatAnalysisResult>(emailHash);
  if (cachedEmail) {
    const elapsed = Date.now() - startTime;
    const finalId = assignedId || cachedEmail.id;
    return {
      ...cachedEmail,
      id: finalId,
      date: new Date().toISOString(),
      details: {
        ...cachedEmail.details,
        cached: true,
        processingTimeMs: Math.max(1, elapsed),
        emailHash
      }
    };
  }

  const parsed: ParsedMail = await simpleParser(emlBuffer);

  let score = 0;
  const reasons: string[] = [];
  const triggeredRules: string[] = [];

  // Extract core metadata
  const fromAddress = (parsed.from?.value?.[0]?.address || '').toLowerCase().trim();
  const fromName = parsed.from?.value?.[0]?.name || '';
  const fromDomain = fromAddress.includes('@') ? fromAddress.split('@')[1] : '';
  const replyToAddress = (parsed.replyTo?.value?.[0]?.address || '').toLowerCase().trim();
  const recipient = (parsed.to && 'text' in parsed.to ? parsed.to.text : '') || 'undisclosed-recipients';
  const subject = parsed.subject || '(No Subject)';
  const dateStr = parsed.date ? parsed.date.toISOString() : new Date().toISOString();

  // 2. Authentication-Results Check
  // spf=fail/softfail (+35), dkim=fail (+25), dmarc=fail (+30)
  let rawAuthHeader = '';
  if (parsed.headers) {
    const rawVal = parsed.headers.get('authentication-results');
    if (typeof rawVal === 'string') {
      rawAuthHeader = rawVal;
    } else if (Array.isArray(rawVal)) {
      rawAuthHeader = rawVal.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join('; ');
    } else if (rawVal && typeof rawVal === 'object') {
      rawAuthHeader = JSON.stringify(rawVal);
    }
  }
  if (parsed.headerLines) {
    for (const h of parsed.headerLines) {
      if (h.key && h.key.toLowerCase() === 'authentication-results') {
        rawAuthHeader += ' ' + h.line;
      }
    }
  }

  const authLower = rawAuthHeader.toLowerCase();

  if (/spf=(fail|softfail)/i.test(authLower)) {
    score += 35;
    reasons.push('SPF authentication failed or softfailed (spf=fail/softfail)');
    triggeredRules.push('SPF_FAIL');
  }

  if (/dkim=fail/i.test(authLower)) {
    score += 25;
    reasons.push('DKIM cryptographic signature verification failed (dkim=fail)');
    triggeredRules.push('DKIM_FAIL');
  }

  if (/dmarc=fail/i.test(authLower)) {
    score += 30;
    reasons.push('DMARC policy validation failed (dmarc=fail)');
    triggeredRules.push('DMARC_FAIL');
  }

  // 3. Reply-To Mismatch Check (+20)
  if (replyToAddress && fromAddress && replyToAddress !== fromAddress) {
    score += 20;
    reasons.push(`Reply-To address mismatch detected: From <${fromAddress}> differs from Reply-To <${replyToAddress}>`);
    triggeredRules.push('REPLY_TO_MISMATCH');
  }

  // 4. Executive / IT Display Name Spoofing from Free Webmail (+30)
  const isExecutiveOrIT = EXECUTIVE_TITLE_REGEX.test(fromName);
  const isFreeWebmail = FREE_MAIL_DOMAINS.has(fromDomain);
  if (isExecutiveOrIT && isFreeWebmail) {
    score += 30;
    reasons.push(`Executive/IT impersonation: Display name "${fromName}" originated from public free webmail provider (@${fromDomain})`);
    triggeredRules.push('DISPLAY_NAME_SPOOFING');
  }

  // 5. Extracted URLs and Levenshtein Distance Check (+35) with Caching
  const extractedUrls = extractUrls(parsed.text, parsed.html);
  let typosquattingFound = false;

  for (const urlStr of extractedUrls) {
    try {
      // Check cache for this URL verdict
      const cachedUrl = await cacheService.getUrlVerdict<{ typosquatting: boolean; reason?: string }>(urlStr);
      if (cachedUrl) {
        if (cachedUrl.typosquatting && !typosquattingFound) {
          typosquattingFound = true;
          if (cachedUrl.reason) reasons.push(cachedUrl.reason);
          triggeredRules.push('TYPOSQUATTING_URL');
        }
        continue;
      }

      const parsedUrl = new URL(urlStr);
      const hostname = parsedUrl.hostname.toLowerCase().replace(/^www\./, '');
      const parts = hostname.split('.');
      const rootDomain = parts.length >= 2 ? parts.slice(-2).join('.') : hostname;

      let isTyposquatted = false;
      let matchedReason = '';

      for (const target of TARGET_DOMAINS) {
        // Legitimate target domain match (distance 0) -> not typosquatting
        if (hostname === target || rootDomain === target) {
          continue;
        }

        const distRoot = levenshteinDistance(rootDomain, target);
        const distHost = levenshteinDistance(hostname, target);
        const minDistance = Math.min(distRoot, distHost);

        if (minDistance >= 1 && minDistance <= 2) {
          isTyposquatted = true;
          matchedReason = `Typosquatting URL detected: "${hostname}" has Levenshtein distance of ${minDistance} from legitimate "${target}"`;
          break;
        }
      }

      // Cache URL result
      await cacheService.setUrlVerdict(urlStr, { typosquatting: isTyposquatted, reason: matchedReason });

      if (isTyposquatted && !typosquattingFound) {
        typosquattingFound = true;
        reasons.push(matchedReason);
        triggeredRules.push('TYPOSQUATTING_URL');
      }
    } catch {
      // Ignore URL parsing errors
    }
  }

  if (typosquattingFound) {
    score += 35;
  }

  // 6. Attachments SHA-256 Hashing & Dangerous File Extension Check (+40) with Caching
  const fileHashes: string[] = [];
  const attachmentDetails: ThreatAnalysisResult['attachmentDetails'] = [];
  let dangerousAttachmentFound = false;

  if (parsed.attachments && parsed.attachments.length > 0) {
    for (const att of parsed.attachments) {
      const hash = crypto.createHash('sha256').update(att.content).digest('hex');
      fileHashes.push(hash);

      const filename = att.filename || 'unnamed_attachment';
      const ext = path.extname(filename).toLowerCase();

      // Check cache for this attachment hash
      const cachedAtt = await cacheService.getAttachmentVerdict<{ dangerous: boolean; reason?: string }>(hash);
      let isDangerous = false;
      let reason = '';

      if (cachedAtt) {
        isDangerous = cachedAtt.dangerous;
        reason = cachedAtt.reason || '';
        attachmentDetails.push({
          filename,
          extension: ext,
          hash,
          dangerous: isDangerous,
          size: att.size || att.content.length,
          cached: true
        });
      } else {
        isDangerous = DANGEROUS_EXTENSIONS.has(ext);
        if (isDangerous) {
          reason = `Dangerous file attachment detected: "${filename}" (${ext}) [SHA-256: ${hash}]`;
        }
        await cacheService.setAttachmentVerdict(hash, { dangerous: isDangerous, reason });

        attachmentDetails.push({
          filename,
          extension: ext,
          hash,
          dangerous: isDangerous,
          size: att.size || att.content.length,
          cached: false
        });
      }

      if (isDangerous) {
        dangerousAttachmentFound = true;
        if (reason && !reasons.includes(reason)) {
          reasons.push(reason);
        }
        if (!triggeredRules.includes('DANGEROUS_ATTACHMENT')) {
          triggeredRules.push('DANGEROUS_ATTACHMENT');
        }
      }
    }
  }

  if (dangerousAttachmentFound) {
    score += 40;
  }

  // Normalize final score between 0 and 100
  const finalScore = Math.min(100, Math.max(0, score));

  // Determine threat verdict
  let verdict: 'CLEAN' | 'SUSPICIOUS' | 'MALICIOUS';
  if (finalScore >= 70) {
    verdict = 'MALICIOUS';
  } else if (finalScore >= 35) {
    verdict = 'SUSPICIOUS';
  } else {
    verdict = 'CLEAN';
  }

  const id = assignedId || `inc_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const duration = Date.now() - startTime;

  const summary = reasons.length > 0
    ? reasons.join('; ')
    : 'No suspicious indicators or authentication failures found. Email appears clean.';

  const result: ThreatAnalysisResult = {
    id,
    sender: fromAddress || fromName || 'unknown-sender',
    fromName,
    recipient,
    subject,
    date: dateStr,
    score: finalScore,
    verdict,
    reasons,
    triggeredRules,
    urls: extractedUrls,
    fileHashes,
    attachmentDetails,
    details: {
      reasons,
      triggeredRules,
      urls: extractedUrls,
      fileHashes,
      summary,
      rawAuthResults: rawAuthHeader || undefined,
      cached: false,
      processingTimeMs: Math.max(1, duration),
      emailHash
    }
  };

  // Cache overall email verdict for O(1) deduplication of identical emails
  await cacheService.setEmailVerdict(emailHash, result, 3600);

  return result;
}

export interface DomAnalysisPayload {
  sender?: string;
  senderName?: string;
  senderEmail?: string;
  replyTo?: string;
  subject?: string;
  urls?: string[];
  attachments?: (string | { filename: string; size?: number })[];
  rawHeaders?: string;
}

const SUSPICIOUS_TLDS = new Set(['.top', '.xyz', '.club', '.work', '.click', '.loan', '.gq', '.cf', '.tk', '.ml', '.ga']);

/**
 * Analyzes an open email directly from browser DOM scraping (e.g. Gmail/Outlook extension).
 * Applies the exact same heuristic scoring rules as raw .eml parsing.
 */
export async function analyzeDomEmail(payload: DomAnalysisPayload, assignedId?: string): Promise<ThreatAnalysisResult> {
  const startTime = Date.now();

  const fromAddress = (payload.senderEmail || payload.sender || '').toLowerCase().trim();
  const fromName = payload.senderName || '';
  const fromDomain = fromAddress.includes('@') ? fromAddress.split('@')[1] : '';
  const replyToAddress = (payload.replyTo || '').toLowerCase().trim();
  const subject = payload.subject || '(No Subject)';
  const urls = Array.isArray(payload.urls) ? payload.urls : [];
  const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
  const rawHeaders = payload.rawHeaders || '';

  // Deduplication cache key from DOM fields
  const domHash = crypto.createHash('sha256')
    .update(JSON.stringify({ fromAddress, fromName, replyToAddress, subject, urls, attachments, rawHeaders }))
    .digest('hex');

  // Check cache for identical DOM payload
  const cachedDom = await cacheService.getEmailVerdict<ThreatAnalysisResult>(domHash);
  if (cachedDom) {
    const elapsed = Date.now() - startTime;
    return {
      ...cachedDom,
      id: assignedId || cachedDom.id,
      date: new Date().toISOString(),
      details: {
        ...cachedDom.details,
        cached: true,
        processingTimeMs: Math.max(1, elapsed),
        emailHash: domHash
      }
    };
  }

  let score = 0;
  const reasons: string[] = [];
  const triggeredRules: string[] = [];

  // 1. Authentication Headers (if scraped or available in rawHeaders)
  if (rawHeaders) {
    const authLower = rawHeaders.toLowerCase();
    if (/spf=(fail|softfail)/i.test(authLower)) {
      score += 35;
      reasons.push('SPF authentication failed or softfailed in raw headers');
      triggeredRules.push('SPF_FAIL');
    }
    if (/dkim=fail/i.test(authLower)) {
      score += 25;
      reasons.push('DKIM cryptographic signature verification failed');
      triggeredRules.push('DKIM_FAIL');
    }
    if (/dmarc=fail/i.test(authLower)) {
      score += 30;
      reasons.push('DMARC policy validation failed');
      triggeredRules.push('DMARC_FAIL');
    }
  }

  // 2. Reply-To Mismatch
  if (replyToAddress && fromAddress && replyToAddress !== fromAddress) {
    score += 20;
    reasons.push(`Reply-To address mismatch detected: From <${fromAddress}> differs from Reply-To <${replyToAddress}>`);
    triggeredRules.push('REPLY_TO_MISMATCH');
  }

  // 3. Executive / IT Display Name Spoofing from Free Webmail
  const isExecutiveOrIT = EXECUTIVE_TITLE_REGEX.test(fromName);
  const isFreeWebmail = FREE_MAIL_DOMAINS.has(fromDomain);
  if (isExecutiveOrIT && isFreeWebmail) {
    score += 30;
    reasons.push(`Executive/IT impersonation: Display name "${fromName}" originated from public free webmail provider (@${fromDomain})`);
    triggeredRules.push('DISPLAY_NAME_SPOOFING');
  }

  // 4. URL Levenshtein Typosquatting & Suspicious TLD Inspection
  let typosquattingFound = false;
  let suspiciousTldFound = false;

  for (const urlStr of urls) {
    try {
      const parsedUrl = new URL(urlStr);
      const hostname = parsedUrl.hostname.toLowerCase().replace(/^www\./, '');
      const parts = hostname.split('.');
      const rootDomain = parts.length >= 2 ? parts.slice(-2).join('.') : hostname;

      // Check Typosquatting against high-value domains
      for (const target of TARGET_DOMAINS) {
        if (hostname === target || rootDomain === target) continue;

        const distRoot = levenshteinDistance(rootDomain, target);
        const distHost = levenshteinDistance(hostname, target);
        const minDistance = Math.min(distRoot, distHost);

        if (minDistance >= 1 && minDistance <= 2) {
          typosquattingFound = true;
          const r = `Typosquatting URL detected: "${hostname}" has Levenshtein distance of ${minDistance} from legitimate "${target}"`;
          if (!reasons.includes(r)) reasons.push(r);
          if (!triggeredRules.includes('TYPOSQUATTING_URL')) triggeredRules.push('TYPOSQUATTING_URL');
          break;
        }
      }

      // Check Suspicious TLDs
      for (const tld of SUSPICIOUS_TLDS) {
        if (hostname.endsWith(tld) && !suspiciousTldFound) {
          suspiciousTldFound = true;
          const r = `Suspicious high-risk TLD detected in link: "${hostname}" (${tld})`;
          if (!reasons.includes(r)) reasons.push(r);
          if (!triggeredRules.includes('SUSPICIOUS_TLD')) triggeredRules.push('SUSPICIOUS_TLD');
          break;
        }
      }
    } catch {
      // Ignore invalid URL formatting
    }
  }

  if (typosquattingFound) score += 35;
  if (suspiciousTldFound) score += 15;

  // 5. Risky Attachment Extensions
  const attachmentDetails: ThreatAnalysisResult['attachmentDetails'] = [];
  const fileHashes: string[] = [];
  let dangerousAttachmentFound = false;

  for (const item of attachments) {
    const filename = typeof item === 'string' ? item : item.filename || 'attachment';
    const ext = path.extname(filename).toLowerCase();
    const isDangerous = DANGEROUS_EXTENSIONS.has(ext);

    attachmentDetails.push({
      filename,
      extension: ext,
      hash: 'scraped_from_dom',
      dangerous: isDangerous,
      size: typeof item === 'object' && item.size ? item.size : 0,
      cached: false
    });

    if (isDangerous) {
      dangerousAttachmentFound = true;
      const r = `Dangerous file attachment detected: "${filename}" (${ext})`;
      if (!reasons.includes(r)) reasons.push(r);
      if (!triggeredRules.includes('DANGEROUS_ATTACHMENT')) triggeredRules.push('DANGEROUS_ATTACHMENT');
    }
  }

  if (dangerousAttachmentFound) {
    score += 40;
  }

  const finalScore = Math.min(100, Math.max(0, score));

  let verdict: 'CLEAN' | 'SUSPICIOUS' | 'MALICIOUS';
  if (finalScore >= 70) {
    verdict = 'MALICIOUS';
  } else if (finalScore >= 35) {
    verdict = 'SUSPICIOUS';
  } else {
    verdict = 'CLEAN';
  }

  const id = assignedId || `inc_dom_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const duration = Date.now() - startTime;

  const summary = reasons.length > 0
    ? reasons.join('; ')
    : 'No suspicious indicators found in scraped DOM elements. Email appears clean.';

  const result: ThreatAnalysisResult = {
    id,
    sender: fromAddress || fromName || 'unknown-sender',
    fromName,
    recipient: 'Scraped Webmail Session',
    subject,
    date: new Date().toISOString(),
    score: finalScore,
    verdict,
    reasons,
    triggeredRules,
    urls,
    fileHashes,
    attachmentDetails,
    details: {
      reasons,
      triggeredRules,
      urls,
      fileHashes,
      summary,
      rawAuthResults: rawHeaders || undefined,
      cached: false,
      processingTimeMs: Math.max(1, duration),
      emailHash: domHash
    }
  };

  // Cache verdict for duplicate extension scans
  await cacheService.setEmailVerdict(domHash, result, 3600);

  return result;
}
