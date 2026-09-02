"use client";

import { useState } from "react";
import { Check, Eye, EyeOff, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Mirrors the rules the server enforces, so the requirement is visible while typing. */
export const PASSWORD_RULES = [
  { label: "At least 10 characters", test: (v: string) => v.length >= 10 },
  { label: "A letter", test: (v: string) => /[a-zA-Z]/.test(v) },
  { label: "A number", test: (v: string) => /[0-9]/.test(v) },
];

export const passwordIsValid = (v: string) => PASSWORD_RULES.every((r) => r.test(v));

export function PasswordField({
  id = "password",
  label = "Password",
  value,
  onChange,
  showRules = true,
  autoComplete = "new-password",
}: {
  id?: string;
  label?: string;
  value: string;
  onChange: (v: string) => void;
  showRules?: boolean;
  autoComplete?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="pr-10"
          required
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={visible ? "Hide password" : "Show password"}
          className="absolute top-0 right-0 h-full px-3 text-ink-3 hover:bg-transparent hover:text-ink"
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </Button>
      </div>
      {showRules && (
        <ul className="flex flex-col gap-1">
          {PASSWORD_RULES.map((r) => {
            const ok = r.test(value);
            return (
              <li key={r.label} className={cn("flex items-center gap-1.5 text-xs transition-colors duration-200", ok ? "text-good" : "text-ink-3")}>
                {ok ? <Check className="size-3" /> : <X className="size-3 opacity-50" />}
                {r.label}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
