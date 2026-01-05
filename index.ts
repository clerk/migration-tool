import { config } from 'dotenv'
config()

import * as fs from 'fs'
import * as path from 'path'
import * as z from 'zod'
import clerkClient from '@clerk/clerk-sdk-node'
import ora, { Ora } from 'ora'

const SECRET_KEY = process.env.CLERK_SECRET_KEY
const DELAY = parseInt(process.env.DELAY_MS ?? `1_000`)
const RETRY_DELAY = parseInt(process.env.RETRY_DELAY_MS ?? `10_000`)
const IMPORT_TO_DEV = process.env.IMPORT_TO_DEV_INSTANCE ?? 'false'
const OFFSET = parseInt(process.env.OFFSET ?? `0`)

if (!SECRET_KEY) {
  throw new Error('CLERK_SECRET_KEY is required. Please copy .env.example to .env and add your key.')
}

if (SECRET_KEY.split('_')[1] !== 'live' && IMPORT_TO_DEV === 'false') {
  throw new Error(
    "The Clerk Secret Key provided is for a development instance. Development instances are limited to 500 users and do not share their userbase with production instances. If you want to import users to your development instance, please set 'IMPORT_TO_DEV_INSTANCE' in your .env to 'true'."
  )
}

const userSchema = z.object({
  /** The ID of the user as used in your external systems or your previous authentication solution. Must be unique across your instance. */
  userId: z.string(),
  /** Email address to set as User's primary email address. */
  email: z.string().email(),
  /** The first name to assign to the user */
  firstName: z.string().optional(),
  /** The last name to assign to the user */
  lastName: z.string().optional(),
  /** The plaintext password to give the user. Must be at least 8 characters long, and can not be in any list of hacked passwords. */
  password: z.string().optional(),
  /** The hashing algorithm that was used to generate the password digest.
   * @see https://clerk.com/docs/reference/backend-api/tag/Users#operation/CreateUser!path=password_hasher&t=request
   */
  passwordHasher: z
    .enum([
      'argon2i',
      'argon2id',
      'bcrypt',
      'bcrypt_sha256_django',
      'ldap_ssha',
      'md5',
      'md5_phpass',
      'pbkdf2_sha256',
      'pbkdf2_sha256_django',
      'pbkdf2_sha1',
      'phpass',
      'scrypt_firebase',
      'scrypt_werkzeug',
      'sha256',
    ])
    .optional(),
  /** Metadata saved on the user, that is visible to both your Frontend and Backend APIs */
  public_metadata: z.record(z.string(), z.unknown()).optional(),
  /** Metadata saved on the user, that is only visible to your Backend APIs */
  private_metadata: z.record(z.string(), z.unknown()).optional(),
  /** Metadata saved on the user, that can be updated from both the Frontend and Backend APIs. Note: Since this data can be modified from the frontend, it is not guaranteed to be safe. */
  unsafe_metadata: z.record(z.string(), z.unknown()).optional(),
})

type User = z.infer<typeof userSchema>

const createUser = (userData: User) =>
  userData.password
    ? clerkClient.users.createUser({
        externalId: userData.userId,
        emailAddress: [userData.email],
        firstName: userData.firstName,
        lastName: userData.lastName,
        passwordDigest: userData.password,
        passwordHasher: userData.passwordHasher,
        privateMetadata: userData.private_metadata,
        publicMetadata: userData.public_metadata,
        unsafeMetadata: userData.unsafe_metadata,
      })
    : clerkClient.users.createUser({
        externalId: userData.userId,
        emailAddress: [userData.email],
        firstName: userData.firstName,
        lastName: userData.lastName,
        skipPasswordRequirement: true,
        privateMetadata: userData.private_metadata,
        publicMetadata: userData.public_metadata,
        unsafeMetadata: userData.unsafe_metadata,
      })

const now = new Date().toISOString().split('.')[0] // YYYY-MM-DDTHH:mm:ss
function appendLog(payload: any) {
  fs.appendFileSync(`./migration-log-${now}.json`, `\n${JSON.stringify(payload, null, 2)}`)
}

let migrated = 0
let alreadyExists = 0

