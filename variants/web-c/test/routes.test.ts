import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../src/api/client.js';
import type { FetchLike } from '../src/api/client.js';
import type { ActionResponse, Analyst, AuditEvent, CaseDetail, CaseStats, KycCase, RiskExplanation } from '../src/api/types.js';
import { createApp } from '../src/app.js';
import fixture from './fixtures-audit.json' with { type: 'json' };

const analysts: Analyst[] = [
  { id: 'ana-001', name: 'Marta Ellison', role: 'senior_analyst' },
  { id: 'ana-003', name: 'Grete Lindholm', role: 'analyst' },
  { id: 'ana-006', name: 'Sofia Chen', role: 'compliance_manager' },
];

const tokens: Record<string, string> = {
  'ana-001': Buffer.alloc(32, 1).toString('base64url'),
  'ana-003': Buffer.alloc(32, 3).toString('base64url'),
  'ana-006': Buffer.alloc(32, 6).toString('base64url'),
};
const managerToken = tokens['ana-006']!;
const unknownToken = Buffer.alloc(32, 9).toString('base64url');

function authCookie(token = managerToken) {
  return `kyc_access_token=${token}`;
}

function authenticated(app: ReturnType<typeof createApp>) {
  return request.agent(app).set('Cookie', authCookie()).set('Host', 'web.test').set('Origin', 'https://web.test');
}

