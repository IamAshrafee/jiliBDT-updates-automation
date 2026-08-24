import { statfs } from 'node:fs/promises';

export interface DiskHealth {
  status: 'OK' | 'WARNING' | 'CRITICAL';
  freeBytes: number;
  freeMb: number;
  message: string;
}

export async function checkDiskHealth(
  path: string,
  thresholds: { warningFreeMb: number; criticalFreeMb: number },
): Promise<DiskHealth> {
  const stats = await statfs(path);
  const freeBytes = Number(stats.bavail) * Number(stats.bsize);
  const freeMb = Math.floor(freeBytes / 1024 / 1024);
  const status =
    freeMb <= thresholds.criticalFreeMb
      ? 'CRITICAL'
      : freeMb <= thresholds.warningFreeMb
        ? 'WARNING'
        : 'OK';
  return {
    status,
    freeBytes,
    freeMb,
    message:
      status === 'OK'
        ? 'Disk space is healthy.'
        : status === 'WARNING'
          ? 'Disk space is running low.'
          : 'Disk space is critically low. New artifacts and external sends are blocked.',
  };
}
