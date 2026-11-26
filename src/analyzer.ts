import { simpleParser, ParsedMail } from 'mailparser';
import crypto from 'crypto';
import path from 'path';
import { cacheService } from './cache';
import { callMlEngine, MLInferResponse, SymbolicSignalsPayload } from './mlClient';
import { correlateCampaign, saveProvenanceGraph } from './db';
import { buildProvenanceArtifacts } from './graph';

export interface ThreatAnalysisResult {
  id: string;
  sender: string;
  fromName: string;
  recipient: string;
  subject: string;
  date: string;
  score: number;
  belief_low: number;
  plausibility_high: number;
  epistemic_uncertainty: number;
  conflict_k: number;
  verdict: 'CLEAN' | 'SUSPICIOUS' | 'MALICIOUS';
  campaign_id?: string;
  embedding?: number[];
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
    belief_malicious?: number;
    plausibility_malicious?: number;
    epistemic_uncertainty?: number;
    conflict_k?: number;
    neural_probability?: number;
    semantic_indicators?: string[];
    adversarial_flags?: string[];
    obfuscation_ratio?: number;
    zero_width_count?: number;
    homoglyph_count?: number;
    prompt_injection_hits?: string[];
    hidden_text_preview?: string;
    deobfuscated_preview?: string;
    evidence_sources?: unknown[];
    ml_fallback?: boolean;
  };
}

const TARGET_DOMAINS = ['microsoft.com', 'google.com', 'threatcop.com', 'paypal.com', 'okta.com', 'docusign.com'];
const DANGEROUS_EXTENSIONS = new Set(['.exe', '.scr', '.vbs', '.bat', '.ps1', '.iso', '.hta', '.js']);
const FREE_MAIL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com',
  'icloud.com', 'mail.com', 'proton.me', 'protonmail.com', 'zoho.com', 'yandex.com'
]);
const EXECUTIVE_TITLE_REGEX = /\b(ceo|cfo|cto|cio|coo|president|director|executive|administrator|admin|it\s+support|helpdesk|payroll|security|it\s+department)\b/i;

export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

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
      // ignore invalid URLs
    }
  }
  return Array.from(uniqueUrls);
}

function parseAuthHeaderFlags(rawAuthHeader: string) {
  const authLower = rawAuthHeader.toLowerCase();
  const authHeaderPresent = authLower.trim().length > 0;
  return {
    auth_header_present: authHeaderPresent,
    spf_fail: /spf=(fail|softfail)/i.test(authLower),
    spf_pass: /spf=pass/i.test(authLower),
    dkim_fail: /dkim=fail/i.test(authLower),
    dkim_pass: /dkim=pass/i.test(authLower),
    dmarc_fail: /dmarc=fail/i.test(authLower),
    dmarc_pass: /dmarc=pass/i.test(authLower)
  };
}

function checkUrlsForTyposquatting(urls: string[]): { found: boolean; reasons: string[] } {
  let found = false;
  const reasons: string[] = [];
  for (const urlStr of urls) {
    try {
      const parsedUrl = new URL(urlStr);
      const hostname = parsedUrl.hostname.toLowerCase().replace(/^www\./, '');
      const parts = hostname.split('.');
      const rootDomain = parts.length >= 2 ? parts.slice(-2).join('.') : hostname;
      for (const target of TARGET_DOMAINS) {
        if (hostname === target || rootDomain === target) continue;
        const minDist = Math.min(levenshteinDistance(rootDomain, target), levenshteinDistance(hostname, target));
        if (minDist >= 1 && minDist <= 2) {
          found = true;
          const r = `Typosquatting URL detected: "${hostname}" has Levenshtein distance ${minDist} from "${target}"`;
          if (!reasons.includes(r)) reasons.push(r);
          break;
        }
      }
    } catch {
      // ignore
    }
  }
  return { found, reasons };
}

function mergeMlInsights(ml: MLInferResponse, reasons: string[], triggeredRules: string[]) {
  for (const ind of ml.semantic_indicators) {
    if (!reasons.includes(ind)) reasons.push(`Neural Semantic Cue: ${ind}`);
  }
  for (const flag of ml.adversarial_flags) {
    if (!triggeredRules.includes(flag)) triggeredRules.push(flag);
    reasons.push(`Adversarial Shield Alert: ${flag}`);
  }
  if (ml.conflict_k >= 0.45) {
    triggeredRules.push('HIGH_EVIDENCE_CONFLICT');
    reasons.push(`High Dempster-Shafer Conflict (K=${ml.conflict_k}): valid auth conflicts with malicious content/IOCs`);
  }
}

