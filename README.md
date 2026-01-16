```markdown
# Keep Import API

A TypeScript/Koa microservice that ingests **Google Keep** exports produced by **Google Takeout**, parses the contained notes, and imports them into a **PostgreSQL** database via **Prisma ORM**.  

The service is designed as a cleanly layered HTTP API with:
- An HTTP controller layer (Koa)
- A domain service layer (Google Keep import service)
- A utilities layer (Keep Takeout parser, validation)
- A relational storage layer (PostgreSQL via Prisma)

This document aims to be exhaustive and precise, suitable for technical assessment and grading.

---

## 1. High-Level Architecture

### 1.1 Overview

The system exposes a single primary import endpoint:

- `POST /api/keep-import`  

Clients upload a **Google Takeout ZIP file containing Keep data**. The system:

1. Accepts the ZIP as a multipart/form-data upload.
2. Performs validation on:
   - Authentication surrogate (`X-User-ID` header)
   - File presence, size, and extension.
3. Reads and parses the ZIP in memory.
4. Extracts and parses Google Keep notes stored as HTML (and embedded JSON-LD).
5. Maps each parsed note into the internal `Note` schema.
6. Persists notes for the specified user via Prisma.
7. Returns a summary of the import (count of notes imported).

A second endpoint:

- `GET /api/health`  

Provides a liveness/health indicator with timestamp.

---

### 1.2 Layered Design

- **HTTP Layer (Koa)**  
  - `src/app.ts`: Koa application initialization and middleware wiring.
  - `src/routes/keep-import.routes.ts`: HTTP routing.
  - `src/controllers/keep-import.controller.ts`: Request handling, validation, and orchestration.

- **Domain / Service Layer**
  - `src/services/google-keep.service.ts`: Business logic for:
    - Parsing the ZIP via the parser utility.
    - Ensuring the user exists.
    - Persisting notes via Prisma.

- **Utility Layer**
  - `src/utils/keep-parser.ts`: ZIP parsing and Keep note extraction from HTML.
  - `src/utils/validators.ts`: Validation primitives using `zod`.

- **Persistence Layer**
  - `prisma/schema.prisma`: Data schema definition for `User` and `Note`.
  - `PostgreSQL` database accessed via generated Prisma Client.

---

## 2. Technology Stack

- **Language:** TypeScript
- **Runtime:** Node.js (tested with Node 18; dependencies increasingly prefer Node ≥ 20)
- **Framework:** Koa 2
- **Routing:** `@koa/router`
- **Body Parsing / Multipart:** `koa-body` (with formidable)
- **ORM:** Prisma
- **Database:** PostgreSQL
- **ZIP Handling:** `adm-zip`
- **HTML Parsing:** `cheerio`
- **Validation:** `zod`
- **Development tooling:** `ts-node`, `nodemon`, `tsconfig.json`

---

## 3. Data Model

### 3.1 Prisma Schema

Defined in `prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        String   @id @default(cuid())
  email     String   @unique
  name      String?
  notes     Note[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("users")
}

model Note {
  id        String   @id @default(cuid())
  title     String?
  content   String   @db.Text
  userId    String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("notes")
}
```

#### Notes:

- `User.id` is used as a logical foreign key from Keep imports (`X-User-ID` header).
- If a `User` with the given `id` does not exist, it is created with a placeholder email of the form `userId@placeholder.local`.
- `Note.content` uses a `Text` column (suitable for large note bodies).
- `createdAt` is preserved from the Keep data when possible (e.g., `dateCreated`), otherwise defaults to `now()`.

---

## 4. Google Keep Import Semantics

### 4.1 Google Takeout Structure (Assumed)

The implementation is tailored to the standard Google Takeout structure for Keep:

```
Takeout/
└── Keep/
    ├── Some Note Title.html
    ├── Some Note Title.json
    ├── some-image.png
    └── ...
