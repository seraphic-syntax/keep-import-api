import AdmZip from 'adm-zip';
import * as cheerio from 'cheerio';

export interface ParsedNote {
  title: string;
  content: string;
  createdAt?: Date;
}

export function parseGoogleKeepTakeout(zipBuffer: Buffer): ParsedNote[] {
  const zip = new AdmZip(zipBuffer);
  const zipEntries = zip.getEntries();
  const parsedNotes: ParsedNote[] = [];

  for (const entry of zipEntries) {
    const entryName = entry.entryName;

    if (isKeepHtmlFile(entryName)) {
      try {
        const htmlContent = entry.getData().toString('utf-8');
        const note = parseKeepHtmlNote(htmlContent);

        if (note && note.content.trim().length > 0) {
          parsedNotes.push(note);
        }
      } catch (err) {
        console.warn(`Failed to parse entry: ${entryName}`, err);
      }
    }
  }

  return parsedNotes;
}

function isKeepHtmlFile(entryName: string): boolean {
  const lowerName = entryName.toLowerCase();
  return (
    lowerName.includes('keep') &&
    lowerName.endsWith('.html') &&
    !lowerName.includes('label')
  );
}

function parseKeepHtmlNote(html: string): ParsedNote | null {
  const $ = cheerio.load(html);

  const jsonLdScript = $('script[type="application/ld+json"]').html();

  if (jsonLdScript) {
    try {
      let jsonData = JSON.parse(jsonLdScript);

      if (Array.isArray(jsonData)) {
        jsonData = jsonData[0];
      }

      if (jsonData) {
        return extractNoteFromJsonLd(jsonData);
      }
    } catch (err) {
      console.warn('JSON-LD parse failed, falling back to HTML parse');
    }
  }

  return extractNoteFromHtml($);
}

function extractNoteFromJsonLd(data: any): ParsedNote | null {
  const title = data.name || data.headline || '';
  let content = '';

  if (data.itemListElement && Array.isArray(data.itemListElement)) {
    const checklistItems: string[] = [];

    for (const item of data.itemListElement) {
      const itemText = item.text || item.name || '';
      const isChecked = item.checked === true;
      const checkbox = isChecked ? '☑' : '☐';
      checklistItems.push(`${checkbox} ${itemText}`);
    }

    content = checklistItems.join('\n');
  } else {
    content = data.text || data.description || '';
  }

  if (!content || content.trim().length === 0) {
    return null;
  }

  let createdAt: Date | undefined;

  if (data.dateCreated) {
    const parsed = new Date(data.dateCreated);
    if (!isNaN(parsed.getTime())) {
      createdAt = parsed;
    }
  } else if (data.dateModified) {
    const parsed = new Date(data.dateModified);
    if (!isNaN(parsed.getTime())) {
      createdAt = parsed;
    }
  }

  return {
    title: title.trim(),
    content: content.trim(),
    createdAt,
  };
}

function extractNoteFromHtml($: cheerio.CheerioAPI): ParsedNote | null {
  const title = $('title').text() || $('.title').text() || '';

  let content = '';

  const contentDiv = $('.content');
  if (contentDiv.length > 0) {
    content = contentDiv.text();
  } else {
    content = $('body').text();
  }

  content = content.replace(/\s+/g, ' ').trim();

  if (!content || content.length === 0) {
    return null;
  }

  return {
    title: title.trim(),
    content: content.trim(),
    createdAt: undefined,
  };
}

export function formatNoteContent(content: string): string {
  return content
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