export async function analyzeEmail(emlBuffer: Buffer, assignedId?: string): Promise<ThreatAnalysisResult> {
  const startTime = Date.now();
  const emailHash = crypto.createHash('sha256').update(emlBuffer).digest('hex');

  const cachedEmail = await cacheService.getEmailVerdict<ThreatAnalysisResult>(emailHash);
  if (cachedEmail) {
    const elapsed = Date.now() - startTime;
    return {
      ...cachedEmail,
      id: assignedId || cachedEmail.id,
      date: new Date().toISOString(),
      details: { ...cachedEmail.details, cached: true, processingTimeMs: Math.max(1, elapsed), emailHash }
    };
  }

  const parsed: ParsedMail = await simpleParser(emlBuffer);
  const reasons: string[] = [];
  const triggeredRules: string[] = [];

  const fromAddress = (parsed.from?.value?.[0]?.address || '').toLowerCase().trim();
  const fromName = parsed.from?.value?.[0]?.name || '';
  const fromDomain = fromAddress.includes('@') ? fromAddress.split('@')[1] : '';
  const replyToAddress = (parsed.replyTo?.value?.[0]?.address || '').toLowerCase().trim();
  const recipient = (parsed.to && 'text' in parsed.to ? parsed.to.text : '') || 'undisclosed-recipients';
  const subject = parsed.subject || '(No Subject)';
  const dateStr = parsed.date ? parsed.date.toISOString() : new Date().toISOString();

  let rawAuthHeader = '';
  if (parsed.headers) {
    const rawVal = parsed.headers.get('authentication-results');
    if (typeof rawVal === 'string') rawAuthHeader = rawVal;
    else if (Array.isArray(rawVal)) rawAuthHeader = rawVal.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join('; ');
    else if (rawVal && typeof rawVal === 'object') rawAuthHeader = JSON.stringify(rawVal);
  }
  if (parsed.headerLines) {
    for (const h of parsed.headerLines) {
      if (h.key && h.key.toLowerCase() === 'authentication-results') rawAuthHeader += ' ' + h.line;
    }
  }

  const authFlags = parseAuthHeaderFlags(rawAuthHeader);
  if (authFlags.spf_fail) {
    reasons.push('SPF authentication failed or softfailed (spf=fail/softfail)');
    triggeredRules.push('SPF_FAIL');
  }
  if (authFlags.dkim_fail) {
    reasons.push('DKIM cryptographic signature verification failed (dkim=fail)');
    triggeredRules.push('DKIM_FAIL');
  }
  if (authFlags.dmarc_fail) {
    reasons.push('DMARC policy validation failed (dmarc=fail)');
    triggeredRules.push('DMARC_FAIL');
  }

  const replyToMismatch = Boolean(replyToAddress && fromAddress && replyToAddress !== fromAddress);
  if (replyToMismatch) {
    reasons.push(`Reply-To mismatch: From <${fromAddress}> differs from Reply-To <${replyToAddress}>`);
    triggeredRules.push('REPLY_TO_MISMATCH');
  }

  const displayNameSpoof = EXECUTIVE_TITLE_REGEX.test(fromName) && FREE_MAIL_DOMAINS.has(fromDomain);
  if (displayNameSpoof) {
    reasons.push(`Executive/IT impersonation: "${fromName}" originated from free webmail (@${fromDomain})`);
    triggeredRules.push('DISPLAY_NAME_SPOOFING');
  }

  const extractedUrls = extractUrls(parsed.text, parsed.html);
  const typoCheck = checkUrlsForTyposquatting(extractedUrls);
  if (typoCheck.found) {
    triggeredRules.push('TYPOSQUATTING_URL');
    reasons.push(...typoCheck.reasons);
  }

  const fileHashes: string[] = [];
  const attachmentDetails: ThreatAnalysisResult['attachmentDetails'] = [];
  let dangerousAttachmentFound = false;

  if (parsed.attachments && parsed.attachments.length > 0) {
    for (const att of parsed.attachments) {
      const hash = crypto.createHash('sha256').update(att.content).digest('hex');
      fileHashes.push(hash);
      const filename = att.filename || 'unnamed_attachment';
      const ext = path.extname(filename).toLowerCase();
      const isDangerous = DANGEROUS_EXTENSIONS.has(ext);
      attachmentDetails.push({ filename, extension: ext, hash, dangerous: isDangerous, size: att.size || att.content.length, cached: false });
      if (isDangerous) {
        dangerousAttachmentFound = true;
        reasons.push(`Dangerous file attachment: "${filename}" (${ext}) [SHA-256: ${hash.slice(0, 16)}...]`);
        if (!triggeredRules.includes('DANGEROUS_ATTACHMENT')) triggeredRules.push('DANGEROUS_ATTACHMENT');
      }
    }
  }

  const symbolic: SymbolicSignalsPayload = {
    ...authFlags,
    reply_to_mismatch: replyToMismatch,
    display_name_spoof: displayNameSpoof,
    typosquatting_url: typoCheck.found,
    dangerous_attachment: dangerousAttachmentFound,
    url_count: extractedUrls.length
  };

  // Call Neuro-Symbolic ML & Dempster-Shafer Fusion Engine
  const ml = await callMlEngine({
    subject,
    plain_text: parsed.text || '',
    html_body: typeof parsed.html === 'string' ? parsed.html : '',
    sender: fromAddress || fromName,
    symbolic
  });

  mergeMlInsights(ml, reasons, triggeredRules);

  const id = assignedId || `inc_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const campaignId = await correlateCampaign({
    embedding: ml.embedding_384,
    subject,
    score: ml.fused_score,
    verdict: ml.verdict
  });

  const graph = buildProvenanceArtifacts({
    incidentId: id,
    subject,
    senderEmail: fromAddress,
    replyTo: replyToAddress,
    urls: extractedUrls,
    fileHashes,
    score: ml.fused_score,
    campaignId
  });
  await saveProvenanceGraph(graph);

  const duration = Date.now() - startTime;
  const summary = reasons.length > 0 ? reasons.join('; ') : 'No suspicious indicators found. Email appears clean.';

  const result: ThreatAnalysisResult = {
    id,
    sender: fromAddress || fromName || 'unknown-sender',
    fromName,
    recipient,
    subject,
    date: dateStr,
    score: ml.fused_score,
    belief_low: ml.belief_malicious,
    plausibility_high: ml.plausibility_malicious,
    epistemic_uncertainty: ml.epistemic_uncertainty,
    conflict_k: ml.conflict_k,
    verdict: ml.verdict,
    campaign_id: campaignId,
    embedding: ml.embedding_384,
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
      emailHash,
      belief_malicious: ml.belief_malicious,
      plausibility_malicious: ml.plausibility_malicious,
      epistemic_uncertainty: ml.epistemic_uncertainty,
      conflict_k: ml.conflict_k,
      neural_probability: ml.neural_probability,
      semantic_indicators: ml.semantic_indicators,
      adversarial_flags: ml.adversarial_flags,
      obfuscation_ratio: ml.obfuscation_ratio,
      zero_width_count: ml.zero_width_count,
      homoglyph_count: ml.homoglyph_count,
      prompt_injection_hits: ml.prompt_injection_hits,
      hidden_text_preview: ml.hidden_text_preview,
      deobfuscated_preview: ml.deobfuscated_preview,
      evidence_sources: ml.evidence_sources,
      ml_fallback: ml.fallback
    }
  };

  if (!ml.fallback) {
    await cacheService.setEmailVerdict(emailHash, result, 3600);
  }
  return result;
}

export interface DomAnalysisPayload {
  sender?: string;
  senderName?: string;
  senderEmail?: string;
  replyTo?: string;
  subject?: string;
  bodyText?: string;
  bodyHtml?: string;
  urls?: string[];
  attachments?: (string | { filename: string; size?: number })[];
  rawHeaders?: string;
}

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

  const domHash = crypto.createHash('sha256')
    .update(JSON.stringify({ fromAddress, fromName, replyToAddress, subject, urls, attachments, rawHeaders, bodyText: payload.bodyText || '' }))
    .digest('hex');

  const cachedDom = await cacheService.getEmailVerdict<ThreatAnalysisResult>(domHash);
  if (cachedDom) {
    const elapsed = Date.now() - startTime;
    return {
      ...cachedDom,
      id: assignedId || cachedDom.id,
      date: new Date().toISOString(),
      details: { ...cachedDom.details, cached: true, processingTimeMs: Math.max(1, elapsed), emailHash: domHash }
    };
  }

  const reasons: string[] = [];
  const triggeredRules: string[] = [];
  const authFlags = parseAuthHeaderFlags(rawHeaders);

  if (authFlags.spf_fail) { reasons.push('SPF authentication failed'); triggeredRules.push('SPF_FAIL'); }
  if (authFlags.dkim_fail) { reasons.push('DKIM signature verification failed'); triggeredRules.push('DKIM_FAIL'); }
  if (authFlags.dmarc_fail) { reasons.push('DMARC policy validation failed'); triggeredRules.push('DMARC_FAIL'); }

  const replyToMismatch = Boolean(replyToAddress && fromAddress && replyToAddress !== fromAddress);
  if (replyToMismatch) {
    reasons.push(`Reply-To mismatch: From <${fromAddress}> differs from Reply-To <${replyToAddress}>`);
    triggeredRules.push('REPLY_TO_MISMATCH');
  }

  const displayNameSpoof = EXECUTIVE_TITLE_REGEX.test(fromName) && FREE_MAIL_DOMAINS.has(fromDomain);
  if (displayNameSpoof) {
    reasons.push(`Executive/IT impersonation: "${fromName}" from free webmail (@${fromDomain})`);
    triggeredRules.push('DISPLAY_NAME_SPOOFING');
  }

  const typoCheck = checkUrlsForTyposquatting(urls);
  if (typoCheck.found) {
    triggeredRules.push('TYPOSQUATTING_URL');
    reasons.push(...typoCheck.reasons);
  }

  const attachmentDetails: ThreatAnalysisResult['attachmentDetails'] = [];
  let dangerousAttachmentFound = false;
  for (const item of attachments) {
    const filename = typeof item === 'string' ? item : item.filename || 'attachment';
    const ext = path.extname(filename).toLowerCase();
    const isDangerous = DANGEROUS_EXTENSIONS.has(ext);
    attachmentDetails.push({ filename, extension: ext, hash: 'scraped_from_dom', dangerous: isDangerous, size: typeof item === 'object' && item.size ? item.size : 0, cached: false });
    if (isDangerous) {
      dangerousAttachmentFound = true;
      reasons.push(`Dangerous file attachment: "${filename}" (${ext})`);
      if (!triggeredRules.includes('DANGEROUS_ATTACHMENT')) triggeredRules.push('DANGEROUS_ATTACHMENT');
    }
  }

  const ml = await callMlEngine({
    subject,
    plain_text: payload.bodyText || '',
    html_body: payload.bodyHtml || '',
    sender: fromAddress || fromName,
    symbolic: {
      ...authFlags,
      reply_to_mismatch: replyToMismatch,
      display_name_spoof: displayNameSpoof,
      typosquatting_url: typoCheck.found,
      dangerous_attachment: dangerousAttachmentFound,
      url_count: urls.length
    }
  });

  mergeMlInsights(ml, reasons, triggeredRules);

  const id = assignedId || `inc_dom_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const campaignId = await correlateCampaign({
    embedding: ml.embedding_384,
    subject,
    score: ml.fused_score,
    verdict: ml.verdict
  });

  const graph = buildProvenanceArtifacts({
    incidentId: id,
    subject,
    senderEmail: fromAddress,
    replyTo: replyToAddress,
    urls,
    fileHashes: [],
    score: ml.fused_score,
    campaignId
  });
  await saveProvenanceGraph(graph);

  const duration = Date.now() - startTime;
  const result: ThreatAnalysisResult = {
    id,
    sender: fromAddress || fromName || 'unknown-sender',
    fromName,
    recipient: 'Scraped Webmail Session',
    subject,
    date: new Date().toISOString(),
    score: ml.fused_score,
    belief_low: ml.belief_malicious,
    plausibility_high: ml.plausibility_malicious,
    epistemic_uncertainty: ml.epistemic_uncertainty,
    conflict_k: ml.conflict_k,
    verdict: ml.verdict,
    campaign_id: campaignId,
    embedding: ml.embedding_384,
    reasons,
    triggeredRules,
    urls,
    fileHashes: [],
    attachmentDetails,
    details: {
      reasons,
      triggeredRules,
      urls,
      fileHashes: [],
      summary: reasons.length > 0 ? reasons.join('; ') : 'No suspicious indicators found in scraped DOM.',
      rawAuthResults: rawHeaders || undefined,
      cached: false,
      processingTimeMs: Math.max(1, duration),
      emailHash: domHash,
      belief_malicious: ml.belief_malicious,
      plausibility_malicious: ml.plausibility_malicious,
      epistemic_uncertainty: ml.epistemic_uncertainty,
      conflict_k: ml.conflict_k,
      neural_probability: ml.neural_probability,
      semantic_indicators: ml.semantic_indicators,
      adversarial_flags: ml.adversarial_flags,
      evidence_sources: ml.evidence_sources,
      ml_fallback: ml.fallback
    }
  };

  if (!ml.fallback) {
    await cacheService.setEmailVerdict(domHash, result, 3600);
  }
  return result;
}
