import { useEffect } from 'react';

interface ToastProps {
  message: string;
  onDismiss: () => void;
}

export function Toast({ message, onDismiss }: ToastProps) {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, 4000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [onDismiss]);

  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        bottom: '16px',
        right: '16px',
        background: 'var(--badge-low-bg)',
        color: 'var(--badge-low-fg)',
        border: '1px solid var(--badge-low-fg)',
        borderRadius: '4px',
        padding: '10px 16px',
        zIndex: 100,
      }}
    >
      {message}
    </div>
  );
}
