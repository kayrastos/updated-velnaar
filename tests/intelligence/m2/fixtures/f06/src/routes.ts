import express from 'express';
export function createApp(db: any) {
  const app = express();
  function buildQuery(value: string) {
    return "SELECT id, name FROM records WHERE name = '" + value + "'";
  }
  function lookup(value: string) {
    return db.prepare(buildQuery(value)).all();
  }
  function searchRoute(req: any, res: any) {
    return res.json(lookup(req.query.q));
  }
  app.get('/search', searchRoute);
  return app;
}
