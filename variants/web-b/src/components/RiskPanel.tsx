import { useRiskExplanation } from '@/api/queries';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingState, RiskBadge } from './common';
import type { RiskLevel } from '@/api/types';
export function RiskPanel({ id, riskLevel }: { id: string; riskLevel: RiskLevel }) {
  const { data, isLoading } = useRiskExplanation(id);
  if (isLoading || !data)
    return (
      <Card>
        <CardHeader>
          <CardTitle>Risk assessment</CardTitle>
        </CardHeader>
        <CardContent>
          <LoadingState />
        </CardContent>
      </Card>
    );
  const fill =
    data.riskLevel === 'high'
      ? 'bg-red-500'
      : data.riskLevel === 'medium'
        ? 'bg-amber-500'
        : 'bg-green-500';
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>
            {riskLevel === 'high' ? 'Why is this case high risk?' : 'Risk assessment'}
          </CardTitle>
          <RiskBadge risk={data.riskLevel} />
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-slate-600">{data.summary}</p>
        <div>
          <div className="relative h-3 rounded-full bg-slate-100">
            <div className={`h-3 rounded-full ${fill}`} style={{ width: `${data.riskScore}%` }} />
            <span
              className="absolute -top-1 h-5 border-l border-slate-500"
              style={{ left: `${data.thresholds.medium}%` }}
            />
            <span
              className="absolute -top-1 h-5 border-l border-slate-700"
              style={{ left: `${data.thresholds.high}%` }}
            />
          </div>
          <div className="mt-2 flex justify-between text-[11px] text-slate-500">
            <span>0</span>
            <span>Medium ≥{data.thresholds.medium}</span>
            <span>High ≥{data.thresholds.high}</span>
            <span>100</span>
          </div>
        </div>
        <div className="space-y-4">
          {[...data.factors]
            .sort((a, b) => b.weight - a.weight)
            .map((factor) => (
              <div key={factor.code}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge>{factor.severity}</Badge>
                    <span className="text-sm font-medium">{factor.title}</span>
                  </div>
                  <span className="text-xs font-semibold text-slate-600">
                    +{factor.weight} · {factor.contributionPct}%
                  </span>
                </div>
                <div className="mt-1 h-1 rounded bg-slate-100">
                  <div
                    className="h-1 rounded bg-slate-400"
                    style={{ width: `${Math.min(100, factor.contributionPct)}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-slate-500">{factor.description}</p>
              </div>
            ))}
        </div>
      </CardContent>
    </Card>
  );
}
