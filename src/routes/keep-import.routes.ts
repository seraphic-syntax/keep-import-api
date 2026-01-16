import Router from '@koa/router';
import { importKeepNotes } from '../controllers/keep-import.controller';

const router = new Router({ prefix: '/api' });

router.post('/keep-import', importKeepNotes);

router.get('/health', (ctx) => {
  ctx.body = { status: 'ok', timestamp: new Date().toISOString() };
});

export { router };
