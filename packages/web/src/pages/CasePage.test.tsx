import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RiskExplanation, RiskFactor } from '../api/types';
import { RiskPanel } from './CasePage';

const summary =
  'The recorded score does not match the recorded weights after the 0-100 cap. ' +
  'The recorded risk level does not match the score thresholds.';

const explanation: RiskExplanation = {
  caseId: 'legacy-case',
  riskScore: 70,
  riskLevel: 'low',
  rawScore: 0,
  scoreCapped: false,
  primaryDriver: null,
  summary,
  thresholds: { medium: 30, high: 60 },
  factors: [],
};

describe('risk explanation warnings', () => {
  it('preserves server discrepancies when no signal evidence was recorded', () => {
    const markup = renderToStaticMarkup(<RiskPanel explanation={explanation} />);

    expect(markup).toContain(summary);
    expect(markup).toContain('No structured risk signals were recorded.');
    expect(markup).not.toContain('were triggered');
    expect(markup).not.toContain('<details');
  });

  it('keeps discrepancies visible outside the collapsed evidence disclosure', () => {
    const factor: RiskFactor = {
      signalId: 'record-1',
      code: 'ADDRESS_UNVERIFIED',
      title: 'Address unverified',
      description: 'No verified proof of address on file.',
      severity: 'low',
      weight: 10,
      contributionPct: 100,
    };
    const markup = renderToStaticMarkup(
      <RiskPanel explanation={{
        ...explanation,
        rawScore: 10,
        factors: [factor],
        primaryDriver: factor,
      }} />,
    );

    expect(markup).toContain(summary);
    expect(markup.indexOf(summary)).toBeLessThan(markup.indexOf('<details'));
    expect(markup).toContain('Evidence record record-1');
  });
});
