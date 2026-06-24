import { supabase }   from '../supabaseClient.js';
import { logger }     from '../utils/logger.js';
import { DateTime }   from 'luxon';
import CronParser     from 'cron-parser';

const SCHEDULER_INTERVAL_MS = 60 * 1000; // 1 minute

// US equity market hours (Eastern Time)
const MARKET_START = { hour: 9,  minute: 30 };
const MARKET_END   = { hour: 16, minute: 0  };

function isDuringMarketHours(isoString) {
  const et = DateTime.fromISO(isoString, { zone: 'America/New_York' });
  if (et.weekday > 5) return false; // weekend
  const mins = et.hour * 60 + et.minute;
  return mins >= MARKET_START.hour * 60 + MARKET_START.minute
      && mins <  MARKET_END.hour   * 60 + MARKET_END.minute;
}

/**
 * Compute when a schedule should next fire, given its current state.
 * Returns an ISO string in UTC, or null if the schedule is misconfigured.
 */
export function computeNextRunAt(schedule) {
  const tz  = schedule.timezone ?? 'America/New_York';
  const now  = DateTime.now().setZone(tz);

  // ── Cron schedule ───────────────────────────────────────────
  if (schedule.schedule_type === 'cron') {
    if (!schedule.cron_expression) return null;
    try {
      const interval = CronParser.parseExpression(schedule.cron_expression, {
        currentDate: now.toJSDate(),
        utc: false,
      });
      return DateTime.fromJSDate(interval.next().toDate()).toUTC().toISO();
    } catch {
      logger.warn(`Scheduler: invalid cron expression "${schedule.cron_expression}"`);
      return null;
    }
  }

  // ── Preset schedule ─────────────────────────────────────────
  const hour   = schedule.hour_of_day    ?? 2;
  const minute = schedule.minute_of_hour ?? 0;

  switch (schedule.recurrence) {
    case 'daily': {
      let next = now.set({ hour, minute, second: 0, millisecond: 0 });
      if (next <= now) next = next.plus({ days: 1 });
      return next.toUTC().toISO();
    }

    case 'weekly': {
      // day_of_week: 0=Sun…6=Sat → Luxon weekday: 1=Mon…7=Sun
      const dow = schedule.day_of_week ?? 1;
      const luxonWeekday = dow === 0 ? 7 : dow;
      let next = now.set({ weekday: luxonWeekday, hour, minute, second: 0, millisecond: 0 });
      if (next <= now) next = next.plus({ weeks: 1 });
      return next.toUTC().toISO();
    }

    case 'monthly': {
      const dom = schedule.day_of_month ?? 1;
      let next = now.set({ day: dom, hour, minute, second: 0, millisecond: 0 });
      if (next <= now) next = next.plus({ months: 1 });
      return next.toUTC().toISO();
    }

    case 'quarterly': {
      const dom = schedule.day_of_month ?? 1;
      const quarterMonths = [1, 4, 7, 10];

      // Build all quarterly candidate dates for this year and next year
      const candidates = [];
      for (const yearAdd of [0, 1]) {
        for (const month of quarterMonths) {
          candidates.push(
            DateTime.fromObject(
              { year: now.year + yearAdd, month, day: dom, hour, minute, second: 0, millisecond: 0 },
              { zone: tz }
            )
          );
        }
      }
      const next = candidates.find(c => c > now) ?? candidates[candidates.length - 1];
      return next.toUTC().toISO();
    }

    default:
      return null;
  }
}

async function checkSchedules() {
  const now = new Date().toISOString();

  const { data: schedules, error } = await supabase
    .from('job_schedules')
    .select(`
      *,
      definition:job_definitions(id, job_type, config, is_active)
    `)
    .eq('is_active', true)
    .not('next_run_at', 'is', null)
    .lte('next_run_at', now);

  if (error) {
    logger.error(`Scheduler: failed to fetch schedules — ${error.message}`);
    return;
  }

  for (const sched of (schedules ?? [])) {
    if (!sched.definition?.is_active) {
      logger.debug(`Scheduler: skipping schedule ${sched.id} — definition is inactive`);
      continue;
    }

    // Warn (don't block) if this fires during market hours
    if (isDuringMarketHours(sched.next_run_at)) {
      const etTime = DateTime.fromISO(sched.next_run_at)
        .setZone('America/New_York')
        .toFormat('h:mm a ZZZZ');
      logger.warn(
        `Scheduler: schedule ${sched.id} fires at ${etTime}, within US market hours `
        + '(9:30am–4:00pm ET) — consider scheduling outside market hours to reduce SEC load'
      );
    }

    // Enqueue the run
    const { error: insertErr } = await supabase
      .from('job_runs')
      .insert({
        job_definition_id: sched.job_definition_id,
        schedule_id:       sched.id,
        status:            'queued',
        trigger_source:    'scheduled',
        config_snapshot:   sched.definition.config ?? {},
      });

    if (insertErr) {
      logger.error(
        `Scheduler: failed to enqueue for schedule ${sched.id} — ${insertErr.message}`
      );
      continue;
    }

    // Advance next_run_at
    const nextRunAt = computeNextRunAt(sched);
    await supabase
      .from('job_schedules')
      .update({ last_enqueued_at: now, next_run_at: nextRunAt })
      .eq('id', sched.id);

    logger.info(
      `Scheduler: enqueued ${sched.definition.job_type} (schedule ${sched.id})`
      + (nextRunAt ? `, next run at ${nextRunAt}` : '')
    );
  }
}

/** Long-running mode: check immediately then every 60s forever. */
export function runScheduler() {
  logger.info('Scheduler: started — checking every 60s');
  checkSchedules().catch(err => logger.error(`Scheduler: ${err.message}`));
  setInterval(
    () => checkSchedules().catch(err => logger.error(`Scheduler: ${err.message}`)),
    SCHEDULER_INTERVAL_MS
  );
}

/** Once mode: run a single scheduler pass and return. */
export async function runSchedulerOnce() {
  logger.info('Scheduler: running one-pass check for due schedules');
  await checkSchedules();
}
