// Shared Apollo enrichment core — used by both the CLI (src/scripts/enrich.js)
// and the Lambda API (api/index.js). Pure logic, no filesystem / CLI / AWS deps.
// Uses global fetch (Node >= 18).

const APOLLO_BASE = 'https://api.apollo.io/api/v1';
const MAX_CONTACTS_PER_COMPANY = 2;
const ORG_MATCH_MIN = 0.55;
const TRUST_RE = /\b(trust|board of trustees|fund)\b/i;

function normName(s) {
  return (s || '').toLowerCase()
    .replace(/[.,]/g, '')
    .replace(/\b(inc|incorporated|llc|l\.l\.c|corp|corporation|company|co|ltd|limited)\b/g, '')
    .replace(/\s+/g, ' ').trim();
}

function cleanQueryForApollo(name) {
  return (name || '')
    .replace(/,.*$/, '')
    .replace(/[.]/g, '')
    .replace(/\b(incorporated|corporation|company|limited)\b/gi, '')
    .replace(/\b(inc|llc|corp|co|ltd|lp|plc)\b/gi, '')
    .replace(/\s+(usa|us|north america|america)\s*$/gi, '')
    .replace(/\s+/g, ' ').trim();
}

function nameSim(a, b) {
  a = normName(a); b = normName(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.85;
  const ta = new Set(a.split(' ').filter(Boolean));
  const tb = new Set(b.split(' ').filter(Boolean));
  let inter = 0; ta.forEach(t => { if (tb.has(t)) inter++; });
  return inter / Math.max(ta.size, tb.size, 1);
}

const emailUnlocked = (e) => e && /@/.test(e) && !/email_not_unlocked/i.test(e);

const isTrust = (sponsorName) => TRUST_RE.test(sponsorName || '');

function buildContactRecord(emp, org, m, p) {
  return {
    ein: emp.ein,
    contact_name: [m.first_name, m.last_name].filter(Boolean).join(' ') || m.name || p.name || '',
    contact_title: m.title || p.title || '',
    contact_email: m.email,
    contact_linkedin: m.linkedin_url || p.linkedin_url || '',
    org_domain: org.domain || '',
    match_confidence: org.score,
    enriched_at: new Date().toISOString(),
  };
}

// Build an Apollo client bound to a single API key. Returns the three calls the
// enrichment flow needs. The X-Api-Key header is the only thing that varies per caller.
function createApolloClient(apiKey) {
  async function apolloPost(endpoint, body, attempt = 0) {
    const res = await fetch(`${APOLLO_BASE}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify(body),
    });
    if (res.status === 429 && attempt < 3) {
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
      return apolloPost(endpoint, body, attempt + 1);
    }
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`Apollo ${endpoint} ${res.status} ${t.slice(0, 200)}`);
    }
    return res.json();
  }

  async function resolveOrg(emp) {
    const q = cleanQueryForApollo(emp.sponsor_name);
    if (!q) return null;
    const r = await apolloPost('/organizations/search', { q_organization_name: q, page: 1, per_page: 5 });
    const orgs = r.organizations || r.accounts || [];
    if (!orgs.length) return null;
    let best = null, bestScore = 0;
    for (const o of orgs) {
      let s = nameSim(o.name, emp.sponsor_name);
      const oState = (o.state || o.state_name || '').toLowerCase();
      const oCity = (o.city || '').toLowerCase();
      if (emp.state && oState && oState === (emp.state || '').toLowerCase()) s += 0.05;
      if (emp.city && oCity && oCity === (emp.city || '').toLowerCase()) s += 0.05;
      if (s > bestScore) { bestScore = s; best = o; }
    }
    if (!best || bestScore < ORG_MATCH_MIN) return null;
    return {
      id: best.id,
      domain: best.primary_domain || best.website_url || null,
      name: best.name,
      score: Math.min(bestScore, 1),
    };
  }

  async function findPeople(orgId, titles) {
    const r = await apolloPost('/mixed_people/api_search', {
      organization_ids: [orgId],
      person_titles: titles,
      page: 1, per_page: 10,
    });
    const people = r.people || r.contacts || [];
    return people.slice(0, MAX_CONTACTS_PER_COMPANY);
  }

  async function matchPerson(person, orgDomain) {
    const body = { reveal_personal_emails: false };
    if (person.id) body.id = person.id;
    if (person.first_name) body.first_name = person.first_name;
    if (person.last_name) body.last_name = person.last_name;
    if (orgDomain) body.domain = orgDomain;
    if (person.organization?.name) body.organization_name = person.organization.name;
    try {
      const r = await apolloPost('/people/match', body);
      return r.person || r;
    } catch {
      return null;
    }
  }

  return { apolloPost, resolveOrg, findPeople, matchPerson };
}

// Enrich a single employer end-to-end. emp: { ein, sponsor_name, city, state, business_code }.
// Returns { contacts: [...], reason } where reason is one of:
// 'ok' | 'no_org_match' | 'no_people_match' | 'no_email_revealed' | 'trust_fund_skipped' | 'error'.
async function enrichOne({ emp, apiKey, titles }) {
  if (isTrust(emp.sponsor_name)) return { contacts: [], reason: 'trust_fund_skipped' };
  const client = createApolloClient(apiKey);
  try {
    const org = await client.resolveOrg(emp);
    if (!org) return { contacts: [], reason: 'no_org_match' };
    const people = await client.findPeople(org.id, titles);
    if (!people.length) return { contacts: [], reason: 'no_people_match' };
    const contacts = [];
    for (const p of people) {
      const m = await client.matchPerson(p, org.domain);
      if (!emailUnlocked(m?.email)) continue;
      contacts.push(buildContactRecord(emp, org, m, p));
    }
    return { contacts, reason: contacts.length ? 'ok' : 'no_email_revealed' };
  } catch (err) {
    return { contacts: [], reason: 'error', error: err.message };
  }
}

module.exports = {
  APOLLO_BASE,
  MAX_CONTACTS_PER_COMPANY,
  ORG_MATCH_MIN,
  normName,
  cleanQueryForApollo,
  nameSim,
  emailUnlocked,
  isTrust,
  buildContactRecord,
  createApolloClient,
  enrichOne,
};
