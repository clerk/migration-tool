# Supported Schema Fields

The migration tool validates all user data against a Zod schema defined in `src/migrate/validator.ts`. Below is a complete list of supported fields.

## Required Fields

| Field    | Type     | Description                                                        |
| -------- | -------- | ------------------------------------------------------------------ |
| `userId` | `string` | Unique identifier for the user (required for tracking and logging) |

## Identifier Fields

At least one identifier (email, phone, or username) is required.

| Field                      | Type                 | Description                         |
| -------------------------- | -------------------- | ----------------------------------- |
| `email`                    | `string \| string[]` | Primary verified email address(es)  |
| `emailAddresses`           | `string \| string[]` | Additional verified email addresses |
| `unverifiedEmailAddresses` | `string \| string[]` | Unverified email addresses          |
| `phone`                    | `string \| string[]` | Primary verified phone number(s)    |
| `phoneNumbers`             | `string \| string[]` | Additional verified phone numbers   |
| `unverifiedPhoneNumbers`   | `string \| string[]` | Unverified phone numbers            |
| `username`                 | `string`             | Username for the user               |

## User Information

| Field       | Type     | Description       |
| ----------- | -------- | ----------------- |
| `firstName` | `string` | User's first name |
| `lastName`  | `string` | User's last name  |

## Password Fields

| Field            | Type     | Description                                                 |
| ---------------- | -------- | ----------------------------------------------------------- |
| `password`       | `string` | Hashed password from source platform                        |
| `passwordHasher` | `enum`   | Hashing algorithm used (required when password is provided) |

### Supported Password Hashers

- `argon2i`, `argon2id`
- `bcrypt`, `bcrypt_peppered`, `bcrypt_sha256_django`
- `hmac_sha256_utf16_b64`
- `md5`, `md5_salted`, `md5_phpass`
- `pbkdf2_sha1`, `pbkdf2_sha256`, `pbkdf2_sha256_django`, `pbkdf2_sha512`, `pbkdf2_sha512_hex`,
- `scrypt_firebase`, `scrypt_werkzeug`
- `sha256`, `sha256_salted`, `sha512_symfony`
- `ldap_ssha`
- `awscognito`

## Two-Factor Authentication

| Field                | Type       | Description                      |
| -------------------- | ---------- | -------------------------------- |
| `totpSecret`         | `string`   | TOTP secret for 2FA              |
| `backupCodesEnabled` | `boolean`  | Whether backup codes are enabled |
| `backupCodes`        | `string[]` | Array of backup codes            |

## Metadata

| Field             | Type  | Description                                                  |
| ----------------- | ----- | ------------------------------------------------------------ |
| `unsafeMetadata`  | `any` | Publicly accessible metadata (readable by client and server) |
| `publicMetadata`  | `any` | Publicly accessible metadata (readable by client and server) |
| `privateMetadata` | `any` | Server-side only metadata (not accessible to client)         |

## Clerk API Configuration Fields

| Field                       | Type      | Description                                     |
| --------------------------- | --------- | ----------------------------------------------- |
| `banned`                    | `boolean` | Whether the user is banned                      |
| `bypassClientTrust`         | `boolean` | Skip client trust verification                  |
| `createOrganizationEnabled` | `boolean` | Whether user can create organizations           |
| `createOrganizationsLimit`  | `number`  | Maximum number of organizations user can create |
| `createdAt`                 | `string`  | Custom creation timestamp                       |
| `deleteSelfEnabled`         | `boolean` | Whether user can delete their own account       |
| `legalAcceptedAt`           | `string`  | Timestamp when legal terms were accepted        |
| `skipLegalChecks`           | `boolean` | Skip legal acceptance checks                    |
| `skipPasswordChecks`        | `boolean` | Skip password requirements during import        |

## Modifying the Schema

To add new fields to the schema, edit `userSchema` in `src/migrate/validator.ts`.
