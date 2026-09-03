/**
 * @file src/utils/rfc3339Validator.ts
 * @description Strict RFC 3339 / ISO 8601 Calendar Timestamp Validator (Frontend Client-Side)
 */

export function isValidIsoWithTimezone(val: unknown): val is string {
  if (typeof val !== 'string') return false;

  // Strict regex matching YYYY-MM-DDTHH:mm:ss(.sss)?(Z|[+-]HH:mm|[+-]HHmm)
  const rfc3339Regex = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;
  const match = val.match(rfc3339Regex);
  if (!match) return false;

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  const hour = parseInt(match[4], 10);
  const minute = parseInt(match[5], 10);
  const second = parseInt(match[6], 10);
  const timezone = match[7];

  // Month check: 1 to 12
  if (month < 1 || month > 12) {
    return false;
  }

  // Leap year calculation
  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
  const daysInMonth = [0, 31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  // Day check
  if (day < 1 || day > daysInMonth[month]) {
    return false;
  }

  // Hour, minute, second check
  if (hour < 0 || hour > 23) {
    return false;
  }
  if (minute < 0 || minute > 59) {
    return false;
  }
  if (second < 0 || second > 59) {
    return false;
  }

  // Timezone check if numeric offset
  if (timezone !== 'Z') {
    const tzMatch = timezone.match(/^([+-])(\d{2}):?(\d{2})$/);
    if (!tzMatch) return false;
    const tzHour = parseInt(tzMatch[2], 10);
    const tzMinute = parseInt(tzMatch[3], 10);
    if (tzHour < 0 || tzHour > 23 || tzMinute < 0 || tzMinute > 59) {
      return false;
    }
  }

  // Verification against Date.parse
  const parsed = Date.parse(val);
  if (isNaN(parsed)) {
    return false;
  }

  return true;
}
