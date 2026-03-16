import { useState, useRef, useEffect } from "react";
import { ChevronDown, Trash2, Plus } from "lucide-react";
import type { Project } from "../types";
import { cn } from "../lib/cn";

interface Props {
  projects: Project[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string, name: string) => void;
  defaultProjectId?: string;
}

export function ProjectDropdown({ projects, selectedId, onSelect, onNew, onDelete, defaultProjectId }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = projects.find((p) => p.id === selectedId);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      {/* Trigger */}
      <button
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs bg-surface-raised border border-surface-border text-gray-200",
          "hover:border-gray-500 transition-colors min-w-[140px]"
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate flex-1 text-left">{selected?.name ?? "Select..."}</span>
        <ChevronDown className={cn("w-3.5 h-3.5 text-gray-500 transition-transform flex-shrink-0", open && "rotate-180")} aria-hidden="true" />
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute top-full left-0 mt-1 w-56 rounded-lg bg-surface-raised border border-surface-border shadow-xl z-50 py-1 overflow-hidden"
          role="listbox"
        >
          {projects.map((project) => {
            const isSelected = project.id === selectedId;
            const isDefault = project.id === defaultProjectId;

            return (
              <div
                key={project.id}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 group",
                  isSelected ? "bg-nova-500/15" : "hover:bg-surface-overlay"
                )}
                role="option"
                aria-selected={isSelected}
              >
                <button
                  onClick={() => {
                    onSelect(project.id);
                    setOpen(false);
                  }}
                  className="flex-1 text-left text-xs text-gray-200 truncate"
                >
                  {project.name}
                </button>
                {!isDefault && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(project.id, project.name);
                      setOpen(false);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded text-gray-600 hover:text-red-400 hover:bg-red-500/10 transition-all"
                    title={`Delete ${project.name}`}
                    aria-label={`Delete ${project.name}`}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })}

          {/* Divider + New */}
          <div className="border-t border-surface-border mt-1 pt-1">
            <button
              onClick={() => {
                onNew();
                setOpen(false);
              }}
              className="flex items-center gap-2 w-full px-3 py-2 text-xs text-gray-400 hover:text-gray-200 hover:bg-surface-overlay transition-colors"
            >
              <Plus className="w-3 h-3" aria-hidden="true" />
              New Project
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
