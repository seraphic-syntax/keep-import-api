import { z } from 'zod';

const userIdSchema = z.string().min(1, 'User ID is required').max(255, 'User ID too long');

const fileSchema = z.object({
  filepath: z.string().min(1, 'File path required'),
  originalFilename: z.string().refine(
    (name) => name.toLowerCase().endsWith('.zip'),
    { message: 'File must be a .zip file' }
  ),
  size: z
    .number()
    .min(1, 'File is empty')
    .max(200 * 1024 * 1024, 'File exceeds 200MB limit'),
});

export function validateUserId(userId: unknown): z.SafeParseReturnType<string, string> {
  return userIdSchema.safeParse(userId);
}

export function validateUploadedFile(file: {
  filepath: string;
  originalFilename: string;
  size: number;
}): z.SafeParseReturnType<typeof file, typeof file> {
  return fileSchema.safeParse(file);
}

export function isValidZipBuffer(buffer: Buffer): boolean {
  if (buffer.length < 4) {
    return false;
  }
  return buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
}
