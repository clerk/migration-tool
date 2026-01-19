import { config } from "dotenv";
config();

import { env } from "./src/envs-constants";
import { runCLI } from "./src/cli";
import { loadUsersFromFile } from "./src/functions";
import { importUsers } from "./src/import-users";

if (
  env.CLERK_SECRET_KEY.split("_")[1] !== "live" &&
  env.IMPORT_TO_DEV === false
) {
  throw new Error(
    "The Clerk Secret Key provided is for a development instance. Development instances are limited to 500 users and do not share their userbase with production instances. If you want to import users to your development instance, please set 'IMPORT_TO_DEV' in your .env to 'true'.",
  );
}

async function main() {
  const args = await runCLI();

  // we can use Zod to validate the args.keys to ensure it is TransformKeys type
  const users = await loadUsersFromFile(args.file, args.key);

  const usersToImport = users.slice(
    parseInt(args.offset) > env.OFFSET ? parseInt(args.offset) : env.OFFSET,
  );

  importUsers(usersToImport);
}

main();
