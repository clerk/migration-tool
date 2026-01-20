import "dotenv/config";

import { env } from "../envs-constants";
import { runCLI } from "./cli";
import { loadUsersFromFile } from "./functions";
import { importUsers } from "./import-users";

async function main() {
  const args = await runCLI();

  // we can use Zod to validate the args.keys to ensure it is TransformKeys type
  const users = await loadUsersFromFile(args.file, args.key);

  const usersToImport = users.slice(
    parseInt(args.offset) > env.OFFSET ? parseInt(args.offset) : env.OFFSET,
  );

  importUsers(usersToImport, args.skipPasswordRequirement);
}

main();
