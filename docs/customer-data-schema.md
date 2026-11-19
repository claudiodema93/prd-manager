# Customer data schema (v1)

This document is the contract for the customer-management feature: the on-disk
customer definition, the article folders that belong to it, the key-template
grammar, and the scan/CRUD semantics that keep the SQLite cache in sync.

## Overview

The **filesystem is the source of truth**. A customer is a directory named
`customer-XXXX` inside the configured `articlesDirectory`; its definition lives
in `customer_data.json`, and its articles are direct subfolders containing a
minimal `article_data.json`.

SQLite (`cache.db`) is a **disposable cache**. The `customers` table is rebuilt
from the filesystem by scans, and `metadata_json` stores the parsed customer
definition plus the article count and any issues found. There is no dedicated
customer table and no schema migration: the existing `metadata_json` column was
reused for this purpose. Deleting `cache.db` loses no customer data.

Renderer access is through the `customers` oRPC namespace only; the renderer
never reads or writes these files directly.

## Folder layout and naming

```
<articlesDirectory>/
├── customer-0001/
│   ├── customer_data.json
│   ├── article-example-1/
│   │   └── article_data.json
│   └── article-example-2_EVO01/
│       └── article_data.json
└── customer-0002/
    ├── customer_data.json
    └── ...
```

| Rule | Detail |
| --- | --- |
| Customer folder name | `customer-XXXX`, where `XXXX` is a 4-digit code from `0001` to `9999`. |
| Code immutability | A customer's code never changes; the folder name is derived from it (`customerFolderNameForCode`). `customer-0000` is invalid. |
| Folder matching | Only names matching `^customer-\d{4}$` (and not `0000`) are customers. Other names beginning with `customer-` are reported as warnings and ignored. |
| Config file | `customer_data.json` directly inside the customer folder, at most 256 KiB. |
| Article folders | Direct subfolders of the customer folder, each containing `article_data.json` at most 64 KiB. Dot entries and plain files are ignored. |
| Article naming | When an article is created, its folder name is the rendered `article.key`. The scanner counts a folder by the validity of its `article_data.json`, not by comparing its name to the key. |

`articlesDirectory` is the scan root and the only place CRUD may create or
modify customers. `trashDirectory` is the mandatory destination for deletes.
`issuesDirectory` is stored and validated by the preferences layer but is not
consumed by the customer scanner or CRUD service.

### What counts as a valid article

`article_data.json` counts toward `articleCount` when it is a plain JSON object
with:

| Field | Requirement |
| --- | --- |
| `schemaVersion` | Integer `>= 1`. |
| `customer` | Number, or numeric string, equal to the folder's customer code (`1` and `"0001"` both match `customer-0001`). |

Additional keys are allowed and ignored. A missing file, invalid JSON, a
symlink, an oversized file, or a value failing the rules above produces an
`ARTICLE_INVALID` warning; that folder is **not** counted. Symlinked article
folders produce `ARTICLE_SYMLINK` and are ignored.

At most 100 issues are kept per customer and 200 per scan. The last slot of
each list is reserved for a truncation warning: the per-customer note uses
`ARTICLE_INVALID`, the scan-level note reuses `ENTRY_UNEXPECTED`. Issues are
capped while they are collected, so an oversized list is never materialised in
full.

## `customer_data.json` v1

The clean v1 shape stores `schemaVersion` on the root and on both sections:

```json
{
  "schemaVersion": 1,
  "customerName": "NOME_CLIENTE",
  "article": {
    "schemaVersion": 1,
    "parameters": {
      "CODE": {
        "required": true,
        "type": "text"
      },
      "EVO": {
        "required": true,
        "type": "number",
        "default": "0"
      }
    },
    "key": "{CODE}[_EVO{EVO:00}]"
  },
  "revision": {
    "schemaVersion": 1,
    "parameters": {
      "REV": {
        "required": true,
        "type": "number",
        "default": "0"
      },
      "MATERIAL": {
        "required": false,
        "type": "text"
      },
      "SURFACE_TREATMENT": {
        "required": false,
        "type": "text"
      },
      "DESCRIPTION": {
        "required": false,
        "type": "text"
      },
      "WEIGHT": {
        "required": false,
        "type": "text"
      },
      "MACHINE": {
        "required": false,
        "type": "text"
      }
    },
    "key": "REV_{REV}"
  }
}
```