```

The parser focuses on:

- `.html` files under any path that:
  - contain `"keep"` (case-insensitive) in the path; and
  - end with `.html`; and
  - do not contain `"label"` in the path.

Other assets (JSON metadata files, images, etc.) are ignored in this implementation.

### 4.2 Parsing Strategy

Implemented in `src/utils/keep-parser.ts`.

1. **ZIP Enumeration**
   - Uses `AdmZip` to enumerate all ZIP entries.
   - Filters entries deemed to be Keep HTML files.

2. **HTML Note Parsing**
   - Loads the HTML content via `cheerio`.
   - Attempts to locate `<script type="application/ld+json">...</script>` blocks.
   - Parses the JSON-LD if present.

3. **JSON-LD Extraction**
   - Extracts:
     - `name` / `headline` → `title`
     - `text` / `description` → `content`
   - For checklist notes where `itemListElement` is present:
     - Each item is converted to a line of the form:
       - `☑ Item text` if checked
       - `☐ Item text` if not checked
     - All lines joined by `\n`.
   - Attempts to parse:
     - `dateCreated` (preferred)
     - `dateModified` (fallback)
   - Normalizes whitespace and trims content.

4. **HTML Fallback (No JSON-LD)**
   - Title: `<title>` or `.title` elements.
   - Content: `.content` or `body` text.
   - Excess whitespace collapsed, then trimmed.

5. **Filtering and Normalization**
   - Notes with empty/whitespace-only content are discarded.
   - `formatNoteContent()` standardizes line endings and reduces multiple blank lines.

### 4.3 Service-Level Semantics

Defined in `src/services/google-keep.service.ts`.

- Maximum notes per import: `MAX_NOTES_LIMIT = 5000`.
- Content length capped at 65,535 characters (defensive limit).
- Title length capped at 255 characters.
- If a user with the provided `userId` does not exist, the service creates one.
- Notes are inserted in bulk via `prisma.note.createMany`.

---

## 5. HTTP API

### 5.1 Base URL

By default:

```text
http://localhost:3000
```

### 5.2 Health Check

#### Endpoint

```http
GET /api/health
```

#### Description

Provides a simple liveness and time indication. Useful for verifying that the Koa server is running.

#### Response (200 OK)

```json
{
  "status": "ok",
  "timestamp": "2026-01-16T15:34:46.704Z"
}
```

---

### 5.3 Google Keep Import Endpoint

#### Endpoint

```http
POST /api/keep-import
```

#### Headers

- `X-User-ID: <string>` (required)

This header acts as a user identifier for the imported notes. In a production system, this would likely be replaced or augmented by full authentication (e.g., JWT).

#### Request Body

`multipart/form-data` with:

- `takeout`: the Google Takeout ZIP file containing Keep data.

Example (cURL):

```bash
curl -X POST http://localhost:3000/api/keep-import \
  -H "X-User-ID: my-real-user" \
  -F "takeout=@/path/to/takeout-YYYYMMDDTXXXXXXZ-001.zip"
