'use client';

import { useEffect, useState } from 'react';

function formatRemaining(ms: number) {
  if (ms <= 0) return 'due now';

  const totalMinutes = Math.ceil(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours && minutes) return `${hours}h ${minutes}m`;
  if (hours) return `${hours}h`;
  return `${minutes}m`;
}

export default function ScheduleTimer({ nextRunAt }: { nextRunAt: string | null }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(id);
  }, []);

  if (!nextRunAt) {
    return <span>Not scheduled yet</span>;
  }

  const nextTime = new Date(nextRunAt).getTime();
  const remaining = formatRemaining(nextTime - now);

  return <span>{remaining}</span>;
}
