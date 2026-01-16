import { PrismaClient } from '@prisma/client';
import { parseGoogleKeepTakeout, ParsedNote } from '../utils/keep-parser';

const prisma = new PrismaClient();
const MAX_NOTES_LIMIT = 5000;
const MAX_CONTENT_LENGTH = 65535;

export interface ImportResult {
  count: number;
}

async function parseAndSaveNotes(zipBuffer: Buffer, userId: string): Promise<number> {
  const userExists = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!userExists) {
    await prisma.user.create({
      data: {
        id: userId,
        email: `${userId}@placeholder.local`,
        name: 'Imported User',
      },
    });
  }

  const parsedNotes = parseGoogleKeepTakeout(zipBuffer);

  if (parsedNotes.length === 0) {
    throw new Error('No valid Google Keep notes found in the Takeout ZIP file');
  }

  if (parsedNotes.length > MAX_NOTES_LIMIT) {
    throw new Error(`Too many notes: ${parsedNotes.length}. Maximum allowed: ${MAX_NOTES_LIMIT}`);
  }

  const notesToCreate = parsedNotes.map((note: ParsedNote) => ({
    title: note.title ? note.title.substring(0, 255) : 'Imported Keep Note',
    content: note.content.substring(0, MAX_CONTENT_LENGTH),
    userId: userId,
    createdAt: note.createdAt || new Date(),
  }));

  const result = await prisma.note.createMany({
    data: notesToCreate,
    skipDuplicates: false,
  });

  return result.count;
}

export const googleKeepService = {
  parseAndSaveNotes,
};
