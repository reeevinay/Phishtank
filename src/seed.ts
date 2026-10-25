import {
  saveIncident,
  getRecentIncidents,
  getIncidentById,
  parseIncidentDetails,
  closeDatabase,
  DB_PATH,
  IncidentRecord
} from './db';

const mockIncidents: IncidentRecord[] = [
  {
    id: 'inc_clean_001',
    sender: 'notifications@github.com',
    subject: 'Security alert: Dependabot resolved vulnerability in phishtank',
    score: 0,
    verdict: 'CLEAN',
    details: {
      triggeredRules: ['SPF_PASS', 'DKIM_PASS', 'DMARC_PASS', 'KNOWN_BENIGN_DOMAIN'],
      urls: ['https://github.com/security/advisories/GHSA-1234'],
      fileHashes: [],
      notes: 'Verified cryptographic signatures (DKIM & SPF). Legitimate benign security notification.'
    }
  },
  {
    id: 'inc_susp_002',
    sender: 'account-update@micros0ft-security-center.net',
    subject: 'URGENT: Re-authenticate your Microsoft 365 credentials within 24 hours',
    score: 65,
    verdict: 'SUSPICIOUS',
    details: {
      triggeredRules: [
        'TYPOSQUATTING_DOMAIN',
        'ARTIFICIAL_URGENCY',
        'SPF_SOFTFAIL',
        'SUSPICIOUS_REDIRECT'
      ],
      urls: [
        'https://micros0ft-security-center.net/login/verify?session=89324'
      ],
      fileHashes: [],
      notes: 'Lookalike domain imitating Microsoft 365. Potential credential harvesting.'
    }
  },
  {
    id: 'inc_mal_003',
    sender: 'payroll.director@exec-corporate-wire.top',
    subject: 'ACTION REQUIRED: Updated Bank Wire Instructions & Signed Q3 Agreement',
    score: 98,
    verdict: 'MALICIOUS',
    details: {
      triggeredRules: [
        'EXECUTIVE_IMPERSONATION',
        'KNOWN_MALWARE_ATTACHMENT',
        'NEWLY_REGISTERED_DOMAIN',
        'SPF_FAIL',
        'DKIM_FAIL',
        'MACRO_EMBEDDED_DOCUMENT'
      ],
      urls: [
        'http://185.220.101.45/payload/wire_instructions.docm',
        'http://c2.darknet-beacon.xyz/gate.php'
      ],
      fileHashes: [
        'b5d4045c3f466fa91fe2cc6abe79232a1a57cdf104f7a26e716e0a1e2789be78',
        '8f14e45fceea167a5a36dedd4bea2543'
      ],
      notes: 'High-severity spear-phishing / BEC attack with weaponized VBA dropper macro payload.'
    }
  }
];

function runSeed() {
  console.log('\n================================================================');
  console.log('       🛡️  PHISHTANK EMAIL THREAT ANALYSIS - DB SEEDER  🛡️      ');
  console.log('================================================================');
  console.log(`Database Location: ${DB_PATH}\n`);

  console.log('⏳ Inserting mock incident records...');
  for (const mock of mockIncidents) {
    saveIncident(mock);
    console.log(`  ✓ Saved incident: [${mock.verdict}] ${mock.id} - "${mock.subject}"`);
  }

  console.log('\n🔍 Verifying with getRecentIncidents(10):');
  const recent = getRecentIncidents(10);
  console.log(`Found ${recent.length} total incidents in database:\n`);

  recent.forEach((item, index) => {
    const details = parseIncidentDetails(item.details);
    const badge =
      item.verdict === 'MALICIOUS'
        ? '🔴 MALICIOUS '
        : item.verdict === 'SUSPICIOUS'
        ? '🟡 SUSPICIOUS'
        : '🟢 CLEAN     ';

    console.log(`[${index + 1}] ${badge} | Score: ${item.score.toString().padStart(2, ' ')}/100 | ID: ${item.id}`);
    console.log(`    Sender:     ${item.sender}`);
    console.log(`    Subject:    ${item.subject}`);
    console.log(`    Created At: ${item.created_at}`);
    console.log(`    Rules:      ${(details.triggeredRules || []).join(', ') || 'None'}`);
    console.log(`    URLs:       ${(details.urls || []).join(', ') || 'None'}`);
    console.log(`    Hashes:     ${(details.fileHashes || []).join(', ') || 'None'}`);
    console.log('    ------------------------------------------------------------');
  });

  console.log('\n🔍 Testing getIncidentById("inc_mal_003"):');
  const single = getIncidentById('inc_mal_003');
  if (single) {
    console.log('✓ Successfully retrieved malicious incident by ID:');
    console.log(JSON.stringify({ ...single, details: parseIncidentDetails(single.details) }, null, 2));
  } else {
    console.error('❌ Failed to retrieve incident by ID');
  }

  closeDatabase();
  console.log('\n🎉 Persistence layer verified successfully and database connection closed.\n');
}

runSeed();
