import request from 'supertest';
import { describe, expect, it } from 'vitest';
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
}

function buildApp(opts: StubOptions = {}) {
  const calls: Call[] = [];
  const fetchStub: FetchLike = async (url, init) => {
    calls.push({ url, init });
    if (opts.unreachable) throw new TypeError('fetch failed');
    const analystId = new Headers(init?.headers).get('x-analyst-id');
    if (!analysts.some((analyst) => analyst.id === analystId)) {
      return json({ error: { code: 'UNAUTHORIZED', message: 'Unknown analyst context.' } }, 401);
    }
    const { pathname } = new URL(url);
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
  it.each(['ana-001', 'ana-003'])('forwards selected identity %s on every API read', async (analystId) => {
    const { app, calls } = buildApp();
    for (const path of ['/', '/cases/case-006', '/cases/case-006/actions/reject']) {
      await request(app).get(path).set('Cookie', `analyst_id=${analystId}`).expect(200);
    }
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((call) => new Headers(call.init?.headers).get('x-analyst-id') === analystId)).toBe(true);
    expect(calls.some((call) => call.url.endsWith('/api/analysts'))).toBe(true);
    expect(calls.some((call) => call.url.endsWith('/api/cases/stats'))).toBe(true);
    expect(calls.some((call) => call.url.endsWith('/risk-explanation'))).toBe(true);
  });

  it('uses an unprivileged default and recovers unknown cookies on reads', async () => {
    const { app, calls } = buildApp();
    await request(app).get('/').expect(200);
    expect(calls.every((call) => new Headers(call.init?.headers).get('x-analyst-id') === 'ana-003')).toBe(true);
    calls.length = 0;
    const recovered = await request(app).get('/cases/case-006').set('Cookie', 'analyst_id=deleted').expect(200);
    expect(recovered.text).toContain('value="ana-003" selected=""');
    expect(new Headers(calls[0]?.init?.headers).get('x-analyst-id')).toBe('deleted');
    expect(calls.slice(1).every((call) => new Headers(call.init?.headers).get('x-analyst-id') === 'ana-003')).toBe(true);
  });

  it('renders queue rows, stats and filter state from the API', async () => {
    const { app, calls } = buildApp();
    const res = await request(app).get('/?riskLevel=high&status=in_review&q=priya');
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
    const res = await request(app).get('/?q=&status=pending&sort=createdAt&order=desc').set('HX-Request', 'true');
    expect(res.status).toBe(200);
    expect(res.headers['hx-push-url']).toBe('/?status=pending');
    expect(res.text.startsWith('<section id="queue-results"')).toBe(true);
    expect(res.text).not.toContain('<html');
    expect(calls.some((c) => c.url.endsWith('/api/cases/stats'))).toBe(false);
  });

  it('shows a friendly error page when the API is unreachable', async () => {
    const { app } = buildApp({ unreachable: true });
    const res = await request(app).get('/');
    expect(res.status).toBe(502);
    expect(res.text).toContain('The KYC API is unreachable');
  });
});

