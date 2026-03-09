import { useEffect } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, X } from "lucide-react";

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
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 20, scale: 0.95 }}
      role="alert"
      className="fixed bottom-4 right-4 z-50 max-w-md rounded-lg border border-red-500/30 bg-red-500/10 backdrop-blur-sm px-4 py-3 shadow-lg"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" aria-hidden="true" />
        <p className="flex-1 text-sm text-red-300">{message}</p>
        <button
          type="button"
          onClick={onDismiss}
          className="text-red-400 hover:text-red-300 focus:outline-none focus:ring-2 focus:ring-red-400 rounded"
          aria-label="Dismiss error"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </motion.div>
  );
}
