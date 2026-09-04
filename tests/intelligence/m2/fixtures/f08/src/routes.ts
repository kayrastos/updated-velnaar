import express from 'express';
export function createApp(db: any) {
  const app = express();
  const router = express.Router();
  function searchRoute(req: any, res: any) {
    return res.json(db.prepare("SELECT id, name FROM records WHERE name = '" + req.query.q + "'").all());
  }
  router.get('/search', searchRoute);
  app.use('/api', router);
  return app;
}
