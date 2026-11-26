import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../src/server';
import { initSchema, saveIncident } from '../src/db';
import { analyzeEmail } from '../src/analyzer';
import { buildProvenanceArtifacts } from '../src/graph';

describe('PhishTank-NS Backend & Neuro-Symbolic Integration', () => {
  beforeAll(async () => {
    await initSchema();
  });

  it('GET /api/v1/health returns ok and database mode', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.database).toBeDefined();
  });

  it('POST /api/v1/analyze-dom scores executive BEC + typosquatting and builds provenance graph', async () => {
    const res = await request(app)
      .post('/api/v1/analyze-dom')
      .send({
        senderName: 'CEO Satya Nadella',
        senderEmail: 'ceo.office@gmail.com',
        subject: 'URGENT: Wire Transfer & Password Verification',
        bodyText: 'I am in a meeting, wire funds immediately and verify your password.',
        urls: ['https://micros0ft.com/login'],
        attachments: ['wire_order.vbs']
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.verdict).toBe('MALICIOUS');
    expect(res.body.score).toBeGreaterThanOrEqual(65);
    expect(res.body.belief_low).toBeLessThanOrEqual(res.body.plausibility_high);

    const graphRes = await request(app).get(`/api/v1/graph/${res.body.id}`);
    expect(graphRes.status).toBe(200);
    expect(graphRes.body.nodes.length).toBeGreaterThanOrEqual(3);
    expect(graphRes.body.edges.length).toBeGreaterThanOrEqual(2);
  });

  it('analyzes raw EML with SPF/DKIM failure and creates campaign cluster', async () => {
    const rawEml = Buffer.from(
      [
        'From: "IT Helpdesk" <support@gmail.com>',
        'Reply-To: <attacker@evil-domain.top>',
        'To: <victim@corp.com>',
        'Subject: Action Required: Reset Microsoft 365 Password',
        'Authentication-Results: spf=fail dkim=fail dmarc=fail',
        '',
        'Your mailbox is full. Verify your password immediately at https://micros0ft.com/auth'
      ].join('\r\n')
    );

    const result = await analyzeEmail(rawEml, 'inc_test_eml_001');
    expect(result.verdict).toBe('MALICIOUS');
    expect(result.triggeredRules).toContain('SPF_FAIL');
    expect(result.triggeredRules).toContain('TYPOSQUATTING_URL');

    await saveIncident({
      id: result.id,
      sender: result.sender,
      subject: result.subject,
      score: result.score,
      belief_low: result.belief_low,
      plausibility_high: result.plausibility_high,
      epistemic_uncertainty: result.epistemic_uncertainty,
      conflict_k: result.conflict_k,
      verdict: result.verdict,
      campaign_id: result.campaign_id,
      details: result.details
    });

    const incRes = await request(app).get('/api/v1/incidents/inc_test_eml_001');
    expect(incRes.status).toBe(200);
    expect(incRes.body.incident.verdict).toBe('MALICIOUS');
  });

  it('builds valid provenance graph artifacts', () => {
    const g = buildProvenanceArtifacts({
      incidentId: 'inc_1',
      subject: 'Test',
      senderEmail: 'a@example.com',
      replyTo: 'b@evil.com',
      urls: ['https://phish.xyz/login'],
      fileHashes: ['abcd1234'],
      score: 80,
      campaignId: 'camp_1'
    });
    expect(g.nodes.length).toBe(6);
    expect(g.edges.length).toBe(5);
  });
});
