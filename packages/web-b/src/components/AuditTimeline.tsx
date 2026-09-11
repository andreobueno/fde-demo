import { ACTION_LABELS } from '@/lib/actionRules';
import { formatDateTime } from '@/lib/format';
import { useChainVerification } from '@/lib/auditChain';
import { Tooltip } from '@/components/ui/tooltip';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChainIcon, StatusBadge } from './common';
import type { AuditEvent } from '@/api/types';
export function AuditTimeline({ events }: { events: AuditEvent[] }) {
  const chain = useChainVerification(events);
  const broken =
    chain === 'broken'
      ? events.find(
          (event) =>
            event.prevHash !==
            (events.find((candidate) => candidate.sequence === event.sequence - 1)?.hash ??
              '0'.repeat(64)),
        )
      : undefined;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Audit history</CardTitle>
          <span className="flex items-center gap-1 text-xs">
            <ChainIcon state={chain} />
            {chain === 'checking' ? (
              'Verifying…'
            ) : chain === 'verified' ? (
              <span className="text-green-700">Chain verified</span>
            ) : (
              <span className="text-red-700">Chain broken at #{broken?.sequence ?? '?'}</span>
            )}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-0">
          {[...events]
            .sort((a, b) => b.sequence - a.sequence)
            .map((event, i) => (
              <div className="relative flex gap-3 pb-6 last:pb-0" key={event.id}>
                <div className="relative flex w-4 justify-center">
                  <span className="z-10 mt-1 h-2.5 w-2.5 rounded-full bg-slate-400" />
                  {i < events.length - 1 && (
                    <span className="absolute top-3 h-full border-l border-slate-200" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium">{event.actorName}</span>
                    <time className="text-xs text-slate-500">
                      {formatDateTime(event.createdAt)}
                    </time>
                  </div>
                  <p className="mt-1 text-sm text-slate-700">
                    {ACTION_LABELS[event.action as keyof typeof ACTION_LABELS] ?? event.action}
                  </p>
                  <div className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                    <StatusBadge status={event.fromStatus} small />
                    <span>→</span>
                    <StatusBadge status={event.toStatus} small />
                  </div>
                  {event.note && (
                    <p className="mt-2 text-sm italic text-slate-600">“{event.note}”</p>
                  )}
                  <Tooltip content={event.hash}>
                    <span
                      title={event.hash}
                      className="mt-2 inline-block font-mono text-[10px] text-slate-400"
                    >
                      {event.hash.slice(0, 12)}…
                    </span>
                  </Tooltip>
                </div>
              </div>
            ))}
        </div>
      </CardContent>
    </Card>
  );
}
