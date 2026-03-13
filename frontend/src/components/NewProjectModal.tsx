import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, FolderPlus } from "lucide-react";
import { cn } from "../lib/cn";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, url: string) => void;
}

export function NewProjectModal({ open, onClose, onCreate }: Props) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("http://localhost:8080");
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setUrl("http://localhost:8080");
      setTimeout(() => nameRef.current?.focus(), 100);
    }
  }, [open]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !url.trim()) return;
    onCreate(name.trim(), url.trim());
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center"
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 12 }}
            transition={{ duration: 0.2 }}
            className="relative w-full max-w-md glass rounded-xl border border-surface-border shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-nova-600/20 border border-nova-500/30 flex items-center justify-center">
                  <FolderPlus className="w-4 h-4 text-nova-400" aria-hidden="true" />
                </div>
                <h2 className="text-sm font-semibold text-gray-200">New Project</h2>
              </div>
              <button
                onClick={onClose}
                className="w-7 h-7 rounded-md flex items-center justify-center text-gray-500 hover:text-gray-300 hover:bg-surface-overlay transition-colors"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
              <div>
                <label htmlFor="new-project-name" className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                  Project Name
                </label>
                <input
                  ref={nameRef}
                  id="new-project-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My Website Audit"
                  className={cn(
                    "w-full px-3 py-2 rounded-lg text-sm bg-surface border border-surface-border text-gray-200",
                    "placeholder:text-gray-600",
                    "focus:outline-none focus:ring-2 focus:ring-nova-500/50 focus:border-nova-500/50",
                    "transition-colors"
                  )}
                />
              </div>

              <div>
                <label htmlFor="new-project-url" className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                  Default URL
                </label>
                <input
                  id="new-project-url"
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com"
                  className={cn(
                    "w-full px-3 py-2 rounded-lg text-sm bg-surface border border-surface-border text-gray-200",
                    "placeholder:text-gray-600",
                    "focus:outline-none focus:ring-2 focus:ring-nova-500/50 focus:border-nova-500/50",
                    "transition-colors"
                  )}
                />
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-gray-400 border border-surface-border hover:bg-surface-overlay transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!name.trim() || !url.trim()}
                  className={cn(
                    "px-5 py-2 rounded-lg text-xs font-semibold transition-all",
                    "bg-nova-600 text-white hover:bg-nova-500 shadow-glow-sm hover:shadow-glow",
                    "disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none disabled:hover:bg-nova-600"
                  )}
                >
                  Create Project
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
