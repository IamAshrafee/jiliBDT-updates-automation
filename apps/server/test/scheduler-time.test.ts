import { describe, expect, it } from 'vitest';
import { localParts } from '../src/scheduler/scheduler.js';

describe('scheduler timezone safety', () => {
  it('uses Asia/Dhaka date independently of the server UTC timezone', () => {
    expect(localParts('Asia/Dhaka', new Date('2026-08-24T17:59:59.000Z'))).toEqual({
      date: '2026-08-24',
      time: '23:59',
    });
    expect(localParts('Asia/Dhaka', new Date('2026-08-24T18:00:00.000Z'))).toEqual({
      date: '2026-08-25',
      time: '00:00',
    });
  });
});
