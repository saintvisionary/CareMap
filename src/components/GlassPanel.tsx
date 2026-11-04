import type { PropsWithChildren } from "react";

export function GlassPanel({ className = "", children }: PropsWithChildren<{ className?: string }>) {
  return (
    <div
      className={`rounded-glass border border-white/10 bg-white/5 backdrop-blur-glass shadow-xl shadow-black/40 ${className}`}
    >
      {children}
    </div>
  );
}
