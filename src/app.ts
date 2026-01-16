import Koa from 'koa';
import { koaBody } from 'koa-body';
import { router as keepImportRouter } from './routes/keep-import.routes';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const app = new Koa();
const PORT = Number(process.env.PORT) || 3000;

console.log('App initializing...');

app.use(koaBody({
  multipart: true,
  encoding: 'utf-8',
  formidable: {
    multiples: false,
    maxFileSize: 200 * 1024 * 1024,
    keepExtensions: true,
  },
}));

app.use(async (ctx, next) => {
  try {
    await next();
  } catch (err: any) {
    console.error('Server error:', err);
    ctx.status = err.status || 500;
    ctx.body = { error: err.message || 'Internal server error' };
  }
});

app.use(keepImportRouter.routes());
app.use(keepImportRouter.allowedMethods());

const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await prisma.$disconnect();
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
});

export { app, prisma };
