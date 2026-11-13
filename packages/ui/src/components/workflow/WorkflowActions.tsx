'use client';

import { useState } from 'react';
import { useApi } from '../../hooks/use-api';
import { Button } from '../button';
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../dialog';
import { Textarea } from '../textarea';
import { ArrowRight, X, Ban } from 'lucide-react';

interface WorkflowStep {
  id: string;
  state: string;
  label: string;
  permissions: string[];
}

interface WorkflowActionsProps {
  processKey: string;
  currentState: string;
  onAdvance: (comment?: string) => Promise<void>;
  onReject?: (reason: string) => Promise<void>;
  onCancel?: (reason: string) => Promise<void>;
  userPermissions: string[];
  className?: string;
}

export function WorkflowActions({
  processKey,
  currentState,
  onAdvance,
  onReject,
  onCancel,
  userPermissions,
  className,
}: WorkflowActionsProps) {
  const { data: steps } = useApi<WorkflowStep[]>(
    `/workflow/processes/${processKey}/steps`,
  );

  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!steps) return null;

  const currentIndex = steps.findIndex((s) => s.state === currentState);
  const nextStep = currentIndex >= 0 && currentIndex < steps.length - 1 ? steps[currentIndex + 1] : null;

  const canAdvance = (() => {
    if (!nextStep) return false;
    if (!nextStep.permissions || nextStep.permissions.length === 0) return true;
    return nextStep.permissions.some((p) =>
      userPermissions.some((up) => up.toUpperCase() === p.toUpperCase()),
    );
  })();

  async function handleAdvance() {
    setIsSubmitting(true);
    try {
      await onAdvance(comment || undefined);
      setAdvanceOpen(false);
      setComment('');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleAction(
    handler: (reason: string) => Promise<void>,
    closer: (v: boolean) => void,
  ) {
    if (!comment.trim()) return;
    setIsSubmitting(true);
    try {
      await handler(comment);
      closer(false);
      setComment('');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className={className}>
      <div className="flex items-center gap-2 flex-wrap">
        {canAdvance && nextStep && (
          <Button size="sm" onClick={() => { setComment(''); setAdvanceOpen(true); }}>
            <ArrowRight className="mr-1 h-4 w-4" />
            Advance to {nextStep.label}
          </Button>
        )}
        {onReject && (
          <Button size="sm" variant="destructive" onClick={() => { setComment(''); setRejectOpen(true); }}>
            <X className="mr-1 h-4 w-4" />
            Reject
          </Button>
        )}
        {onCancel && (
          <Button size="sm" variant="outline" onClick={() => { setComment(''); setCancelOpen(true); }}>
            <Ban className="mr-1 h-4 w-4" />
            Cancel
          </Button>
        )}
      </div>

      {/* Advance Dialog */}
      <DialogRoot open={advanceOpen} onOpenChange={setAdvanceOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Advance to {nextStep?.label}</DialogTitle>
            <DialogDescription>
              This will move the status from {currentState} to {nextStep?.state}.
            </DialogDescription>
          </DialogHeader>
          <div className="px-6 py-2">
            <Textarea
              placeholder="Add a comment (optional)"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter className="gap-2 pt-4">
            <Button variant="outline" onClick={() => setAdvanceOpen(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button onClick={handleAdvance} disabled={isSubmitting}>
              {isSubmitting ? 'Advancing...' : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </DialogRoot>

      {/* Reject Dialog */}
      <DialogRoot open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject</DialogTitle>
            <DialogDescription>
              Please provide a reason for rejection.
            </DialogDescription>
          </DialogHeader>
          <div className="px-6 py-2">
            <Textarea
              placeholder="Reason for rejection (required)"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter className="gap-2 pt-4">
            <Button variant="outline" onClick={() => setRejectOpen(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => onReject && handleAction(onReject, setRejectOpen)}
              disabled={isSubmitting || !comment.trim()}
            >
              {isSubmitting ? 'Rejecting...' : 'Reject'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </DialogRoot>

      {/* Cancel Dialog */}
      <DialogRoot open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel</DialogTitle>
            <DialogDescription>
              Please provide a reason for cancellation.
            </DialogDescription>
          </DialogHeader>
          <div className="px-6 py-2">
            <Textarea
              placeholder="Reason for cancellation (required)"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter className="gap-2 pt-4">
            <Button variant="outline" onClick={() => setCancelOpen(false)} disabled={isSubmitting}>
              Back
            </Button>
            <Button
              variant="destructive"
              onClick={() => onCancel && handleAction(onCancel, setCancelOpen)}
              disabled={isSubmitting || !comment.trim()}
            >
              {isSubmitting ? 'Cancelling...' : 'Confirm Cancel'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </DialogRoot>
    </div>
  );
}
