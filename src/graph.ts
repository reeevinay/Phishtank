import crypto from 'crypto';

export type NodeType = 'email' | 'sender_domain' | 'reply_to' | 'url_domain' | 'attachment_hash' | 'campaign';

export interface ThreatNode {
  id: string;
  node_type: NodeType;
  label: string;
  risk_score: number;
  metadata?: Record<string, unknown>;
}

export interface ThreatEdge {
  source_id: string;
  target_id: string;
  relation: string;
  weight?: number;
}

export interface ProvenanceSubgraph {
  nodes: ThreatNode[];
  edges: ThreatEdge[];
}

export function makeNodeId(type: NodeType, value: string): string {
  const hash = crypto.createHash('sha1').update(`${type}:${value.toLowerCase()}`).digest('hex').slice(0, 12);
  return `${type}_${hash}`;
}

/**
 * Extracts heterogeneous Threat Provenance Graph nodes & edges from an analyzed email.
 */
export function buildProvenanceArtifacts(params: {
  incidentId: string;
  subject: string;
  senderEmail: string;
  replyTo?: string;
  urls: string[];
  fileHashes: string[];
  score: number;
  campaignId?: string;
}): ProvenanceSubgraph {
  const nodes: ThreatNode[] = [];
  const edges: ThreatEdge[] = [];

  const emailNodeId = params.incidentId;
  nodes.push({
    id: emailNodeId,
    node_type: 'email',
    label: params.subject.slice(0, 48) || params.incidentId,
    risk_score: params.score
  });

  if (params.senderEmail && params.senderEmail.includes('@')) {
    const domain = params.senderEmail.split('@')[1].toLowerCase();
    const domId = makeNodeId('sender_domain', domain);
    nodes.push({ id: domId, node_type: 'sender_domain', label: domain, risk_score: params.score });
    edges.push({ source_id: emailNodeId, target_id: domId, relation: 'SENT_FROM_DOMAIN', weight: 1.0 });
  }

  if (params.replyTo && params.replyTo !== params.senderEmail) {
    const rtId = makeNodeId('reply_to', params.replyTo);
    nodes.push({ id: rtId, node_type: 'reply_to', label: params.replyTo, risk_score: Math.max(params.score, 60) });
    edges.push({ source_id: emailNodeId, target_id: rtId, relation: 'REPLIES_TO', weight: 1.2 });
  }

  const seenDomains = new Set<string>();
  for (const u of params.urls.slice(0, 10)) {
    try {
      const host = new URL(u).hostname.toLowerCase();
      if (!seenDomains.has(host)) {
        seenDomains.add(host);
        const uId = makeNodeId('url_domain', host);
        nodes.push({ id: uId, node_type: 'url_domain', label: host, risk_score: params.score });
        edges.push({ source_id: emailNodeId, target_id: uId, relation: 'LINKS_TO_DOMAIN', weight: 1.0 });
      }
    } catch {
      // ignore invalid URLs
    }
  }

  for (const h of params.fileHashes.slice(0, 5)) {
    const hId = makeNodeId('attachment_hash', h);
    nodes.push({ id: hId, node_type: 'attachment_hash', label: `sha256:${h.slice(0, 12)}`, risk_score: params.score });
    edges.push({ source_id: emailNodeId, target_id: hId, relation: 'CONTAINS_ATTACHMENT', weight: 1.5 });
  }

  if (params.campaignId) {
    const cId = params.campaignId;
    nodes.push({ id: cId, node_type: 'campaign', label: `Campaign ${cId.slice(0, 10)}`, risk_score: params.score });
    edges.push({ source_id: emailNodeId, target_id: cId, relation: 'BELONGS_TO_CAMPAIGN', weight: 2.0 });
  }

  return { nodes, edges };
}
