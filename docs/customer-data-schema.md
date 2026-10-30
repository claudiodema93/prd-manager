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

At most 100 issues are kept per customer and 200 per scan. The last slot is
reserved for a truncation warning (the scan-level note reuses
`ENTRY_UNEXPECTED`).

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
| `ENTRY_UNEXPECTED` | warning | A `customer-*` name is not a valid customer folder, or a list was truncated. |
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
- All cache reads (`listCustomers`, `getCustomer`) see the last successful
  scan. `clearCustomers` empties the cache only; the next scan restores it.
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
| `createCustomer` | Requires an existing, real `articlesDirectory`. Accepts `name`, `article`, `revision` and optional `customerCode`. Without a code, the lowest free `0001`–`9999` is chosen. Creates the folder and writes `customer_data.json` atomically; removes the folder if the write fails. |
| `updateCustomer` | Requires a real customer folder inside the root. Accepts any of `name`, `article`, `revision`. A missing/invalid config is repairable only when there are no articles and all three sections are supplied. |
| `removeCustomer` | Refuses when `articleCount > 0`. Requires `trashDirectory`; moves the folder there and deletes the cache row. |
| `clearCustomers` | Deletes every cache row only. |

Guards:

- **Delete guard:** a customer with at least one valid article cannot be
  removed.
- **Key lock:** once `articleCount > 0`, changing `article.key` or
  `revision.key` is refused. Other parameters remain editable.
- **Trash mandatory:** deleting without a configured, existing, non-symlink
  trash directory fails; the folder is never deleted in place. The trash
  directory must be outside `articlesDirectory`.
- **Trash move:** a rename is attempted first; on a cross-device error the
  folder is copied then the source removed. A name collision in the trash is
  resolved with a timestamp and then numeric suffixes. A trash directory nested
  inside the source is refused.
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