beforeEach(() => {
  vi.stubEnv('ALLOW_INSECURE_LOCAL_AUTH', 'false');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const audit = fixture as AuditEvent[];

const kase: KycCase = {
  id: 'case-006',
  reference: 'KYC-2026-0006',
  customerId: 'cus-006',
  status: 'in_review',
  riskLevel: 'high',
  riskScore: 65,
  assignedTo: 'ana-003',
  createdAt: '2026-09-04T14:17:25.258Z',
  updatedAt: '2026-09-13T14:17:25.258Z',
  customer: { id: 'cus-006', fullName: 'Priya Holloway', countryOfResidence: 'MM', nationality: 'MM' },
};

const detail: CaseDetail = {
  ...kase,
  customer: {
    id: 'cus-006',
    fullName: 'Priya Holloway',
    dateOfBirth: '1984-02-11',
    nationality: 'MM',
    countryOfResidence: 'MM',
    occupation: 'jeweller',
    email: 'priya@example.test',
    accountOpenedAt: '2026-08-20T00:00:00.000Z',
    expectedMonthlyVolumeUsd: 72000,
    sourceOfFunds: 'crypto',
    idDocumentType: 'passport',
    idDocumentVerified: true,
    addressVerified: false,
    pepFlag: false,
    sanctionsHit: false,
    adverseMediaHits: 1,
  },
  signals: [
    {
      id: 'sig-1',
      caseId: 'case-006',
      code: 'HIGH_RISK_JURISDICTION',
      title: 'High-risk jurisdiction',
      description: 'Residence in a high-risk jurisdiction.',
      severity: 'high',
      weight: 25,
    },
  ],
  audit,
  allowedActions: ['approve', 'reject', 'escalate'],
  approvalNoteRequired: true,
};

const explanation: RiskExplanation = {
  caseId: 'case-006',
  riskScore: 65,
  riskLevel: 'high',
  summary: 'Score 65 is above the high threshold (60).',
  thresholds: { medium: 30, high: 60 },
  factors: [
    { code: 'A', title: 'Small factor', description: 'd', severity: 'low', weight: 5, contributionPct: 8 },
    { code: 'B', title: 'Big factor', description: 'd', severity: 'high', weight: 60, contributionPct: 92 },
  ],
};

const stats: CaseStats = {
  byStatus: { pending: 1, in_review: 2, approved: 3, rejected: 4, escalated: 5 },
  byRiskLevel: { low: 1, medium: 2, high: 3 },
  total: 15,
};

interface Call {
  url: string;
  init: RequestInit | undefined;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

interface StubOptions {
  action?: (call: Call) => Response;
  caseDetail?: Partial<CaseDetail>;
  unreachable?: boolean;
  rejectedTokens?: string[];
  response?: (call: Call) => Response | undefined;
}

function buildApp(opts: StubOptions = {}) {
  const calls: Call[] = [];
  const fetchStub: FetchLike = async (url, init) => {
    calls.push({ url, init });
    if (opts.unreachable) throw new TypeError('fetch failed');
    const response = opts.response?.({ url, init });
    if (response) return response;
    const authorization = new Headers(init?.headers).get('authorization');
    const analyst = analysts.find((entry) => authorization === `Bearer ${tokens[entry.id]}`);
    if (!analyst || opts.rejectedTokens?.includes(tokens[analyst.id]!)) {
      return json({ error: { code: 'UNAUTHORIZED', message: 'Invalid credential.' } }, 401);
    }
    const { pathname } = new URL(url);
    if (pathname === '/api/me') return json({ ...analyst, permissions: ['cases:read'] });
    if (pathname === '/api/analysts') return json(analysts);
    if (pathname === '/api/cases/stats') return json(stats);
    if (pathname === '/api/cases') return json({ items: [kase], total: 1, page: 1, pageSize: 25 });
    if (pathname === '/api/cases/case-006') return json({ ...detail, ...opts.caseDetail });
    if (pathname === '/api/cases/case-006/risk-explanation') return json(explanation);
    if (pathname === '/api/cases/case-006/actions' && init?.method === 'POST') {
      return opts.action ? opts.action({ url, init }) : json({
        ...kase, status: 'approved', audit, allowedActions: [], approvalNoteRequired: true,
      } satisfies ActionResponse);
    }
    return json({ error: { code: 'NOT_FOUND', message: 'Case not found' } }, 404);
  };
  const app = createApp({ api: createApiClient('http://api.test', fetchStub) });
  return { app, calls };
}

describe('GET /', () => {
  it.each(['ana-001', 'ana-003'])('forwards the credential for %s on every API read', async (analystId) => {
    const { app, calls } = buildApp();
    for (const path of ['/', '/cases/case-006', '/cases/case-006/actions/reject']) {
      await authenticated(app).get(path).set('Cookie', authCookie(tokens[analystId]!)).expect(200);
    }
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((call) => new Headers(call.init?.headers).get('authorization') === `Bearer ${tokens[analystId]}`)).toBe(true);
    expect(calls.every((call) => !new Headers(call.init?.headers).has('x-analyst-id'))).toBe(true);
    expect(calls.some((call) => call.url.endsWith('/api/me'))).toBe(true);
    expect(calls.some((call) => call.url.endsWith('/api/analysts'))).toBe(true);
    expect(calls.some((call) => call.url.endsWith('/api/cases/stats'))).toBe(true);
    expect(calls.some((call) => call.url.endsWith('/risk-explanation'))).toBe(true);
  });

  it('requires a credential instead of defaulting or trusting old analyst cookies', async () => {
    const { app, calls } = buildApp();
    await request(app).get('/').expect(401);
    for (const analystId of ['ana-003', 'ana-006', 'deleted']) {
      const res = await request(app).get('/cases/case-006').set('Cookie', `analyst_id=${analystId}`).expect(401);
      expect(res.text).toContain('<h1>Sign in</h1>');
      expect(res.text).not.toContain('Priya Holloway');
      expect(res.get('Set-Cookie')).toEqual(expect.arrayContaining([expect.stringContaining('analyst_id=;')]));
    }
    expect(calls).toHaveLength(0);
  });

  it('renders queue rows, stats and filter state from the API', async () => {
    const { app, calls } = buildApp();
    const res = await authenticated(app).get('/?riskLevel=high&status=in_review&q=priya');
    expect(res.status).toBe(200);
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
    expect(res.text).toContain('<!doctype html>');
    expect(res.text).toContain('KYC-2026-0006');
    expect(res.text).toContain('Priya Holloway');
    expect(res.text).toContain('badge-risk-high');
    expect(res.text).toContain('Showing 1–1 of 1 cases');
    expect(res.text).toContain('<input type="checkbox" name="riskLevel" checked="" value="high"/>');
    expect(res.text).toMatch(/name="q"[^>]*value="priya"/);
    const listCall = calls.find((c) => c.url.includes('/api/cases?'));
    expect(listCall?.url).toContain('status=in_review&riskLevel=high&q=priya');
    expect(listCall?.url).toContain('pageSize=25');
  });

  it('returns only the table fragment plus a canonical push URL for htmx requests', async () => {
    const { app, calls } = buildApp();
    const res = await authenticated(app).get('/?q=&status=pending&sort=createdAt&order=desc').set('HX-Request', 'true');
    expect(res.status).toBe(200);
    expect(res.headers['hx-push-url']).toBe('/?status=pending');
    expect(res.text.startsWith('<section id="queue-results"')).toBe(true);
    expect(res.text).not.toContain('<html');
    expect(calls.some((c) => c.url.endsWith('/api/cases/stats'))).toBe(false);
  });

  it('shows a friendly error page when the API is unreachable', async () => {
    const { app } = buildApp({ unreachable: true });
    const res = await authenticated(app).get('/');
    expect(res.status).toBe(502);
    expect(res.text).toContain('The KYC API is unreachable');
  });
});

describe('GET /cases/:id', () => {
  it('renders the case, formatted customer fields, sorted factors and a verified chain', async () => {
    const { app } = buildApp();
    const res = await authenticated(app).get('/cases/case-006');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Why is this case high risk?');
    expect(res.text).toContain('$72,000');
    expect(res.text).toContain('✓ Yes');
    expect(res.text).toContain('✕ No');
    expect(res.text.indexOf('Big factor')).toBeLessThan(res.text.indexOf('Small factor'));
    expect(res.text).toContain('Chain verified (2 events)');
    expect(res.text).toContain(`title="${audit[1]!.hash}"`);
    expect(res.text).toContain(audit[1]!.hash.slice(0, 12));
    for (const action of ['Approve', 'Reject', 'Escalate']) expect(res.text).toContain(`>${action}</a>`);
    expect(res.text).not.toContain('Start review');
  });

  it('returns a 404 page for an unknown case', async () => {
    const { app } = buildApp();
    const res = await authenticated(app).get('/cases/nope');
    expect(res.status).toBe(404);
    expect(res.text).toContain('Case not found');
  });

  it.each(['pending', 'in_review', 'escalated'] as const)('shows a role restriction for an open %s case without actions', async (status) => {
    const { app } = buildApp({ caseDetail: { status, allowedActions: [] } });
    const res = await authenticated(app).get('/cases/case-006').expect(200);
    expect(res.text).toContain('The selected role does not have permission to act on this case.');
    expect(res.text).not.toContain('Case closed.');
    expect(res.text).not.toContain('btn-action-');
  });

  it.each(['approved', 'rejected'] as const)('shows closure for a terminal %s case', async (status) => {
    const { app } = buildApp({ caseDetail: { status, allowedActions: [] } });
    const res = await authenticated(app).get('/cases/case-006').expect(200);
    expect(res.text).toContain('<strong>Case closed.</strong>');
    expect(res.text).toContain(`This case is ${status}; no further actions are available.`);
    expect(res.text).not.toContain('does not have permission');
    expect(res.text).not.toContain('btn-action-');
  });

  it.each(['low', 'medium', 'high'] as const)('describes both decision roles for escalated %s-risk cases', async (riskLevel) => {
    const { app } = buildApp({ caseDetail: { status: 'escalated', riskLevel, allowedActions: ['approve', 'reject'] } });
    const res = await authenticated(app).get('/cases/case-006').expect(200);
    expect(res.text).toContain('Senior analysts can resolve low- and medium-risk cases; compliance managers can resolve cases at all risk levels.');
    expect(res.text).not.toContain('can only be resolved by a senior analyst');
    expect(res.text).toContain('>Approve</a>');
    expect(res.text).toContain('>Reject</a>');
  });

  it('serves the action dialog as a fragment for htmx and inline for full page loads', async () => {
    const { app } = buildApp();
    const frag = await authenticated(app).get('/cases/case-006/actions/reject').set('HX-Request', 'true');
    expect(frag.text.startsWith('<dialog id="action-dialog"')).toBe(true);
    expect(frag.text).toContain('hx-post="/cases/case-006/actions/reject"');
    const full = await authenticated(app).get('/cases/case-006/actions/reject');
    expect(full.text).toContain('<html');
    expect(full.text).toContain('<dialog id="action-dialog"');
  });
});

describe('POST /cases/:id/actions/:action', () => {
  it('never authorizes a case mutation using a legacy identity cookie', async () => {
    const { app, calls } = buildApp();
    await authenticated(app).post('/cases/case-006/actions/escalate')
      .set('Cookie', 'analyst_id=deleted').type('form')
      .send({ note: 'Escalation requires further review.' }).expect(401);
    expect(calls).toHaveLength(0);
  });

  it('forwards the note and bearer credential, then renders the refreshed case and toast', async () => {
    const { app, calls } = buildApp();
    const res = await authenticated(app)
      .post('/cases/case-006/actions/approve')
      .set('HX-Request', 'true')
      .type('form')
      .send({ note: 'Documents verified in person.' });
    expect(res.status).toBe(200);
    const post = calls.find((c) => c.init?.method === 'POST');
    expect(post).toBeDefined();
    expect(post!.url).toBe('http://api.test/api/cases/case-006/actions');
    const headers = post!.init!.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${managerToken}`);
    expect(headers['x-analyst-id']).toBeUndefined();
    expect(JSON.parse(post!.init!.body as string)).toEqual({ action: 'approve', note: 'Documents verified in person.' });
    expect(res.text).toContain('id="case-main"');
    expect(res.text).toContain('Case approved.');
    expect(res.text).toContain('id="dialog-slot" hx-swap-oob="true"');
  });

  it('redirects back to the case for non-htmx form posts', async () => {
    const { app } = buildApp();
    const res = await authenticated(app).post('/cases/case-006/actions/approve').type('form').send({ note: 'Reviewed documents.' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/cases/case-006?done=approve');
  });

  it('rejects an invalid note client-side without calling the API', async () => {
    const { app, calls } = buildApp();
    const res = await authenticated(app)
      .post('/cases/case-006/actions/reject')
      .set('HX-Request', 'true')
      .type('form')
      .send({ note: 'short' });
    expect(res.status).toBe(200);
    expect(res.headers['hx-retarget']).toBe('#dialog-slot');
    expect(res.text).toContain('Note must be at least 10 characters.');
    expect(res.text).toContain('>short</textarea>');
    expect(calls.some((c) => c.init?.method === 'POST')).toBe(false);
  });

  it.each([
    { status: 400, code: 'VALIDATION_ERROR', message: 'A note of 10..1000 characters is required to approve a case.' },
    { status: 403, code: 'FORBIDDEN', message: "Your role does not permit 'approve' on a 'high' risk case." },
    { status: 409, code: 'INVALID_TRANSITION', message: "Cannot perform 'approve' on a case with status 'approved'." },
  ])('renders authoritative API $status errors after preliminary validation passes', async ({ status, code, message }) => {
    const { app, calls } = buildApp({
      action: () => json({ error: { code, message } }, status),
    });
    const res = await authenticated(app)
      .post('/cases/case-006/actions/approve')
      .set('HX-Request', 'true')
      .type('form')
      .send({ note: 'Looks fine after review.' });
    expect(res.status).toBe(200);
    expect(res.headers['hx-retarget']).toBe('#dialog-slot');
    expect(res.headers['hx-reswap']).toBe('innerHTML');
    expect(res.text).toContain('role="alert"');
    expect(res.text).toContain(message.replaceAll("'", '&#x27;'));
    expect(res.text).toContain('>Looks fine after review.</textarea>');
    expect(res.text).not.toContain('Case approved.');

    const full = await authenticated(app).post('/cases/case-006/actions/approve').type('form').send({ note: 'Looks fine after review.' });
    expect(full.status).toBe(status);
    expect(full.text).toContain('<html');
    expect(full.text).toContain(message.replaceAll("'", '&#x27;'));
    expect(full.text).toContain('>Looks fine after review.</textarea>');
    expect(calls.filter((call) => call.init?.method === 'POST')).toHaveLength(2);
  });
});

const noteScenarios = [
  { action: 'approve', riskLevel: 'low', approvalNoteRequired: true, required: true },
  { action: 'approve', riskLevel: 'medium', approvalNoteRequired: true, required: true },
  { action: 'approve', riskLevel: 'high', approvalNoteRequired: true, required: true },
  { action: 'approve', riskLevel: 'high', approvalNoteRequired: false, required: true },
  { action: 'approve', riskLevel: 'low', approvalNoteRequired: false, required: false },
  { action: 'approve', riskLevel: 'medium', approvalNoteRequired: false, required: false },
  { action: 'reject', riskLevel: 'low', approvalNoteRequired: false, required: true },
  { action: 'escalate', riskLevel: 'high', approvalNoteRequired: false, required: true },
  { action: 'start_review', riskLevel: 'high', approvalNoteRequired: true, required: false },
  { action: 'start_review', riskLevel: 'low', approvalNoteRequired: false, required: false },
] as const;

describe.each([true, false])('policy-aware action forms (htmx: %s)', (isHx) => {
  it.each(noteScenarios)('GET renders $action/$riskLevel/$approvalNoteRequired note attributes and hints', async ({
    action, riskLevel, approvalNoteRequired, required,
  }) => {
    const { app, calls } = buildApp({ caseDetail: { riskLevel, approvalNoteRequired } });
    const res = await authenticated(app).get(`/cases/case-006/actions/${action}`)
      .set('HX-Request', String(isHx)).expect(200);
    const textarea = res.text.match(/<textarea\b[^>]*>/)?.[0] ?? '';
    expect(textarea).toMatch(/\bmaxlength="1000"/i);
    expect(textarea).toContain('aria-describedby="note-hint"');
    expect(textarea.includes('required=""')).toBe(required);
    expect(/\bminlength="10"/i.test(textarea)).toBe(required);
    expect(res.text).toContain(required ? '(required)' : '(optional)');
    expect(res.text).toContain(required
      ? '10–1000 characters (excluding surrounding whitespace)'
      : 'Optional note (max 1000 characters).');
    if (!required) expect(textarea).not.toMatch(/\bminlength=/i);
    if (action === 'approve' && riskLevel === 'high') expect(res.text).toContain('Approving a high-risk case requires');
    expect(res.text.includes('<html')).toBe(!isHx);
    expect(calls.every((call) => new Headers(call.init?.headers).get('authorization') === `Bearer ${managerToken}`)).toBe(true);
  });

  it.each(noteScenarios.filter((scenario) => scenario.required))(
    'POST rejects invalid required notes for $action/$riskLevel/$approvalNoteRequired before mutation',
    async ({ action, riskLevel, approvalNoteRequired }) => {
      const { app, calls } = buildApp({ caseDetail: { riskLevel, approvalNoteRequired } });
      for (const note of [undefined, ' \t\n ', ' 123456789 ', 'x'.repeat(1001)]) {
        const res = await authenticated(app).post(`/cases/case-006/actions/${action}`)
          .set('HX-Request', String(isHx)).type('form')
          .send({ note, approvalNoteRequired: 'false' }).expect(isHx ? 200 : 400);
        expect(res.text).toContain('role="alert"');
        expect(res.text).toContain(note?.length === 1001
          ? 'Note must be at most 1000 characters.'
          : 'Note must be at least 10 characters.');
        expect(res.text).toContain('(required)');
        expect(res.text).toMatch(/<textarea\b[^>]*minlength="10"/i);
        if (note !== undefined) expect(res.text).toContain(`${note}</textarea>`);
        expect(res.text.includes('<html')).toBe(!isHx);
        if (isHx) expect(res.headers['hx-retarget']).toBe('#dialog-slot');
      }
      expect(calls.some((call) => call.init?.method === 'POST')).toBe(false);
    },
  );

  it.each(noteScenarios.filter((scenario) => scenario.required))(
    'POST forwards trimmed boundary notes for $action/$riskLevel/$approvalNoteRequired',
    async ({ action, riskLevel, approvalNoteRequired }) => {
      const { app, calls } = buildApp({ caseDetail: { riskLevel, approvalNoteRequired } });
      for (const note of ['1234567890', 'x'.repeat(1000)]) {
        const res = await authenticated(app).post(`/cases/case-006/actions/${action}`)
          .set('HX-Request', String(isHx)).type('form')
          .send({ note: ` \t${note}\n ` }).expect(isHx ? 200 : 303);
        if (isHx) {
          expect(res.text).toContain('id="case-main"');
          expect(res.text).toContain('id="dialog-slot" hx-swap-oob="true"');
        } else {
          expect(res.headers.location).toBe(`/cases/case-006?done=${action}`);
        }
      }
      const posts = calls.filter((call) => call.init?.method === 'POST');
      expect(posts).toHaveLength(2);
      expect(posts.map((post) => JSON.parse(post.init!.body as string))).toEqual([
        { action, note: '1234567890' },
        { action, note: 'x'.repeat(1000) },
      ]);
      expect(calls.every((call) => new Headers(call.init?.headers).get('authorization') === `Bearer ${managerToken}`)).toBe(true);
    },
  );

  it.each(noteScenarios.filter((scenario) => !scenario.required))(
    'POST permits empty and short optional notes for $action/$riskLevel/$approvalNoteRequired',
    async ({ action, riskLevel, approvalNoteRequired }) => {
      const { app, calls } = buildApp({ caseDetail: { riskLevel, approvalNoteRequired } });
      for (const note of [undefined, ' \t\n ', ' ok ']) {
        await authenticated(app).post(`/cases/case-006/actions/${action}`)
          .set('HX-Request', String(isHx)).type('form').send({ note }).expect(isHx ? 200 : 303);
      }
      const posts = calls.filter((call) => call.init?.method === 'POST');
      expect(posts.map((post) => JSON.parse(post.init!.body as string))).toEqual([
        { action }, { action }, { action, note: 'ok' },
      ]);
    },
  );

  it('reloads the server note policy on POST instead of trusting the earlier dialog or submitted flag', async () => {
    const caseDetail: Partial<CaseDetail> = { riskLevel: 'medium', approvalNoteRequired: false };
    const { app, calls } = buildApp({ caseDetail });
    const dialog = await authenticated(app).get('/cases/case-006/actions/approve')
      .set('HX-Request', String(isHx)).expect(200);
    expect(dialog.text).toContain('(optional)');
    caseDetail.approvalNoteRequired = true;
    const res = await authenticated(app).post('/cases/case-006/actions/approve')
      .set('HX-Request', String(isHx)).type('form')
      .send({ note: '', approvalNoteRequired: 'false' }).expect(isHx ? 200 : 400);
    expect(res.text).toContain('Note must be at least 10 characters.');
    expect(res.text).toContain('(required)');
    expect(calls.some((call) => call.init?.method === 'POST')).toBe(false);
  });

  it('displays an API policy rejection even when the last case read allowed an empty approval note', async () => {
    const message = 'A note of 10..1000 characters is required to approve a case.';
    const { app, calls } = buildApp({
      caseDetail: { riskLevel: 'medium', approvalNoteRequired: false },
      action: () => json({ error: { code: 'VALIDATION_ERROR', message } }, 400),
    });
    const res = await authenticated(app).post('/cases/case-006/actions/approve')
      .set('HX-Request', String(isHx)).set('Cookie', authCookie(tokens['ana-001']!)).type('form')
      .send({ note: '' }).expect(isHx ? 200 : 400);
    expect(res.text).toContain('role="alert"');
    expect(res.text).toContain(message);
    expect(res.text).not.toContain('Case approved.');
    if (isHx) expect(res.headers['hx-retarget']).toBe('#dialog-slot');
    const posts = calls.filter((call) => call.init?.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(JSON.parse(posts[0]!.init!.body as string)).toEqual({ action: 'approve' });
    expect(calls.every((call) => new Headers(call.init?.headers).get('authorization') === `Bearer ${tokens['ana-001']}`)).toBe(true);
  });
});

describe('Access token sign-in', () => {
  it('offers a public password form without fetching a directory or embedding credentials', async () => {
    const { app, calls } = buildApp();
    const res = await request(app).get('/sign-in').set('Cookie', authCookie()).expect(200);
    expect(calls).toHaveLength(0);
    expect(res.text).toMatch(/<form[^>]*action="\/sign-in"[^>]*method="post"/);
    const input = res.text.match(/<input[^>]*name="accessToken"[^>]*>/)?.[0];
    expect(input).toContain('type="password"');
    expect(input).toContain('required=""');
    expect(input).toContain('minLength="43"');
    expect(input).toContain('maxLength="43"');
    expect(input).not.toContain('value=');
    expect(res.text).toContain('autoComplete="off"');
    expect(res.text).not.toContain(managerToken);
    expect(res.text).not.toContain('name="analystId"');
    expect(res.text).not.toContain('Signed in as');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-security-policy']).toContain("form-action 'self'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('same-origin');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it.each(['ana-001', 'ana-003', 'ana-006'])('verifies %s with /api/me before storing a secure credential', async (analystId) => {
    const { app, calls } = buildApp();
    const token = tokens[analystId]!;
    const res = await request(app).post('/sign-in').set('Host', 'web.test').set('Origin', 'https://web.test')
      .type('form').send({ accessToken: token, analystId: 'ana-006', returnTo: '//evil.test' }).expect(303);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('http://api.test/api/me');
    expect(new Headers(calls[0]?.init?.headers).get('authorization')).toBe(`Bearer ${token}`);
    expect(new Headers(calls[0]?.init?.headers).has('x-analyst-id')).toBe(false);
    expect(calls[0]?.init?.body).toBeUndefined();
    expect(res.headers.location).toBe('/');
    expect(res.text).not.toContain(token);
    const cookies: string[] = res.get('Set-Cookie') ?? [];
    const cookie = cookies.find((value) => value.startsWith(authCookie(token)));
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Max-Age=28800');
    expect(cookie).not.toContain('Domain=');
    expect(cookies).toContainEqual(expect.stringContaining('analyst_id=;'));
  });

  it('derives display identity from /api/me and ignores spoofed browser identities', async () => {
    const token = tokens['ana-003']!;
    const { app, calls } = buildApp({
      response: ({ url }) => url.endsWith('/api/me')
        ? json({ id: 'ana-003', name: 'Verified Grete', role: 'analyst', permissions: ['cases:read'] })
        : undefined,
    });
    const res = await authenticated(app).get('/?analystId=ana-006')
      .set('Cookie', `${authCookie(token)}; analyst_id=ana-006`).set('x-analyst-id', 'ana-006').expect(200);
    expect(res.text).toContain('Signed in as Verified Grete (Analyst)');
    expect(res.text).toMatch(/<form[^>]*action="\/sign-out"[^>]*method="post"/);
    expect(res.text).not.toContain('action="/switch-analyst"');
    expect(res.text).not.toContain(token);
    expect(res.text).toContain('hx-history="false"');
    expect(res.text).toContain('&quot;historyCacheSize&quot;:0');
    expect(res.text).toContain('&quot;refreshOnHistoryMiss&quot;:true');
    expect(calls.every((call) => new Headers(call.init?.headers).get('authorization') === `Bearer ${token}`)).toBe(true);
    expect(calls.every((call) => !new Headers(call.init?.headers).has('x-analyst-id'))).toBe(true);
  });

  it.each(['', 'ana-006', 'a'.repeat(42), 'a'.repeat(44), '!'.repeat(43)])('rejects malformed token %s without contacting the API', async (accessToken) => {
    const { app, calls } = buildApp();
    const res = await authenticated(app).post('/sign-in').type('form').send({ accessToken, analystId: 'ana-006' }).expect(401);
    expect(calls).toHaveLength(0);
    expect(res.text).toContain('Sign in with a valid access token.');
    expect(res.text).not.toContain('value=');
    expect(res.get('Set-Cookie')).toContainEqual(expect.stringContaining('kyc_access_token=;'));
    expect(res.headers.location).toBeUndefined();
  });

  it.each(['invalid', 'expired', 'revoked'])('rejects a syntactically valid %s credential and clears the old session', async (reason) => {
    const { app, calls } = buildApp({
      response: () => json({ error: { code: 'UNAUTHORIZED', message: `${reason}: ${unknownToken}` } }, 401),
    });
    const res = await authenticated(app).post('/sign-in').type('form').send({ accessToken: unknownToken }).expect(401);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('http://api.test/api/me');
    expect(res.text).toContain('Sign in with a valid access token.');
    expect(res.text).not.toContain(unknownToken);
    expect(res.text).not.toContain(managerToken);
    expect(res.text).not.toContain(`${reason}:`);
    expect(res.get('Set-Cookie')).toContainEqual(expect.stringContaining('kyc_access_token=;'));
    expect(res.get('Set-Cookie')?.join(';')).not.toContain(unknownToken);
  });

  it('does not keep the old credential when validation is unavailable', async () => {
    const { app, calls } = buildApp({ unreachable: true });
    const res = await authenticated(app).post('/sign-in').type('form').send({ accessToken: unknownToken }).expect(502);
    expect(calls).toHaveLength(1);
    expect(res.get('Set-Cookie')).toContainEqual(expect.stringContaining('kyc_access_token=;'));
    expect(res.text).not.toContain(unknownToken);
    expect(res.text).not.toContain(managerToken);
  });

  it('cannot authenticate by submitting an analyst ID to either sign-in or the removed switch route', async () => {
    const { app, calls } = buildApp();
    for (const path of ['/sign-in', '/switch-analyst']) {
      const res = await request(app).post(path).set('Host', 'web.test').set('Origin', 'https://web.test')
        .set('Cookie', 'analyst_id=ana-006').type('form').send({ analystId: 'ana-006' }).expect(401);
      expect(res.get('Set-Cookie')?.join(';')).not.toContain('analyst_id=ana-006');
      expect(res.text).toContain('<h1>Sign in</h1>');
    }
    expect(calls).toHaveLength(0);
    await authenticated(app).post('/switch-analyst').type('form').send({ analystId: 'ana-003' }).expect(404);
    expect(calls.every((call) => new Headers(call.init?.headers).get('authorization') === `Bearer ${managerToken}`)).toBe(true);
  });

  it('uses a full-page redirect for htmx sign-in', async () => {
    const { app } = buildApp();
    const res = await authenticated(app).post('/sign-in').set('HX-Request', 'true')
      .type('form').send({ accessToken: tokens['ana-003'] }).expect(204);
    expect(res.headers['hx-redirect']).toBe('/');
    expect(res.text).toBe('');
  });
});

describe('Credential expiry and sign-out', () => {
  it.each(['expired', 'revoked'])('rejects a previously accepted %s token without recovering another identity', async () => {
    const rejectedTokens: string[] = [];
    const { app, calls } = buildApp({ rejectedTokens });
    await authenticated(app).get('/cases/case-006').expect(200);
    rejectedTokens.push(managerToken);
    calls.length = 0;
    const res = await authenticated(app).get('/cases/case-006').expect(401);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('http://api.test/api/me');
    expect(res.text).toContain('<h1>Sign in</h1>');
    expect(res.text).not.toContain('Priya Holloway');
    expect(res.text).not.toContain('Signed in as');
    expect(res.text).not.toContain(managerToken);
    expect(res.get('Set-Cookie')).toContainEqual(expect.stringContaining('kyc_access_token=;'));
  });

  it.each([
    '/api/me', '/api/analysts', '/api/cases/stats', '/api/cases',
    '/api/cases/case-006', '/api/cases/case-006/risk-explanation',
  ])('does not swallow an authoritative 401 from %s', async (endpoint) => {
    const { app, calls } = buildApp({
      response: ({ url }) => new URL(url).pathname === endpoint ? new Response('expired', { status: 401 }) : undefined,
    });
    const path = endpoint.includes('/case-006') ? '/cases/case-006' : '/';
    const res = await authenticated(app).get(path).expect(401);
    expect(res.text).toContain('<h1>Sign in</h1>');
    expect(res.text).not.toContain('Priya Holloway');
    expect(calls.every((call) => new Headers(call.init?.headers).get('authorization') === `Bearer ${managerToken}`)).toBe(true);
    expect(res.get('Set-Cookie')).toContainEqual(expect.stringContaining('kyc_access_token=;'));
  });

  it.each([false, true])('never retries an unauthorized mutation (htmx=%s)', async (isHx) => {
    const { app, calls } = buildApp({ action: () => new Response('revoked', { status: 401 }) });
    const res = await authenticated(app).post('/cases/case-006/actions/approve').set('HX-Request', String(isHx))
      .type('form').send({ note: 'Reviewed the evidence.' }).expect(401);
    expect(calls.filter((call) => call.init?.method === 'POST')).toHaveLength(1);
    expect(calls.every((call) => new Headers(call.init?.headers).get('authorization') === `Bearer ${managerToken}`)).toBe(true);
    expect(res.text).not.toContain('Case approved.');
    expect(res.text).not.toContain('Priya Holloway');
    expect(res.text).not.toContain(managerToken);
    expect(res.get('Set-Cookie')).toContainEqual(expect.stringContaining('kyc_access_token=;'));
    if (isHx) {
      expect(res.headers['hx-redirect']).toBe('/sign-in');
      expect(res.headers['hx-retarget']).toBeUndefined();
      expect(res.text).toBe('');
    } else {
      expect(res.text).toContain('<h1>Sign in</h1>');
    }
  });

  it.each(['/', '/cases/case-006/actions/approve'])('redirects expired htmx reads at %s to a full sign-in page', async (path) => {
    const { app } = buildApp({ rejectedTokens: [managerToken] });
    const res = await authenticated(app).get(path).set('HX-Request', 'true').expect(401);
    expect(res.headers['hx-redirect']).toBe('/sign-in');
    expect(res.text).toBe('');
  });

  it.each([false, true])('signs out without requiring or revoking an active token (htmx=%s)', async (isHx) => {
    const { app, calls } = buildApp({ rejectedTokens: [managerToken] });
    const res = await authenticated(app).post('/sign-out').set('HX-Request', String(isHx)).expect(isHx ? 204 : 303);
    expect(calls).toHaveLength(0);
    const cookies: string[] = res.get('Set-Cookie') ?? [];
    for (const name of ['kyc_access_token', 'analyst_id']) {
      const cookie = cookies.find((value) => value.startsWith(`${name}=`));
      expect(cookie).toContain(`${name}=;`);
      expect(cookie).toContain('Expires=Thu, 01 Jan 1970');
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Strict');
      expect(cookie).toContain('Secure');
      expect(cookie).toContain('Path=/');
    }
    expect(res.headers[isHx ? 'hx-redirect' : 'location']).toBe('/sign-in');
    expect(res.text).not.toContain(managerToken);
    await request(app).get('/').expect(401);
  });

  it('clears the browser session and switches only after accepting a different credential', async () => {
    vi.stubEnv('ALLOW_INSECURE_LOCAL_AUTH', 'true');
    vi.stubEnv('NODE_ENV', 'development');
    const { app, calls } = buildApp();
    const browser = request.agent(app);
    function post(path: string) {
      return browser.post(path).set('Host', '127.0.0.1').set('Origin', 'http://127.0.0.1').type('form');
    }
    await post('/sign-in').send({ accessToken: managerToken }).expect(303);
    expect((await browser.get('/').expect(200)).text).toContain('Signed in as Sofia Chen');
    await post('/sign-out').expect(303);
    const signedOut = await browser.get('/').expect(401);
    expect(signedOut.text).not.toContain('Sofia Chen');
    expect(signedOut.text).not.toContain('Priya Holloway');
    await post('/sign-in').send({ analystId: 'ana-003' }).expect(401);
    await browser.get('/').expect(401);
    await post('/sign-in').send({ accessToken: tokens['ana-003'] }).expect(303);
    const signedIn = await browser.get('/').expect(200);
    expect(signedIn.text).toContain('Signed in as Grete Lindholm');
    expect(signedIn.text).not.toContain('Signed in as Sofia Chen');
    expect(signedIn.text).not.toContain(tokens['ana-003']);
    expect(calls.at(-1)?.init?.headers).toMatchObject({ authorization: `Bearer ${tokens['ana-003']}` });
  });

  it.each([400, 403, 409])('redacts the credential if a %s action error echoes it', async (status) => {
    const { app, calls } = buildApp({
      action: () => json({ error: { code: 'ERROR', message: `Rejected ${managerToken} ${managerToken}` } }, status),
    });
    const res = await authenticated(app).post('/cases/case-006/actions/approve').set('HX-Request', 'true')
      .type('form').send({ note: 'Reviewed the evidence.' }).expect(200);
    expect(res.text).toContain('Rejected [redacted] [redacted]');
    expect(res.text).not.toContain(managerToken);
    expect(calls.every((call) => !call.url.includes(managerToken))).toBe(true);
    expect(calls.every((call) => !String(call.init?.body ?? '').includes(managerToken))).toBe(true);
  });
});

describe('Cookie transport and form origins', () => {
  it('requires HTTPS origin by default and does not enable trust proxy', async () => {
    const { app, calls } = buildApp();
    expect(app.get('trust proxy')).toBe(false);
    const res = await request(app).post('/sign-in').set('Host', 'web.test').set('Origin', 'http://web.test')
      .type('form').send({ accessToken: managerToken }).expect(403);
    expect(calls).toHaveLength(0);
    expect(res.get('Set-Cookie')).toBeUndefined();
  });

  it.each(['', 'false', 'TRUE', '1'])('keeps Secure unless the HTTP opt-in is exactly true (%s)', async (value) => {
    vi.stubEnv('ALLOW_INSECURE_LOCAL_AUTH', value);
    const { app } = buildApp();
    const res = await authenticated(app).post('/sign-in').type('form').send({ accessToken: managerToken }).expect(303);
    const cookies = res.get('Set-Cookie') ?? [];
    expect(cookies.find((cookie) => cookie.startsWith(authCookie()))).toContain('Secure');
  });

  it('supports explicit local HTTP opt-in with all other cookie protections intact', async () => {
    vi.stubEnv('ALLOW_INSECURE_LOCAL_AUTH', 'true');
    vi.stubEnv('NODE_ENV', 'development');
    const { app } = buildApp();
    const res = await request(app).post('/sign-in').set('Host', 'localhost:3000').set('Origin', 'http://localhost:3000')
      .type('form').send({ accessToken: managerToken }).expect(303);
    const cookies = res.get('Set-Cookie') ?? [];
    const cookie = cookies.find((value) => value.startsWith(authCookie()));
    expect(cookie).not.toContain('Secure');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Max-Age=28800');
    const cleared = await request(app).post('/sign-out').set('Host', 'localhost:3000').set('Origin', 'http://localhost:3000').expect(303);
    expect(cleared.get('Set-Cookie')?.join(';')).not.toContain('Secure');
  });

  it('fails closed for insecure production configuration', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ALLOW_INSECURE_LOCAL_AUTH', 'true');
    expect(() => buildApp()).toThrow('ALLOW_INSECURE_LOCAL_AUTH is not permitted in production.');
  });

  it('keeps secure cookies in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { app } = buildApp();
    const res = await authenticated(app).post('/sign-in').type('form').send({ accessToken: managerToken }).expect(303);
    const cookies = res.get('Set-Cookie') ?? [];
    expect(cookies.find((cookie) => cookie.startsWith(authCookie()))).toContain('Secure');
  });

  it.each(['/sign-in', '/sign-out', '/cases/case-006/actions/approve'])('rejects cross-site, missing and forwarded origins for %s', async (path) => {
    const { app, calls } = buildApp();
    for (const origin of [undefined, 'null', 'https://evil.test', 'https://web.test:444', 'http://web.test']) {
      const submission = authenticated(app).post(path)
        .set('X-Forwarded-Host', 'evil.test').set('X-Forwarded-Proto', 'http');
      if (origin === undefined) submission.unset('Origin');
      else submission.set('Origin', origin);
      const res = await submission.type('form').send({ accessToken: managerToken, note: 'Reviewed the evidence.' }).expect(403);
      expect(res.get('Set-Cookie')).toBeUndefined();
      expect(res.text).not.toContain(managerToken);
      expect(res.headers['cache-control']).toBe('no-store');
    }
    await authenticated(app).post(path).set('Sec-Fetch-Site', 'cross-site')
      .type('form').send({ accessToken: managerToken, note: 'Reviewed the evidence.' }).expect(403);
    expect(calls).toHaveLength(0);
  });
});
