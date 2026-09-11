import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ApiRequestError } from '@/api/client';
import { useCaseAction } from '@/api/queries';
import { ACTION_LABELS, validateActionNote } from '@/lib/actionRules';
import type { CaseAction, RiskLevel } from '@/api/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';

function actionHelper(action: CaseAction, riskLevel: RiskLevel) {
  if (action === 'reject' || action === 'escalate') {
    return 'A note of 10–1000 characters is required';
  }
  if (action === 'approve' && riskLevel === 'high') {
    return 'A note is required for high-risk approval (up to 1000 characters)';
  }
  return 'Note is optional, up to 1000 characters';
}

export function ActionDialog({
  id,
  reference,
  action,
  riskLevel,
  open,
  onOpenChange,
}: {
  id: string;
  reference: string;
  action: CaseAction;
  riskLevel: RiskLevel;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mutation = useCaseAction(id);

  useEffect(() => {
    if (open) {
      setNote('');
      setError(null);
    }
  }, [open]);

  const validation = validateActionNote(action, note, riskLevel);
  const helper = actionHelper(action, riskLevel);

  const handleNoteChange = (value: string) => {
    setNote(value);
    setError(null);
  };

  const handleSuccess = () => {
    onOpenChange(false);
    toast.success(`Case ${ACTION_LABELS[action].toLowerCase()}`);
  };

  const handleError = (err: Error) => {
    setError(err instanceof ApiRequestError ? err.message : 'Unable to complete action');
  };

  const handleCancel = () => {
    onOpenChange(false);
  };

  const handleSubmit = () => {
    if (validation) {
      setError(validation);
      return;
    }
    setError(null);
    mutation.mutate(
      { action, ...(note ? { note } : {}) },
      { onSuccess: handleSuccess, onError: handleError },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>
          {ACTION_LABELS[action]} case {reference}
        </DialogTitle>
        <DialogDescription>{helper}</DialogDescription>
        <div className="mt-4 space-y-2">
          <Textarea
            autoFocus
            value={note}
            onChange={(event) => handleNoteChange(event.target.value)}
            maxLength={1000}
            placeholder="Add a note for the audit history..."
          />
          <div className="flex justify-end text-xs text-slate-500">
            <span>{note.length}/1000</span>
          </div>
          {(error || validation) && (
            <div className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">
              {error ?? validation}
            </div>
          )}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button
            variant={action === 'reject' ? 'destructive' : 'default'}
            disabled={Boolean(validation) || mutation.isPending}
            onClick={handleSubmit}
          >
            {mutation.isPending ? 'Saving…' : 'Confirm'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
