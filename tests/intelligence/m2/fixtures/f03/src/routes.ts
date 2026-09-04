import express from 'express';
export function createApp(db: any) {
  const app = express();
  function searchRoute(req: any, res: any) {
    const term = req.query.q;
    const prefix = "SELECT id, name FROM records WHERE name = '";
    const statement = prefix + term + "'";
    const results = db.prepare(statement).all();
    return res.json(results);
  }
  app.get('/search', searchRoute);
  return app;
}
