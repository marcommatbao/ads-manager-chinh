"use client";

import { useState, useEffect } from "react";

// ─────────────────────────────────────────────
// DraftNameEditor
// ─────────────────────────────────────────────

export function DraftNameEditor({ name, onRename }: { name: string; onRename: (n: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(name);

  // Sync when name prop changes
  useEffect(() => { setVal(name); }, [name]);

  if (editing) {
    return (
      <input
        value={val}
        onChange={e => setVal(e.target.value)}
        onBlur={() => { onRename(val); setEditing(false); }}
        onKeyDown={e => {
          if (e.key === "Enter") { onRename(val); setEditing(false); }
          if (e.key === "Escape") setEditing(false);
        }}
        autoFocus
        className="rounded-lg border border-blue-300 px-3 py-1 text-sm font-medium outline-none focus:ring-2 focus:ring-blue-200 w-52"
      />
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-gray-700 hover:bg-gray-100 group max-w-[200px] truncate"
      title={name}
    >
      <span className="truncate">{name}</span>
      <span className="text-gray-300 group-hover:text-gray-500 text-xs flex-shrink-0">✏</span>
    </button>
  );
}
