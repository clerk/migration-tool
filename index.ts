import { config } from "dotenv";
config();

import * as fs from "fs";
import * as z from "zod";
import clerkClient from "@clerk/clerk-sdk-node";
import ora, { Ora } from "ora";

const SECRET_KEY = process.env.CLERK_SECRET_KEY;
const DELAY = parseInt(process.env.DELAY_MS ?? `1_000`);
const RETRY_DELAY = parseInt(process.env.RETRY_DELAY_MS ?? `10_000`);
const IMPORT_TO_DEV = process.env.IMPORT_TO_DEV_INSTANCE ?? "false";
const OFFSET = parseInt(process.env.OFFSET ?? `0`);

if (!SECRET_KEY) {
	throw new Error(
		"CLERK_SECRET_KEY is required. Please copy .env.example to .env and add your key."
	);
}

if (SECRET_KEY.split("_")[1] !== "live" && IMPORT_TO_DEV === "false") {
	throw new Error(
		"The Clerk Secret Key provided is for a development instance. Development instances are limited to 500 users and do not share their userbase with production instances. If you want to import users to your development instance, please set 'IMPORT_TO_DEV_INSTANCE' in your .env to 'true'."
	);
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
			"argon2i",
			"argon2id",
			"bcrypt",
			"bcrypt_sha256_django",
			"ldap_ssha",
			"md5",
			"md5_phpass",
			"pbkdf2_sha256",
			"pbkdf2_sha256_django",
			"pbkdf2_sha1",
			"phpass",
			"scrypt_firebase",
			"scrypt_werkzeug",
			"sha256",
		])
		.optional(),
	/** Metadata saved on the user, that is visible to both your Frontend and Backend APIs */
	public_metadata: z.record(z.string(), z.unknown()).optional(),
	/** Metadata saved on the user, that is only visible to your Backend APIs */
	private_metadata: z.record(z.string(), z.unknown()).optional(),
	/** Metadata saved on the user, that can be updated from both the Frontend and Backend APIs. Note: Since this data can be modified from the frontend, it is not guaranteed to be safe. */
	unsafe_metadata: z.record(z.string(), z.unknown()).optional(),
    createdAt: z.string().optional(),
});

type User = z.infer<typeof userSchema>;

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
                createdAt: userData.createdAt,
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
                createdAt: userData.createdAt,
		  });

const now = new Date().toISOString().split(".")[0]; // YYYY-MM-DDTHH:mm:ss
function appendLog(payload: any) {
	fs.appendFileSync(
		`./migration-log-${now}.json`,
		`\n${JSON.stringify(payload, null, 2)}`
	);
}

let migrated = 0;
let alreadyExists = 0;

async function processUserToClerk(userData: User, spinner: Ora) {
	const txt = spinner.text;
	try {
		const parsedUserData = userSchema.safeParse(userData);
		if (!parsedUserData.success) {
			throw parsedUserData.error;
		}
		await createUser(parsedUserData.data);

		migrated++;
	} catch (error) {
		if (error.status === 422) {
			appendLog({ userId: userData.userId, ...error });
			alreadyExists++;
			return;
		}

		// Keep cooldown in case rate limit is reached as a fallback if the thread blocking fails
		if (error.status === 429) {
			spinner.text = `${txt} - rate limit reached, waiting for ${RETRY_DELAY} ms`;
			await rateLimitCooldown();
			spinner.text = txt;
			return processUserToClerk(userData, spinner);
		}

		appendLog({ userId: userData.userId, ...error });
	}
}

async function cooldown() {
	await new Promise((r) => setTimeout(r, DELAY));
}

async function rateLimitCooldown() {
	await new Promise((r) => setTimeout(r, RETRY_DELAY));
}

async function main() {
	console.log(`Clerk User Migration Utility`);

	const inputFileName = process.argv[2] ?? "users.json";

	console.log(`Fetching users from ${inputFileName}`);

	const parsedUserData: any[] = JSON.parse(
		fs.readFileSync(inputFileName, "utf-8")
	);
	const offsetUsers = parsedUserData.slice(OFFSET);
	console.log(
		`users.json found and parsed, attempting migration with an offset of ${OFFSET}`
	);

	let i = 0;
	const spinner = ora(`Migrating users`).start();

	for (const userData of offsetUsers) {
		spinner.text = `Migrating user ${i}/${offsetUsers.length}, cooldown`;
		await cooldown();
		i++;
		spinner.text = `Migrating user ${i}/${offsetUsers.length}`;
		await processUserToClerk(userData, spinner);
	}

	spinner.succeed(`Migration complete`);
	return;
}

main().then(() => {
	console.log(`${migrated} users migrated`);
	console.log(`${alreadyExists} users failed to upload`);
});
