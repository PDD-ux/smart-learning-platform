const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ShanghaiDayRange = {
  date: string;
  start: Date;
  end: Date;
};

/** Return the current Asia/Shanghai calendar day as a half-open UTC range. */
export function shanghaiDayRange(now: Date = new Date()): ShanghaiDayRange {
  const shanghaiNow = new Date(now.getTime() + SHANGHAI_OFFSET_MS);
  const year = shanghaiNow.getUTCFullYear();
  const month = shanghaiNow.getUTCMonth();
  const day = shanghaiNow.getUTCDate();
  const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const start = new Date(Date.UTC(year, month, day) - SHANGHAI_OFFSET_MS);

  return { date, start, end: new Date(start.getTime() + DAY_MS) };
}
