export function queryRecords(db: any, value: string) {
  return db.prepare("SELECT id, name FROM records WHERE name = '" + value + "'").all();
}
