import express from 'express';
import { lookup } from './service';
export function createApp(db: any) {
  const app = express();
  function searchRoute(req: any, res: any) {
    return res.json(lookup(db, req.query.q));
  }
  app.get('/search', searchRoute);
  return app;
}