| Field | Type | Rules |
| --- | --- | --- |
| `schemaVersion` (root) | integer | Must be `1`. Any other integer is `CONFIG_UNSUPPORTED_VERSION`. |
| `customerName` | string | Trimmed, 1–256 characters. |
| `article`, `revision` | object | Both required; strict shape (`schemaVersion`, `key`, `parameters`). |
| `.schemaVersion` | integer | Must be `1`. |
| `.key` | string | Key template, 1–512 characters. |
| `.parameters` | object | 1–64 definitions, see below. |

The object is strict: unknown keys are rejected. Legacy files may instead carry
top-level `articleSchemaVersion` / `revisionSchemaVersion`; these are accepted
on read and fill in a missing nested `schemaVersion`. If a nested and a legacy
version are both present and differ, the file is rejected with
`CONFIG_VERSION_CONFLICT`. The clean shape above is what is written back.

### Parameter definitions

```json
{
  "CODE": { "required": true, "type": "text" },
  "EVO": { "required": true, "type": "number", "default": "0" }
}
```

| Property | Type | Rules |
| --- | --- | --- |
| Key (parameter name) | string | `^[A-Z][A-Z0-9_]{0,63}$` — uppercase letter, then uppercase letters, digits or underscores; 1–64 characters. |
| `type` | string | `text`, `number` or `bool`. |
| `required` | boolean | Required. A required parameter cannot render blank. |
| `default` | string, optional | At most 256 characters. `number` defaults must match `^\d+$`; `bool` defaults must be `true`, `false`, `1` or `0` (case-insensitive). Numeric defaults are stored as strings. |

## Key-template grammar

The `key` of each section is a template rendered with parameter values to
produce a file-name-safe key.

| Syntax | Meaning |
| --- | --- |
| literal text | Copied verbatim. Control characters and `/\:?*"<>\|` are not allowed. |
| `{NAME}` | Inserts the value of the declared parameter `NAME`. |
| `{NAME:00}` | Inserts a `number` parameter zero-padded to the number of zeros (`:00` = width 2, `:0000` = width 4). Only `number` parameters may use padding. |
| `[...]` | Optional group. It is omitted when **every** parameter referenced inside is insignificant: empty text, number `0`, or boolean `false`. Otherwise the whole group is rendered. |

Grammar rules:

- The template must contain at least one placeholder; placeholders must
  reference declared parameters.
- Optional groups cannot nest, must contain at least one placeholder, and
  cannot be empty.
- Literal `[`, `]`, `{` and `}` outside their constructs are errors.
- The template may not exceed 512 characters.
- `revision.key` must also be matchable against folder names: at most 8
  placeholders, at most 4 optional groups, at most 32 tokens, and never two
  placeholders adjacent in either the expanded or the collapsed form of the
  optional groups. `parseCustomerConfig` enforces these limits, so a
  configuration the app accepts can never make every article of that customer
  uncacheable at scan time. The limits do not apply to `article.key`, which is
  rendered from values and never matched.

### Rendering rules

| Parameter type | Accepted value | Significance | Output |
| --- | --- | --- | --- |
| `text` | string | Non-empty after trimming | Trimmed text, at most 256 characters. |
| `number` | non-negative integer, or digit string | Value is not `0` | Canonical decimal (leading zeros removed), then padded if requested. |
| `bool` | boolean, or `"true"`/`"false"`/`"1"`/`"0"` (case-insensitive) | `true` | `"true"` or `"false"`. |

Missing values (`undefined`/`null`) fall back to `default`. A blank value on a
`required` parameter is an error. A blank value on an optional parameter renders
as `""`, `0` or `false`, which is insignificant.

The rendered key must be a safe file name:

