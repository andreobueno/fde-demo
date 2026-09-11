import { useState } from 'react';
import type { CaseAction, RiskLevel } from '@/api/types';
import { ACTION_LABELS, ACTION_ORDER } from '@/lib/actionRules';
import { Button } from '@/components/ui/button';
import { ActionDialog } from './ActionDialog';
export function CaseActions({
  id,
  reference,
  allowedActions,
  riskLevel,
}: {
  id: string;
  reference: string;
  allowedActions: CaseAction[];
  riskLevel: RiskLevel;
}) {
  const [action, setAction] = useState<CaseAction | null>(null);
  return (
    <>
      {
        <div className="flex flex-wrap justify-end gap-2">
          {ACTION_ORDER.filter((item) => allowedActions.includes(item)).map((item) => (
            <Button
              key={item}
              variant={
                item === 'approve' ? 'default' : item === 'reject' ? 'destructive' : 'outline'
              }
              onClick={() => setAction(item)}
            >
              {ACTION_LABELS[item]}
            </Button>
          ))}
        </div>
      }{' '}
      {action && (
        <ActionDialog
          id={id}
          reference={reference}
          action={action}
          riskLevel={riskLevel}
          open
          onOpenChange={(open) => {
            if (!open) setAction(null);
          }}
        />
      )}
    </>
  );
}