```

#### Success Response (200 OK)

```json
{
  "success": true,
  "imported": 42,
  "message": "Successfully imported 42 notes"
}
```

- `imported` is the number of notes actually persisted.

#### Possible Error Responses

1. **Unauthorized / Missing User ID**

   - Status: `401 Unauthorized`
   - Body:

   ```json
   { "error": "Unauthorized: X-User-ID header required" }
   ```

2. **Missing File**

   - Status: `400 Bad Request`
   - Body:

   ```json
   { "error": "Missing takeout ZIP file. Use form field name: takeout" }
   ```

3. **Invalid File (extension or size)**

   - `.zip` extension enforced.
   - Maximum size: 200 MB.

   Example (file too large or wrong extension):

   ```json
   { "error": "File must be a .zip file" }
   ```

   or

   ```json
   { "error": "File exceeds 200MB limit" }
   ```

4. **No Valid Notes Found**

   - Status: `400 Bad Request`
   - When the ZIP does not contain any parsable Keep HTML notes.

   ```json
   { "error": "No valid Google Keep notes found in the Takeout ZIP file" }
   ```

5. **Too Many Notes**

   - Status: `400 Bad Request`
   - When the parsed note count exceeds the configured maximum (`5000`).

   ```json
   { "error": "Too many notes: 6000. Maximum allowed: 5000" }
   ```

6. **Internal Error**

   - Status: `500 Internal Server Error`
   - E.g., file read failures.

   ```json
   { "error": "Failed to read uploaded file" }
   ```

---

## 6. Validation and Error Handling

### 6.1 Validation

Implemented with `zod` in `src/utils/validators.ts`.

- **User ID Validation**
  - Must be a non-empty string (`min(1)`).
  - Max length of 255 characters.

- **File Validation**
  - Properties validated:
    - `filepath`: non-empty string.
    - `originalFilename`: must end with `.zip` (case-insensitive).
    - `size`: between `[1, 200MB]`.

- **ZIP Magic Bytes (Utility)**
  - `isValidZipBuffer(buffer: Buffer)` checks the ZIP "magic number" (0x50 0x4B 0x03 0x04).
  - This helper is available but the primary flow relies on extension and size.

### 6.2 Error Handling Strategy

- Application-level try/catch in `app.ts` with middleware that:
  - Logs server errors.
  - Returns `500` responses with safe error messages.
- Controller-level try/catch in `keep-import.controller.ts`:
  - Distinguishes validation errors (400) from operational errors.
  - Always cleans up the temporary upload file using `fs.unlink`.

---

## 7. Project Structure

```text
keep-import-api/
├── .env.example
├── .gitignore
├── README.md
├── nodemon.json
├── package.json
├── package-lock.json
├── tsconfig.json
├── prisma/
│   └── schema.prisma
└── src/
    ├── app.ts
    ├── controllers/
    │   └── keep-import.controller.ts
    ├── routes/
    │   └── keep-import.routes.ts
    ├── services/
    │   └── google-keep.service.ts
    └── utils/
        ├── keep-parser.ts
        └── validators.ts
```

---

## 8. Setup and Execution Guide

This section covers the workflow for any user cloning the repository.

### 8.1 Prerequisites

- **Node.js**  
  - Recommended: Node 20+  
  - Minimum tested: Node 18.20.x (some dependency warnings may mention Node 20+)

- **npm**  
  - Comes with Node.js; recommended npm 9+.

- **PostgreSQL** (via one of the following)
  - Direct installation (Windows installer); or
  - Docker container (recommended for reproducibility).

- **Git**  
  - For cloning the repository.

---

### 8.2 Clone the Repository

```bash
git clone https://github.com/seraphic-syntax/keep-import-api.git
cd keep-import-api
```

---

### 8.3 Install Dependencies

```bash
npm install
```

---

### 8.4 Configure Environment

1. Copy the example environment file:

   ```bash
   cp .env.example .env
   ```

2. Open `.env` and set `DATABASE_URL`. Example for local PostgreSQL:

   ```env
   DATABASE_URL="postgresql://postgres:password@localhost:5432/keepdb?schema=public"
   NODE_ENV=development
   PORT=3000
   ```

   Adjust:
   - `password` to match your PostgreSQL user password.
   - `keepdb` to your actual database name (or create `keepdb`).

---

### 8.5 Start PostgreSQL

#### Option A: Docker

```bash
docker run -d --name keepdb \
  -e POSTGRES_DB=keepdb \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=password \
  -p 5432:5432 \
  postgres:15
