import express from 'express';
export function createApp(db: any) {
  const app = express();
  function lookup(value: string) {
    return db.prepare('SELECT id, name FROM records WHERE name = ?').all(value);
  }
  function searchRoute(req: any, res: any) {
    return res.json(lookup(req.query.q));
  }
  app.get('/search', searchRoute);
  return app;
}
