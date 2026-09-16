import { expect, it } from 'vitest';
import {
  readCampaignMoneyYearStates,
  YEAR_STATE_READS_AT_ONCE,
} from '../useCampaignMoneyYearStates';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it('reads a few years side by side and keeps the answers in year order', async () => {
  const years = [2015, 2016, 2017, 2018, 2019, 2020, 2021];
  const pending = new Map<number, ReturnType<typeof deferred<string>>>();
  let inFlight = 0;
  let mostInFlight = 0;
  const result = readCampaignMoneyYearStates(years, undefined, (year) => {
    inFlight += 1;
    mostInFlight = Math.max(mostInFlight, inFlight);
    const entry = deferred<string>();
    pending.set(year, entry);
    return entry.promise.finally(() => {
      inFlight -= 1;
    });
  });
  await Promise.resolve();
  expect(pending.size).toBe(YEAR_STATE_READS_AT_ONCE);
  // Answer out of order: the latest year first, then the rest as they were asked.
  pending.get(2017)!.resolve('state 2017');
  await Promise.resolve();
  await Promise.resolve();
  for (const year of years) pending.get(year)?.resolve(`state ${year}`);
  // Each answer frees a slot for the next year, so the remaining reads start now.
  while (pending.size < years.length) {
    await Promise.resolve();
    for (const year of years) pending.get(year)?.resolve(`state ${year}`);
  }
  expect(await result).toEqual(years.map((year) => `state ${year}`));
  expect(mostInFlight).toBe(YEAR_STATE_READS_AT_ONCE);
});

it('stops asking once the reader has moved on', async () => {
  const controller = new AbortController();
  const asked: number[] = [];
  const result = readCampaignMoneyYearStates(
    [2015, 2016, 2017, 2018],
    controller.signal,
    (year) => {
      asked.push(year);
      controller.abort(new Error('moved on'));
      return Promise.resolve(String(year));
    },
  );
  await expect(result).rejects.toThrow('moved on');
  expect(asked.length).toBeLessThanOrEqual(YEAR_STATE_READS_AT_ONCE);
});
