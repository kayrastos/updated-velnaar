import { queryRecords } from './repository';
export function lookup(db: any, value: string) {
  return queryRecords(db, value);
}