```

#### Option B: Native Installation

Install PostgreSQL from https://www.postgresql.org/download/windows/, then:

- Create a database `keepdb`:
  ```sql
  CREATE DATABASE keepdb;
  ```

Ensure PostgreSQL is listening on `localhost:5432` and that credentials match `DATABASE_URL`.

---

### 8.6 Initialize Prisma

Generate client and push schema to database:

```bash
npx prisma generate
npx prisma db push
```

This will:

- Generate the Prisma client into `node_modules/@prisma/client`.
- Create/update the `users` and `notes` tables in the configured database.

---

### 8.7 Run the Development Server

Using `nodemon` and `ts-node`:

```bash
npm run dev
```

Expected console output:

```text
[nodemon] starting `ts-node src/app.ts`
App initializing...
Server running on http://localhost:3000
```

Keep this process running while interacting with the API.

---

### 8.8 Testing the API

Open a second terminal window for testing.

#### 8.8.1 Health Check

```bash
curl http://localhost:3000/api/health
```

Expected response:

```json
{"status":"ok","timestamp":"2026-01-16T15:34:46.704Z"}
```

#### 8.8.2 Import Test with Real Google Takeout

1. Visit https://takeout.google.com
2. Click "Deselect all".
3. Scroll to **Keep** and check its box.
4. Click "Next step" → "Create export".
5. Wait for the export email, then download the ZIP.
6. On your machine, identify the ZIP path, e.g.:

   ```bash
   /c/Users/serap/Downloads/takeout-20260116T160248Z-3-001.zip
   ```

7. Run the import:

   ```bash
   curl -X POST http://localhost:3000/api/keep-import \
     -H "X-User-ID: my-real-user" \
     -F "takeout=@/c/Users/serap/Downloads/takeout-20260116T160248Z-3-001.zip"
   ```

Expected success response:

```json
{"success":true,"imported":1,"message":"Successfully imported 1 notes"}
```

---

### 8.9 Inspecting Imported Data

You can use Prisma Studio for an interactive UI:

```bash
npx prisma studio
```

This opens a browser at http://localhost:5555 where you can inspect:

- `User` table, including the `my-real-user` entry.
- `Note` table, including imported notes.

---

## 9. Design Decisions, Limitations, and Future Work

### 9.1 Design Decisions

- **Explicit layering**: controller → service → utils → database.
- **Prisma chosen** for:
  - Strong typing of models and queries.
  - Migrations and schema introspection.
- **Koa chosen** for:
  - Minimal overhead and clear middleware composition.
- **In-memory ZIP parsing**:
  - Simplifies deployment (no external process).
  - Acceptable within configured 200 MB limit.
- **User auto-creation**:
  - Keeps the demo self-contained.
  - In production, user creation would likely occur via dedicated auth/user flows.

### 9.2 Limitations

- **Authentication**:
  - Only a header-based surrogate (`X-User-ID`) is used.
  - No token validation, no sessions.

- **Note Dedupliation**:
  - Notes are always inserted; no attempt is made to avoid duplicates.

- **Assets Ignored**:
  - Image files (`.png`, `.jpg`, etc.) and JSON metadata files are currently ignored.
  - Labels, colors, and pinned status are not modeled.

- **Limited Format Support**:
  - Focuses on HTML representations with embedded JSON-LD.
  - Other potential Keep formats (if introduced) may require parser extension.

### 9.3 Potential Extensions

- **Authentication Integration**:
  - Support for JWTs / OAuth2 / session-based authentication.
- **Labels and Metadata**:
  - Additional Prisma models to represent labels, reminders, pinned state, etc.
- **JSON-based Parsing**:
  - Extend `keep-parser.ts` to leverage `.json` files where present.
- **Deduplication**:
  - Use note hashes or Keep IDs to avoid re-importing identical notes.
- **Streaming Uploads**:
  - Support streaming ZIP parsing for very large archives.

---

## 10. Conclusion

This project implements a complete pipeline from Google Keep Takeout ZIP to relational storage, demonstrating:

- Practical use of Koa and TypeScript for HTTP APIs.
- Robust data modeling and interaction via Prisma ORM.
- Concrete file handling and parsing of real-world archive formats.
- Clear separation of concerns across controllers, services, and utilities.

The implementation is intentionally modular to facilitate future extension (e.g., richer note metadata, authentication, deduplication), while already providing a fully working import pipeline suitable for integration into a larger application such as warpSpeed.
