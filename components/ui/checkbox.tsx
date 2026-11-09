"use client"

// Minimal styled checkbox — no Radix/base-ui checkbox primitive is
// installed in this project, so this wraps a native <input> rather
// than adding a new dependency for one control.

import * as React from "react"
import { CheckIcon } from "lucide-react"
import { cn } from "@/lib/utils"

interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "onChange"> {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}

export function Checkbox({ checked, onCheckedChange, className, ...props }: CheckboxProps) {
  return (
    <label
      className={cn(
        "relative inline-flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded border transition-colors",
        checked ? "border-blue-600 bg-blue-600" : "border-slate-300 bg-white hover:border-slate-400",
        className
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onCheckedChange(e.target.checked)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        {...props}
      />
      {checked && <CheckIcon className="h-3 w-3 text-white" strokeWidth={3} />}
    </label>
  )
}
