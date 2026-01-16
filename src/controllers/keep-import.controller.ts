import { Context } from 'koa';
import { googleKeepService } from '../services/google-keep.service';
import { validateUserId, validateUploadedFile } from '../utils/validators';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';

export const importKeepNotes = async (ctx: Context): Promise<void> => {
  const userIdHeader = ctx.get('X-User-ID');
  const userValidation = validateUserId(userIdHeader);

  if (!userValidation.success) {
    ctx.status = 401;
    ctx.body = { error: 'Unauthorized: X-User-ID header required' };
    return;
  }

  const userId = userValidation.data;

  const files = ctx.request.files;
  let uploadedFile: any = null;

  if (files) {
    if ('takeout' in files) {
      const takeoutFile = files.takeout;
      uploadedFile = Array.isArray(takeoutFile) ? takeoutFile[0] : takeoutFile;
    }
  }

  if (!uploadedFile || !uploadedFile.filepath) {
    ctx.status = 400;
    ctx.body = { error: 'Missing takeout ZIP file. Use form field name: takeout' };
    return;
  }

  const fileValidation = validateUploadedFile({
    filepath: uploadedFile.filepath,
    originalFilename: uploadedFile.originalFilename || uploadedFile.newFilename || '',
    size: uploadedFile.size || 0,
  });

  if (!fileValidation.success) {
    ctx.status = 400;
    ctx.body = { error: fileValidation.error.errors[0]?.message || 'Invalid file' };
    await cleanupFile(uploadedFile.filepath);
    return;
  }

  let fileBuffer: Buffer;

  try {
    fileBuffer = await fsPromises.readFile(uploadedFile.filepath);
  } catch (err) {
    ctx.status = 500;
    ctx.body = { error: 'Failed to read uploaded file' };
    await cleanupFile(uploadedFile.filepath);
    return;
  }

  await cleanupFile(uploadedFile.filepath);

  try {
    const importedCount = await googleKeepService.parseAndSaveNotes(fileBuffer, userId);

    ctx.status = 200;
    ctx.body = {
      success: true,
      imported: importedCount,
      message: `Successfully imported ${importedCount} notes`,
    };
  } catch (err: any) {
    console.error('Import error:', err);
    ctx.status = 400;
    ctx.body = { error: err.message || 'Import failed' };
  }
};

async function cleanupFile(filepath: string): Promise<void> {
  try {
    if (fs.existsSync(filepath)) {
      await fsPromises.unlink(filepath);
    }
  } catch (err) {
    console.error('Cleanup error:', err);
  }
}