async function processUserToClerk(userData: User, spinner: Ora) {
  const txt = spinner.text
  try {
    const parsedUserData = userSchema.safeParse(userData)
    if (!parsedUserData.success) {
      throw parsedUserData.error
    }
    await createUser(parsedUserData.data)

    migrated++
  } catch (error) {
    if (error.status === 422) {
      appendLog({ userId: userData.userId, ...error })
      alreadyExists++
      return
    }

    // Keep cooldown in case rate limit is reached as a fallback if the thread blocking fails
    if (error.status === 429) {
      spinner.text = `${txt} - rate limit reached, waiting for ${RETRY_DELAY} ms`
      await rateLimitCooldown()
      spinner.text = txt
      return processUserToClerk(userData, spinner)
    }

    appendLog({ userId: userData.userId, ...error })
  }
}

async function cooldown() {
  await new Promise((r) => setTimeout(r, DELAY))
}

async function rateLimitCooldown() {
  await new Promise((r) => setTimeout(r, RETRY_DELAY))
}

function parseCSV(csvContent: string): any[] {
  const lines = csvContent.split('\n').filter((line) => line.trim() !== '')
  if (lines.length === 0) {
    return []
  }

  // Parse header
  const headers = parseCSVLine(lines[0])
  const rows: any[] = []

  // Parse data rows
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i])
    const row: any = {}

    headers.forEach((header, index) => {
      const value = values[index]?.trim() || ''
      const headerKey = header.trim()

      // Handle metadata fields that might be JSON strings
      if (headerKey === 'public_metadata' || headerKey === 'private_metadata' || headerKey === 'unsafe_metadata') {
        if (value) {
          try {
            row[headerKey] = JSON.parse(value)
          } catch {
            // If not valid JSON, treat as empty object
            row[headerKey] = {}
          }
        }
      } else {
        // Convert empty strings to undefined for optional fields
        row[headerKey] = value === '' ? undefined : value
      }
    })

    rows.push(row)
  }

  return rows
}

/**
 *
 * Parses a CSV line into an array of strings.
 * For example:
 * Input: '1,"John, Doe",john@example.com,"password,hash"'
 * Output: ['1', 'John, Doe', 'john@example.com', 'password,hash']
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    const nextChar = line[i + 1]

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Escaped quote
        current += '"'
        i++ // Skip next quote
      } else {
        // Toggle quote state
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      // End of field
      result.push(current)
      current = ''
    } else {
      current += char
    }
  }

  // Add last field
  result.push(current)
  return result
}

/**
 *
 * Loads user data from a file.
 * Supports JSON and CSV files.
 *
 * @param fileName - The name of the file to load.
 * @returns An array of user data.
 */
function loadUserData(fileName: string): any[] {
  const fileExtension = path.extname(fileName).toLowerCase()
  const fileContent = fs.readFileSync(fileName, 'utf-8')

  if (fileExtension === '.csv') {
    return parseCSV(fileContent)
  } else if (fileExtension === '.json') {
    return JSON.parse(fileContent)
  } else {
    // Try to detect format by content
    if (fileContent.trim().startsWith('[')) {
      // Looks like JSON
      return JSON.parse(fileContent)
    } else {
      // Assume CSV
      return parseCSV(fileContent)
    }
  }
}

async function main() {
  console.log(`Clerk User Migration Utility`)

  const inputFileName = process.argv[2] ?? 'users.json'

  console.log(`Fetching users from ${inputFileName}`)

  const parsedUserData: any[] = loadUserData(inputFileName)
  const offsetUsers = parsedUserData.slice(OFFSET)
  console.log(`${inputFileName} found and parsed, attempting migration with an offset of ${OFFSET}`)

  let i = 0
  const spinner = ora(`Migrating users`).start()

  for (const userData of offsetUsers) {
    spinner.text = `Migrating user ${i}/${offsetUsers.length}, cooldown`
    await cooldown()
    i++
    spinner.text = `Migrating user ${i}/${offsetUsers.length}`
    await processUserToClerk(userData, spinner)
  }

  spinner.succeed(`Migration complete`)
  return
}

main().then(() => {
  console.log(`${migrated} users migrated`)
  console.log(`${alreadyExists} users failed to upload`)
})
