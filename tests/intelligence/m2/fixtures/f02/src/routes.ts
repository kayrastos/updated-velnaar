import express from 'express';
export function createApp(db: any) {
  const app = express();
  function searchRoute(req: any, res: any) {
    return res.json(db.prepare('SELECT id, name FROM records WHERE name = ?').all(req.query.q));
  }
  app.get('/search', searchRoute);
  return app;
}