- non-empty and at most 255 UTF-8 bytes;
- not `.` or `..`, and not ending in a space or dot;
- no control characters, path separators (`/`, `\`), or reserved characters
  `: * ? " < > |`;
- not a Windows reserved device name (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`,
  `LPT1`–`LPT9`, case-insensitive, checked on the part before the first dot).

### Official examples

| Section | Template | Values | Rendered key |
| --- | --- | --- | --- |
| `article` | `{CODE}[_EVO{EVO:00}]` | `CODE = "article-example-1"`, `EVO = 0` | `article-example-1` (optional group omitted because `EVO` is `0`) |
| `article` | `{CODE}[_EVO{EVO:00}]` | `CODE = "article-example-2"`, `EVO = 1` | `article-example-2_EVO01` |
| `revision` | `REV_{REV}` | `REV = 0` | `REV_0` |
| `revision` | `REV_{REV}` | `REV = 1` | `REV_1` |

The two article examples are the folders under
`docs/example-articles-folder/customer-0001/`; their `article_data.json` files
carry `"customer": 1`.

## Validation and status semantics

Configuration errors are reported per customer and persisted as issues in the
cache. Root-level failures abort the scan and **leave the cache untouched**,
because an unlistable root cannot distinguish a deleted customer from an
unmounted folder.

| Issue code | Severity | Meaning |
| --- | --- | --- |
| `CONFIG_MISSING` | error | `customer_data.json` does not exist. |
| `CONFIG_UNREADABLE` | error | The file cannot be read (I/O, symlink, not a regular file, oversized). |
| `CONFIG_INVALID` | error | JSON is valid but the document fails the schema or key-template validation. |
| `CONFIG_INVALID_JSON` | error | The file is not valid JSON. |
| `ARTICLE_INVALID` | warning | An article folder is missing/invalid `article_data.json`; not counted. |
| `ARTICLE_SYMLINK` | warning | An article entry is a symlink; ignored. |
| `ENTRY_UNEXPECTED` | warning | A `customer-*` name is not a valid customer folder, or the scan-level issue list was truncated. |
| `FOLDER_SYMLINK` | error | The customer entry is a symlink; not followed. |
| `FOLDER_NOT_DIRECTORY` | error | The customer entry is not a directory. |
| `FOLDER_UNREADABLE` | error | The customer entry cannot be inspected (permission/I/O error); the scan continues with the other customers. |
| `ROOT_MISSING` | error | `articlesDirectory` does not exist. |
| `ROOT_UNREADABLE` | error | `articlesDirectory` cannot be inspected or listed. |
| `ROOT_SYMLINK` | error | `articlesDirectory` is a symlink; refused. |
| `ROOT_NOT_DIRECTORY` | error | `articlesDirectory` is not a directory. |

A customer's `status` is derived from its issues:

| Status | Condition |
| --- | --- |
| `error` | At least one issue has severity `error`. |
| `warning` | No errors, but at least one warning. |
| `ok` | No issues. |

A customer with a missing or invalid config still has its articles counted, so
the UI can show the folder contents.

## Scan and CRUD semantics

### Scanning

- At startup the main process scans `articlesDirectory` in the background after
  the window is created. `customers.scanCustomers` performs a manual refresh.
- Scans are serialised by a non-re-entrant customer lock, so a startup scan and
  a manual refresh cannot interleave. Mutations share the same lock: a very
  large (for example network) root can delay a manual create/update/delete
  until the current scan finishes.
- When `articlesDirectory` is not configured, no scan runs and the cache is left
  untouched.
- Each run rereads the root, parses each `customer-XXXX`, counts valid articles,
  and reconciles rows:
  - new folders insert a row (`created`);
  - changed rows update in place (`updated`) — the folder/config mtime
    fingerprint and the cached metadata participate in the comparison;
  - identical rows are left alone (`unchanged`);
  - cached rows not seen while enumerating the current root are deleted
    (`removed`). The cache is single-root, so rows left behind by a previous
    `articlesDirectory` are removed too. Nothing is deleted when the root
    cannot be enumerated.
- Cache reads (`listCustomers`, `getCustomer`) do not take the customer lock:
  a scan updates rows incrementally, so a read issued while a scan is running
  can observe a partially reconciled snapshot until that scan completes.
  `clearCustomers` empties the cache only; the next scan restores it.
  Changing `articlesDirectory` in the preferences also empties the cache, so
  customers from the old root cannot linger in the list.
- To keep a hostile or misconfigured root from holding the customer lock
  indefinitely, a scan refuses more than 50,000 root entries (leaving the cache
  untouched) and an article count refuses more than 10,000 entries in one
  customer (reported as `FOLDER_UNREADABLE`).

### CRUD operations

All operations validate the filesystem, change it, and only then update the
cache row. They are serialised by the same lock and never call the scanner
themselves.

| Operation | Semantics |
| --- | --- |
| `createCustomer` | Requires an existing, real `articlesDirectory`. Accepts `name`, `article`, `revision` and optional `customerCode`. Without a code, the lowest free `0001`–`9999` is chosen. Creates the folder and writes `customer_data.json` atomically (temp file plus rename, with a backup of the previous file on platforms that refuse to replace it); removes the folder if the write fails. |
| `updateCustomer` | Requires a real customer folder inside the root. Accepts any of `name`, `article`, `revision`. A missing, invalid or unsupported-version config is repairable only when there are no articles and all three sections are supplied; with articles the real `CONFIG_*` error is propagated so the key lock keeps working against the authoritative file. |
| `removeCustomer` | Refuses when `articleCount > 0`. Requires `trashDirectory`; moves the folder there and deletes the cache row. |
| `clearCustomers` | Deletes every cache row only. |

Guards:

- **Delete guard:** a customer with at least one valid article cannot be
  removed.
- **Key lock:** once `articleCount > 0`, changing `article.key` or
  `revision.key` is refused. Other parameters remain editable.
- **Trash mandatory:** deleting without a configured, existing, non-symlink
  trash directory fails; the folder is never deleted in place. The trash
  directory must resolve (real path, so symlinked intermediate components are
  followed) outside `articlesDirectory`.
- **Trash move:** a rename is attempted first; on a cross-device error the
  folder is copied then the source removed — if the copy succeeds but removing
  the source fails, the error is reported and neither copy is lost. A name
  collision in the trash is resolved with a timestamp and then numeric
  suffixes. A trash directory nested inside the source is refused.
- **Path confinement:** every caller-supplied `folderPath` must be a direct
  child of `articlesDirectory` (this also rejects a path that reaches the root
  through a symlinked intermediate directory), be NUL-free, and name a
  non-symlink directory.

### `metadata_json` cache shape

The `customers.metadata_json` column stores:

```json
{
  "article": { "schemaVersion": 1, "key": "...", "parameters": { "...": {} } },
  "revision": { "schemaVersion": 1, "key": "...", "parameters": { "...": {} } },
  "articleCount": 2,
  "issues": []
}
```

`article` and `revision` are `null` when the customer has no valid config.
`issues` mirrors the issues used to derive `status`. `folderPath` remains the
primary key, and `searchText` is a pre-folded (NFC + lowercase) concatenation of
`customerCode`, `folderName` and `name` maintained by the customer store.

## IPC procedures

| Procedure | Input | Output |
| --- | --- | --- |
| `customers.listCustomers` | `{ limit?, offset?, search?, status? }` | `{ items, total }` (summaries, no metadata). |
| `customers.getCustomer` | `{ folderPath }` | Full customer row or `null`. |
| `customers.createCustomer` | `{ name, article, revision, customerCode? }` | Created customer row. |
| `customers.updateCustomer` | `{ folderPath, name?, article?, revision? }` | Updated customer row. |
| `customers.removeCustomer` | `{ folderPath }` | The removed `folderPath`. |
| `customers.scanCustomers` | `{}` | `{ scanned, created, updated, unchanged, removed, issues, root }`. |
| `customers.clearCustomers` | — | Number of deleted rows. |

`upsertCustomer` no longer exists; the customer cache is written only by the
scanner and the CRUD service. `search` matches the folded search text;
`status` filters `ok`/`warning`/`error`. `limit` is 1–500 (default 100) and
`offset` is `>= 0`.

Domain failures are mapped onto oRPC statuses:

| Status | Domain codes |
| --- | --- |
| `BAD_REQUEST` | `CUSTOMER_CODE_INVALID`, `CUSTOMER_FOLDER_NAME_INVALID`, `CUSTOMER_FOLDER_NOT_DIRECTORY`, `CUSTOMER_FOLDER_SYMLINK`, `CUSTOMER_NAME_INVALID`, `CONFIG_INVALID`, `CONFIG_INVALID_JSON`, `CONFIG_MISSING`, `CONFIG_UNREADABLE`, `CONFIG_UNSUPPORTED_VERSION`, `CONFIG_VERSION_CONFLICT`, `INVALID_OPERATION`, `KEY_RENDER_INVALID`, `KEY_TEMPLATE_INVALID`. |
| `NOT_FOUND` | `CUSTOMER_NOT_FOUND`. |
| `CONFLICT` | `CUSTOMER_CODE_TAKEN`, `CUSTOMER_CODE_EXHAUSTED`, `CUSTOMER_HAS_ARTICLES`, `KEY_LOCKED`. |
| `PRECONDITION_FAILED` | `ROOT_NOT_CONFIGURED`, `ROOT_NOT_FOUND`, `ROOT_NOT_DIRECTORY`, `ROOT_SYMLINK`, `TRASH_NOT_CONFIGURED`, `TRASH_NOT_FOUND`, `TRASH_NOT_DIRECTORY`, `TRASH_SYMLINK`. |
| *(unmapped, 5xx)* | `READ_FAILED`, `WRITE_FAILED`, `TRASH_MOVE_FAILED` — kept as the original error so the IPC interceptor logs them as real failures. |

Lookups (`getCustomer`) return `null` for an unknown folder; mutations throw.
Unexpected I/O failures surface as a generic server error while the original
`CustomerServiceError` code stays in the main-process log.

## Example: adding a customer

1. Ensure `articlesDirectory` (and `trashDirectory`, for later deletes) is set
   in preferences.
2. Create `customer-0001/` under `articlesDirectory`, or let
   `createCustomer` allocate the lowest free code.
3. Write `customer_data.json` in the clean v1 shape shown above.
4. Create an article folder whose name is the rendered `article.key`, and add a
   minimally valid `article_data.json`:

   ```json
   {
     "schemaVersion": 1,
     "customer": 1,
     "CODE": "article-example-1",
     "EVO": "0"
   }
   ```

5. Run `customers.scanCustomers` (or restart the app) to refresh the cache. The
   customer appears with `status: "ok"` and `articleCount: 1`.
6. Once articles exist, `article.key` and `revision.key` are locked. To change
   the key, remove or move the articles first.

## Articles

Articles are the second filesystem-first subdomain. They share the
`articlesDirectory` root and the `trashDirectory` preference with customers, but
they live in their own SQLite cache table (`articles`) and their own oRPC
namespace (`articles`). As with customers, the filesystem is the source of
truth, the cache is disposable, and the renderer only talks to the IPC layer.

### `article_data.json`

An article is a direct child folder of a `customer-XXXX` folder. Its definition
is `article_data.json` (at most 64 KiB). The clean shape is:

```json
{
  "schemaVersion": 1,
  "customer": 1,
  "activeRevision": "REV_1",
  "CODE": "article-example-1",
  "EVO": "0",
  "CUSTOM_PARAM": "value"
}
```

| Key | Type | Rules |
| --- | --- | --- |
| `schemaVersion` | integer | Reserved. Integer `>= 1`. |
| `customer` | number | Reserved. Must equal the folder's customer code (`Number("0001") === 1`). |
| `activeRevision` | string | Reserved, optional. 1–255 characters and a single path component: no path separators, control characters or NUL, not `.`/`..`, and not ending in a space or dot. Omitted when there is none. |
| Declared parameter names | string, number or boolean | The names declared in `customer_data.json` → `article.parameters`. Values are canonicalised through the article key template (number → canonical decimal, boolean → `"true"`/`"false"`, text → trimmed). Missing values fall back to the parameter default; a required parameter without a value is an error. |
| Custom parameter names | string, number or boolean | Any other key matching `^[A-Z][A-Z0-9_]{0,63}$` that is not reserved and not a declared parameter. Values are a string of at most 1024 characters (preserved verbatim), a finite number, or a boolean. `null`, objects and arrays are invalid. Custom parameters never participate in the article key. |

The minimal validity rule used by the customer `articleCount` is unchanged: a
plain object with an integer `schemaVersion >= 1` and a `customer` equal to the
folder code. The article scanner is stricter: it parses the declared parameters
and validates the custom parameters before caching a row.

### Revisions

A revision is counted only when it is a **real directory** (never a symlink;
`DT_UNKNOWN` falls back to `lstat`) whose **folder name matches** the pattern
rendered from `customer_data.json` → `revision.key` with the declared parameter
types:

| Token | Accepted names |
| --- | --- |
| literal | the escaped literal |
| `number`, no padding | `0`, or a non-zero number with no leading zero (`1`, `42`, never `01`) |
| `number`, width `w` | exactly `w` digits, or a non-zero number that outgrew the width |
| `bool` | `true` or `false` |
| `text` | at least one character, without path separators, reserved characters or control characters |
| optional group | the whole group may be absent |

Matching is deterministic (a memoised walk over the template tokens), not a
regular expression, so a hostile `revision.key` cannot trigger catastrophic
backtracking; the matcher also carries a bounded work budget shared across the
names of one article, and aborts with `READ_FAILED` when it is exhausted. The
scanner reports the exhausted count as `ARTICLE_DATA_UNREADABLE` and preserves
the article's existing cached row instead of deleting it.
`revision_data.json` is not required for counting, and dot entries are ignored.
Enumeration is capped at 10,000 entries per article: exceeding the cap fails the
count instead of returning a partial number.

### The `articles` cache table

`src/db/schema.ts` declares the `articles` table (migration
`drizzle/0003_slimy_revanche.sql`):

| Column | Meaning |
| --- | --- |
| `folder_path` | Primary key. Absolute article folder path. |
| `customer_folder_path` | Absolute parent customer folder; indexed. |
| `customer_code` | Customer code without the `customer-` prefix. |
| `folder_name` | Article folder name (the rendered article key). Indexed. |
| `schema_version` | `schemaVersion` from `article_data.json`. |
| `active_revision` | `activeRevision`, or `NULL`. |
| `revision_count` | Number of matching revision directories. |
| `folder_mtime_ms` | Newest mtime of the article folder and its data file, in epoch milliseconds. |
| `metadata_json` | Parsed `ArticleCacheMetadata`: `{ schemaVersion, customer, activeRevision, parameters, customParameters }`. Validated at the IPC boundary; an invalid/legacy document is returned as `null`. |
| `search_text` | Pre-folded (NFC + lower-case) `folderName` plus every parameter value, space-joined. Maintained by `upsertArticleRow`, so `instr()` searches need no JavaScript. |
| `created_at`, `updated_at` | Epoch milliseconds. |

Only valid articles are cached. Invalid or missing `article_data.json` folders
are skipped and surfaced through scan issues; a stale row for such a folder is
removed by the next scan. The cache is single-root: rows not seen while
enumerating the current root are deleted, and changing `articlesDirectory`
clears both the customer and article caches before anything is rescanned.

### Scan semantics

- `articles.scanArticles` and the startup scan walk `articlesDirectory` like the
  customer scanner: a missing/unreadable/symlinked/non-directory root leaves the
  cache untouched; more than 50,000 root entries abort; dot entries are ignored
  and symlinks are never followed.
- Only real `customer-XXXX` directories with a valid `customer_data.json` are
  scanned. Every direct real child directory is inspected (data file at most
  64 KiB) and a valid article upserts a row with its revision count.
- Customer folders are streamed with `opendir`; more than 10,000 entries in one
  customer folder records an `ARTICLE_DATA_UNREADABLE` issue and leaves that
  customer's cached rows untouched. A failure to list or inspect a customer
  folder (as opposed to a missing/invalid config) also preserves its rows: the
  failure may be transient, so it must not wipe that cache slice.
- Issue paths longer than 4096 characters are omitted, so one hostile path
  cannot make the wire schema reject the whole scan response.
- Scans and mutations share the non-re-entrant customer lock. The customer scan
  triggers an article scan best-effort after it finishes; a failure there is
  logged and does not change the customer scan response.
- `articles.clearArticles` empties only the cache.

### CRUD semantics

All article operations validate the filesystem, perform the change, then update
the cache row. They run under `withCustomerLock` and never call a scanner.

| Operation | Semantics |
| --- | --- |
| `createArticle` | Requires a real root and a direct-child customer folder with a valid config. Only names declared by the customer's `article.parameters` are accepted (an unknown name is `ARTICLE_DATA_INVALID`, never silently replaced by a default). Resolves the parameters, renders the key, checks the name is a safe single path component (dot-prefixed names are rejected), refuses an existing folder, checks the serialised document against the 64 KiB limit, creates the folder and writes `article_data.json` atomically (the new folder is removed if the write fails, but only when it is still a real directory). The new row has `revisionCount: 0`. |
| `updateArticle` | Merges `parameters` and `customParameters` over the existing document. Parameter names must be declared, and the merged custom-parameter map is capped at 64 entries. **The key is immutable for parameter updates**: when `parameters` is supplied and the newly rendered name differs from the current folder name, the update fails with `ARTICLE_KEY_LOCKED`. A custom-parameter-only update does not compare the rendered key, so it still succeeds when the folder was renamed on disk. Revisions are counted before the data file is written: a read/entry-budget failure aborts the update without mutating the document. |
| `removeArticle` | Requires `trashDirectory`; moves the folder to `<trashDirectory>/articles/<customer-folder>/<article-folder>` and deletes the cache row. A folder is never deleted in place. |
| `removeCustomer` | After moving a customer folder to `<trashDirectory>/customers/<customer-folder>`, every article row whose `customer_folder_path` is that folder is deleted. |

Path confinement is rechecked for both levels: the customer must be a direct
child of the root, the article a direct child of a valid customer folder, both
NUL-free, non-symlink and real directories. The trash root must exist, be a
real directory, and resolve outside `articlesDirectory`.

### Trash layout

```
<trashDirectory>/
├── customers/
│   └── customer-0001/          # removed with removeCustomer
└── articles/
    └── customer-0001/
        └── article-example-1/  # removed with removeArticle
```

Missing `customers/` and `articles/<customer-folder>/` directories are created
with mode `0755`. A name collision is resolved with a timestamp and then numeric
suffixes, using the same move primitive as customers (rename first, copy+remove
on a cross-device error). Collision probing is capped at 1,000 suffixes, then a
random suffix is used; if that also exists the move fails with
`MOVE_FAILED`. If `trashDirectory` is the parent of `articlesDirectory` and the
root is named `articles` (or `customers` for the customer flow), the per-type
subdirectory would resolve back inside the root; both flows refuse that with
`INVALID_OPERATION` before moving anything.

### `articles` IPC procedures

| Procedure | Input | Output |
| --- | --- | --- |
| `articles.listArticles` | `{ customerFolderPath, limit?, offset?, search? }` | `{ items, total }` (summaries, no metadata). |
| `articles.getArticle` | `{ folderPath }` | Full row with `metadataJson`, or `null`. |
| `articles.createArticle` | `{ customerFolderPath, parameters, customParameters? }` | Created row. |
| `articles.updateArticle` | `{ folderPath, parameters?, customParameters? }` | Updated row. |
| `articles.removeArticle` | `{ folderPath }` | The removed `folderPath`. |
| `articles.scanArticles` | `{}` | `{ scanned, created, updated, unchanged, removed, issues, root }`. |
| `articles.clearArticles` | — | Number of deleted rows. |

`limit` is 1–500 (default 100), `offset` is `>= 0`, `search` is trimmed and
capped at 256 characters. Parameter/custom-parameter maps hold at most 64
entries and names must match `^[A-Z][A-Z0-9_]{0,63}$`; values are a string of at
most 1024 characters, a finite number or a boolean. Paths are NUL-checked and
resolved. `updateArticle` requires at least one of `parameters` or
`customParameters`, and `customParameters` merge into (never replace) the
existing map in this iteration.

Domain failures are mapped onto oRPC statuses:

| Status | Domain codes |
| --- | --- |
| `NOT_FOUND` | `ARTICLE_NOT_FOUND`, `ARTICLE_CUSTOMER_NOT_FOUND`. |
| `CONFLICT` | `ARTICLE_ALREADY_EXISTS`, `ARTICLE_KEY_LOCKED`. |
| `PRECONDITION_FAILED` | `ROOT_NOT_CONFIGURED`, `ROOT_NOT_FOUND`, `ROOT_NOT_DIRECTORY`, `ROOT_SYMLINK`, `TRASH_NOT_CONFIGURED`, `TRASH_NOT_FOUND`, `TRASH_NOT_DIRECTORY`, `TRASH_SYMLINK`. |
| `BAD_REQUEST` | `ARTICLE_CUSTOMER_CONFIG_INVALID`, `ARTICLE_CUSTOMER_CONFIG_MISSING`, `ARTICLE_CUSTOMER_NOT_DIRECTORY`, `ARTICLE_CUSTOMER_SYMLINK`, `ARTICLE_DATA_INVALID`, `ARTICLE_DATA_INVALID_JSON`, `ARTICLE_DATA_MISSING`, `ARTICLE_DATA_UNREADABLE`, `ARTICLE_FOLDER_NAME_INVALID`, `ARTICLE_FOLDER_NOT_DIRECTORY`, `ARTICLE_FOLDER_SYMLINK`, `ARTICLE_PATH_INVALID`, `INVALID_OPERATION`, `KEY_RENDER_INVALID`. |
| *(unmapped, 5xx)* | `READ_FAILED`, `WRITE_FAILED`, `TRASH_MOVE_FAILED` — kept as the original error so the IPC interceptor logs them as real failures. |

`getArticle` returns `null` for an unknown folder; mutations throw. Scan issues
use `ArticleIssue` (`code`, `message`, optional `path`, `severity`) and are
bounded to 200 per scan.
