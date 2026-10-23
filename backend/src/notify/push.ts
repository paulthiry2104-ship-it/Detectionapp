import { loadConfig } from '../config.ts';
import { type Db, j, nowIso } from '../db/db.ts';
import { fetchJson } from '../providers/http.ts';

export type PushMsg = { title: string; body: string; data?: Record<string, unknown> };

/** Envoie via le service Expo Push (gratuit). Renvoie le nombre de messages acceptés. */
export async function sendPush(db: Db, msgs: PushMsg[]): Promise<{ sent: number; errors: string[] }> {
  const devices = db.all<{ expo_token: string }>('SELECT expo_token FROM push_devices WHERE active = 1');
  if (!devices.length || !msgs.length) return { sent: 0, errors: devices.length ? [] : ['Aucun appareil enregistré'] };
  const token = loadConfig().EXPO_ACCESS_TOKEN;
  const payload = devices.flatMap((d) => msgs.map((m) => ({ to: d.expo_token, title: m.title, body: m.body, data: m.data ?? {}, sound: 'default', priority: 'high' })));
  const errors: string[] = [];
  let sent = 0;
  for (let i = 0; i < payload.length; i += 100) {
    const chunk = payload.slice(i, i + 100);
    try {
      const res = await fetchJson<any>('expo', 'https://exp.host/--/api/v2/push/send', {
        method: 'POST', body: chunk, headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      (res?.data ?? []).forEach((t: any, k: number) => {
        if (t.status === 'ok') sent++;
        else {
          errors.push(t.message ?? 'erreur');
          if (t.details?.error === 'DeviceNotRegistered') db.run('UPDATE push_devices SET active = 0 WHERE expo_token = ?', chunk[k].to);
        }
      });
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  return { sent, errors };
}

export function registerDevice(db: Db, expoToken: string, platform: string | null) {
  db.run(
    `INSERT INTO push_devices(expo_token,platform,created_at,last_seen_at,active) VALUES(?,?,?,?,1)
     ON CONFLICT(expo_token) DO UPDATE SET last_seen_at = excluded.last_seen_at, active = 1`,
    expoToken, platform, nowIso(), nowIso(),
  );
}

export const _j = j;
