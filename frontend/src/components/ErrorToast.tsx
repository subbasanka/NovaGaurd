import { useEffect } from "react";

interface Props {
  message: string;
  onDismiss: () => void;
  autoDismissMs?: number;
}

export function ErrorToast({ message, onDismiss, autoDismissMs = 6000 }: Props) {
  useEffect(() => {
    if (autoDismissMs <= 0) return;
    const t = setTimeout(onDismiss, autoDismissMs);
    return () => clearTimeout(t);
  }, [onDismiss, autoDismissMs]);

  return (
    <div
      role="alert"
      className="fixed bottom-4 right-4 z-50 max-w-md rounded-lg border border-red-300 bg-red-50 px-4 py-3 shadow-lg"
    >
      <div className="flex items-start gap-3">
        <span className="text-red-500" aria-hidden>
          ⚠
        </span>
        <p className="flex-1 text-sm text-red-800">{message}</p>
        <button
          type="button"
          onClick={onDismiss}
          className="text-red-600 hover:text-red-800 focus:outline-none focus:ring-2 focus:ring-red-400"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
