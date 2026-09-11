import type { Db } from '../db.js';
import { listAnalysts } from '../repo/analysts.js';
import { issueAccessToken } from '../repo/accessTokens.js';

export function provisionAuthFixtures(db: Db): (analystId: string) => Record<string, string> {
  const credentials = new Map(listAnalysts(db).map(({ id }) => [
    id,
    issueAccessToken(db, id, {
      now: new Date('2020-01-01T00:00:00.000Z'),
      expiresInMs: 20 * 365 * 24 * 60 * 60 * 1000,
    }).token,
  ]));
  return (analystId) => {
    const token = credentials.get(analystId);
    if (!token) throw new Error('No provisioned fixture credential for analyst.');
    return { Authorization: `Bearer ${token}`, 'x-analyst-id': analystId };
  };
}