describe('GET /cases/:id', () => {
  it('renders the case, formatted customer fields, sorted factors and a verified chain', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/cases/case-006');
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
    const res = await request(app).get('/cases/nope');
    expect(res.status).toBe(404);
    expect(res.text).toContain('Case not found');
  });

  it.each(['pending', 'in_review', 'escalated'] as const)('shows a role restriction for an open %s case without actions', async (status) => {
    const { app } = buildApp({ caseDetail: { status, allowedActions: [] } });
    const res = await request(app).get('/cases/case-006').expect(200);
    expect(res.text).toContain('The selected role does not have permission to act on this case.');
    expect(res.text).not.toContain('Case closed.');
    expect(res.text).not.toContain('btn-action-');
  });

  it.each(['approved', 'rejected'] as const)('shows closure for a terminal %s case', async (status) => {
    const { app } = buildApp({ caseDetail: { status, allowedActions: [] } });
    const res = await request(app).get('/cases/case-006').expect(200);
    expect(res.text).toContain('<strong>Case closed.</strong>');
    expect(res.text).toContain(`This case is ${status}; no further actions are available.`);
    expect(res.text).not.toContain('does not have permission');
    expect(res.text).not.toContain('btn-action-');
  });

  it.each(['low', 'medium', 'high'] as const)('describes both decision roles for escalated %s-risk cases', async (riskLevel) => {
    const { app } = buildApp({ caseDetail: { status: 'escalated', riskLevel, allowedActions: ['approve', 'reject'] } });
    const res = await request(app).get('/cases/case-006').set('Cookie', 'analyst_id=ana-006').expect(200);
    expect(res.text).toContain('Senior analysts can resolve low- and medium-risk cases; compliance managers can resolve cases at all risk levels.');
    expect(res.text).not.toContain('can only be resolved by a senior analyst');
    expect(res.text).toContain('>Approve</a>');
    expect(res.text).toContain('>Reject</a>');
  });

  it('serves the action dialog as a fragment for htmx and inline for full page loads', async () => {
    const { app } = buildApp();
    const frag = await request(app).get('/cases/case-006/actions/reject').set('HX-Request', 'true');
    expect(frag.text.startsWith('<dialog id="action-dialog"')).toBe(true);
    expect(frag.text).toContain('hx-post="/cases/case-006/actions/reject"');
    const full = await request(app).get('/cases/case-006/actions/reject');
    expect(full.text).toContain('<html');
    expect(full.text).toContain('<dialog id="action-dialog"');
  });
});

