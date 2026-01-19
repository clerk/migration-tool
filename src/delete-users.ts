import { createClerkClient, User } from "@clerk/backend";
import * as p from "@clack/prompts";
import color from "picocolors";
import { cooldown } from "./utils";
import { env } from "./envs-constants";

const LIMIT = 500;
const users: User[] = [];
const s = p.spinner();
let total: number;
let count = 0;

const fetchUsers = async (offset: number) => {
  const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY })
  const { data, totalCount } = await clerk.users.getUserList({ offset, limit: LIMIT });

  if (data.length > 0) {
    for (const user of data) {
      users.push(user);
    }
  }

  if (data.length === LIMIT) {
    await cooldown(1000);
    return fetchUsers(offset + LIMIT);
  }

  return users;
};

const deleteUsers = async (users: User[]) => {
  s.message(`Deleting users: [0/${total}]`);
  for (const user of users) {
    const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY })
    await clerk.users.deleteUser(user.id)
      .then(async () => {
        count++;
        s.message(`Deleting users: [${count}/${total}]`);
        await cooldown(1000);
      })
  }
  s.stop();
};

export const processUsers = async () => {
  p.intro(
    `${color.bgCyan(color.black("Clerk User Migration Utility - Deleting Users"))}`,
  );

  s.start();
  s.message("Fetching current user list");
  const users = await fetchUsers(0);
  total = users.length;

  s.stop("Done fetching current user list");
  s.start();

  await deleteUsers(users);

  p.outro("User deletion complete");
};

processUsers();
