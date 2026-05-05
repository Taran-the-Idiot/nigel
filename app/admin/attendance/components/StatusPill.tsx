'use client';

import { AttendanceStatus, statusBg, STATUS_LABEL } from '../lib/types';

export function StatusPill({ status, size = 'sm' }: Readonly<{ status: AttendanceStatus; size?: 'sm' | 'md' }>) {
  const cls = statusBg(status);
  const sizeCls = size === 'md' ? 'text-xs px-2.5 py-1' : 'text-[10px] px-2 py-0.5';
  return (
    <span className={`inline-flex items-center font-mono uppercase tracking-wider border ${sizeCls} ${cls}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function FlagPill({ label, tone = 'neutral' }: Readonly<{ label: string; tone?: 'neutral' | 'positive' | 'caution' | 'snooze' }>) {
  const cls =
    tone === 'positive' ? 'bg-green-500/10 border-green-500/40 text-green-500'
    : tone === 'caution' ? 'bg-orange-500/10 border-orange-500/40 text-orange-400'
    : tone === 'snooze' ? 'bg-blue-500/10 border-blue-500/40 text-blue-400'
    : 'bg-cream-50/5 border-cream-200/30 text-cream-200';
  return (
    <span className={`inline-flex items-center font-mono uppercase tracking-wider text-[10px] px-2 py-0.5 border ${cls}`}>
      {label}
    </span>
  );
}