describe('POST /cases/:id/actions/:action', () => {
  it('never retries a case mutation under a fallback identity', async () => {
    const { app, calls } = buildApp();
    await request(app).post('/cases/case-006/actions/escalate')
      .set('Cookie', 'analyst_id=deleted').type('form')
      .send({ note: 'Escalation requires further review.' }).expect(401);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('http://api.test/api/analysts');
    expect(new Headers(calls[0]?.init?.headers).get('x-analyst-id')).toBe('deleted');
  });

  it('forwards the note and analyst header, then renders the refreshed case and toast', async () => {
    const { app, calls } = buildApp();
    const res = await request(app)
      .post('/cases/case-006/actions/approve')
      .set('HX-Request', 'true')
      .set('Cookie', 'analyst_id=ana-006')
      .type('form')
      .send({ note: 'Documents verified in person.' });
    expect(res.status).toBe(200);
    const post = calls.find((c) => c.init?.method === 'POST');
    expect(post).toBeDefined();
    expect(post!.url).toBe('http://api.test/api/cases/case-006/actions');
    const headers = post!.init!.headers as Record<string, string>;
    expect(headers['x-analyst-id']).toBe('ana-006');
    expect(JSON.parse(post!.init!.body as string)).toEqual({ action: 'approve', note: 'Documents verified in person.' });
    expect(res.text).toContain('id="case-main"');
    expect(res.text).toContain('Case approved.');
    expect(res.text).toContain('id="dialog-slot" hx-swap-oob="true"');
  });

  it('redirects back to the case for non-htmx form posts', async () => {
    const { app } = buildApp();
    const res = await request(app).post('/cases/case-006/actions/approve').type('form').send({ note: 'Reviewed documents.' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/cases/case-006?done=approve');
  });

  it('rejects an invalid note client-side without calling the API', async () => {
    const { app, calls } = buildApp();
    const res = await request(app)
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
    { status: 401, code: 'UNAUTHORIZED', message: 'Unknown analyst context.' },
    { status: 403, code: 'FORBIDDEN', message: "Your role does not permit 'approve' on a 'high' risk case." },
    { status: 409, code: 'INVALID_TRANSITION', message: "Cannot perform 'approve' on a case with status 'approved'." },
  ])('renders authoritative API $status errors after preliminary validation passes', async ({ status, code, message }) => {
    const { app, calls } = buildApp({
      action: () => json({ error: { code, message } }, status),
    });
    const res = await request(app)
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

    const full = await request(app).post('/cases/case-006/actions/approve').type('form').send({ note: 'Looks fine after review.' });
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
    const res = await request(app).get(`/cases/case-006/actions/${action}`)
      .set('HX-Request', String(isHx)).set('Cookie', 'analyst_id=ana-006').expect(200);
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
    expect(calls.every((call) => new Headers(call.init?.headers).get('x-analyst-id') === 'ana-006')).toBe(true);
  });

  it.each(noteScenarios.filter((scenario) => scenario.required))(
    'POST rejects invalid required notes for $action/$riskLevel/$approvalNoteRequired before mutation',
    async ({ action, riskLevel, approvalNoteRequired }) => {
      const { app, calls } = buildApp({ caseDetail: { riskLevel, approvalNoteRequired } });
      for (const note of [undefined, ' \t\n ', ' 123456789 ', 'x'.repeat(1001)]) {
        const res = await request(app).post(`/cases/case-006/actions/${action}`)
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
        const res = await request(app).post(`/cases/case-006/actions/${action}`)
          .set('HX-Request', String(isHx)).set('Cookie', 'analyst_id=ana-006').type('form')
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
      expect(calls.every((call) => new Headers(call.init?.headers).get('x-analyst-id') === 'ana-006')).toBe(true);
    },
  );

  it.each(noteScenarios.filter((scenario) => !scenario.required))(
    'POST permits empty and short optional notes for $action/$riskLevel/$approvalNoteRequired',
    async ({ action, riskLevel, approvalNoteRequired }) => {
      const { app, calls } = buildApp({ caseDetail: { riskLevel, approvalNoteRequired } });
      for (const note of [undefined, ' \t\n ', ' ok ']) {
        await request(app).post(`/cases/case-006/actions/${action}`)
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
    const dialog = await request(app).get('/cases/case-006/actions/approve')
      .set('HX-Request', String(isHx)).expect(200);
    expect(dialog.text).toContain('(optional)');
    caseDetail.approvalNoteRequired = true;
    const res = await request(app).post('/cases/case-006/actions/approve')
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
    const res = await request(app).post('/cases/case-006/actions/approve')
      .set('HX-Request', String(isHx)).set('Cookie', 'analyst_id=ana-001').type('form')
      .send({ note: '' }).expect(isHx ? 200 : 400);
    expect(res.text).toContain('role="alert"');
    expect(res.text).toContain(message);
    expect(res.text).not.toContain('Case approved.');
    if (isHx) expect(res.headers['hx-retarget']).toBe('#dialog-slot');
    const posts = calls.filter((call) => call.init?.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(JSON.parse(posts[0]!.init!.body as string)).toEqual({ action: 'approve' });
    expect(calls.every((call) => new Headers(call.init?.headers).get('x-analyst-id') === 'ana-001')).toBe(true);
  });
});

describe('POST /switch-analyst', () => {
  it('lets a user replace an invalid persisted identity explicitly', async () => {
    const { app } = buildApp();
    const response = await request(app).post('/switch-analyst')
      .set('Cookie', 'analyst_id=deleted').type('form')
      .send({ analystId: 'ana-001', returnTo: '/' }).expect(303);
    expect(response.headers['set-cookie']?.[0]).toContain('analyst_id=ana-001');
  });

  it('sets an HttpOnly SameSite=Lax cookie and redirects back', async () => {
    const { app } = buildApp();
    const res = await request(app).post('/switch-analyst').type('form').send({ analystId: 'ana-003', returnTo: '/cases/case-006' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/cases/case-006');
    const cookie = res.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toContain('analyst_id=ana-003');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
  });

  it('rejects unknown analysts and open redirects', async () => {
    const { app } = buildApp();
    expect((await request(app).post('/switch-analyst').type('form').send({ analystId: 'nope' })).status).toBe(400);
    const res = await request(app).post('/switch-analyst').type('form').send({ analystId: 'ana-001', returnTo: '//evil.test' });
    expect(res.headers.location).toBe('/');
  });

  it('asks htmx to refresh the page', async () => {
    const { app } = buildApp();
    const res = await request(app).post('/switch-analyst').set('HX-Request', 'true').type('form').send({ analystId: 'ana-001' });
    expect(res.status).toBe(204);
    expect(res.headers['hx-refresh']).toBe('true');
  });
});
