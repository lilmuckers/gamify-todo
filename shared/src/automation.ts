import type { Automation, PushDevice } from './model';

/** data/automation.json without its `$schema`, as the workspace holds it. */
export type AutomationConfig = Omit<Automation, '$schema'>;
export type AutomationChannel = NonNullable<Automation['channel']>;
export type ScheduleEvery = NonNullable<NonNullable<Automation['schedule']>['every']>;
export type DeviceEvents = Required<NonNullable<PushDevice['events']>>;

export const SCHEDULE_EVERY: ScheduleEvery[] = ['6h', '3h', '1h', 'off'];

/** What a missing file, block or key means: validation on, everything else off. */
export const AUTOMATION_DEFAULTS = {
  channel: 'stable' as AutomationChannel,
  every: '3h' as ScheduleEvery,
  validate: { enabled: true, comment: true },
  notifyEnabled: false,
};

/** A device's notification switches with defaults filled in. */
export function deviceEvents(device: Pick<PushDevice, 'events'>): DeviceEvents {
  return { timebox: true, review: 'fri', warpZone: true, ...device.events };
}

/**
 * Whether any device wants a notification that only a scheduled run can send (time-box
 * or review). Without one the workflow has no `schedule:` and costs no Actions minutes.
 */
export function hasScheduledEvent(automation: AutomationConfig | undefined): boolean {
  if (!automation?.notify?.enabled) return false;
  return (automation.notify.devices ?? []).some((d) => {
    const e = deviceEvents(d);
    return e.timebox || e.review !== 'off';
  });
}
