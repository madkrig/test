import { adjustToWorkday, addWorkdays, type WorkdayCalendar } from './calendar';
import { DEFAULT_CONFIG, type BankConfirmationConfig } from './config';
import { addMonths, addWeeks, type IsoDate } from './dates';

export interface TimelineMilestone {
  /** Den oprindelige regel, fx "T-2 måneder". */
  rule: string;
  /** Datoen efter reglen, før arbejdsdagsjustering. */
  ruleDate: IsoDate;
  /** Den gældende arbejdsdag. */
  date: IsoDate;
  adjusted: boolean;
}

export interface BankConfirmationTimeline {
  activation: TimelineMilestone;
  populationDeadline: TimelineMilestone;
  authorizationDeadline: TimelineMilestone;
  sendDate: TimelineMilestone;
  /** Obligatorisk faglig eskalation, regnet fra revisors faglige deadline. */
  professionalEscalation: TimelineMilestone;
}

function milestone(rule: string, ruleDate: IsoDate, calendar: WorkdayCalendar, config: BankConfirmationConfig): TimelineMilestone {
  const date = adjustToWorkday(ruleDate, calendar, config.timeline.nonWorkdayPolicy);
  return { rule, ruleDate, date, adjusted: date !== ruleDate };
}

/**
 * Påmindelsesdatoer efter bankmetoden: bankens forventede svartid tælles i
 * arbejdsdage efter statusdato (se docs/antagelser.md #4). Påmindelse 2 følger
 * efter det konfigurerede interval.
 */
export function reminderSchedule(
  statusDate: IsoDate,
  expectedResponseWorkdays: number,
  calendar: WorkdayCalendar,
  config: BankConfirmationConfig = DEFAULT_CONFIG,
): IsoDate[] {
  const dates: IsoDate[] = [];
  let next = addWorkdays(statusDate, expectedResponseWorkdays, calendar);
  for (let i = 0; i < config.reminders.maxStandardReminders; i += 1) {
    dates.push(next);
    next = addWorkdays(next, config.reminders.intervalWorkdays, calendar);
  }
  return dates;
}

/**
 * Tidsstyret proces (brief afsnit 6). To tidsakser:
 * statusdato driver T-2/T-6/T-5/T-4; den faglige deadline driver T-10 arbejdsdage.
 */
export function computeTimeline(
  statusDate: IsoDate,
  professionalDeadline: IsoDate,
  calendar: WorkdayCalendar,
  config: BankConfirmationConfig = DEFAULT_CONFIG,
): BankConfirmationTimeline {
  const t = config.timeline;
  const escalationDate = addWorkdays(professionalDeadline, -t.escalationWorkdaysBeforeDeadline, calendar);
  return {
    activation: milestone(`T-${t.activationMonthsBefore} måneder`, addMonths(statusDate, -t.activationMonthsBefore), calendar, config),
    populationDeadline: milestone(`T-${t.populationDeadlineWeeksBefore} uger`, addWeeks(statusDate, -t.populationDeadlineWeeksBefore), calendar, config),
    authorizationDeadline: milestone(`T-${t.authorizationDeadlineWeeksBefore} uger`, addWeeks(statusDate, -t.authorizationDeadlineWeeksBefore), calendar, config),
    sendDate: milestone(`T-${t.sendWeeksBefore} uger`, addWeeks(statusDate, -t.sendWeeksBefore), calendar, config),
    professionalEscalation: {
      rule: `${t.escalationWorkdaysBeforeDeadline} arbejdsdage før faglig deadline`,
      ruleDate: escalationDate,
      date: escalationDate,
      adjusted: false,
    },
  };
}
