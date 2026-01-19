import { describe, expect, test } from "vitest";
import { loadUsersFromFile, transformKeys } from "./functions";
import { handlers } from "./handlers";

// test("loadUsersFromFile CSV", async () => {
//   const userSupabase = await loadUsersFromFile(
//     "/samples/supabase.csv",
//     "clerk",
//   );
//
//   expect(userSupabase).toMatchInlineSnapshot(`
//     [
//       {
//         "email": "test@test.com",
//         "userId": "76b196c8-d5c4-4907-9746-ed06ef829a67",
//       },
//       {
//         "email": "test2@test2.com",
//         "userId": "926f3b49-9687-4d05-8557-2673387a1f3c",
//       },
//     ]
//   `);
// });

test("Clerk - loadUsersFromFile - JSON", async () => {
  const usersFromClerk = await loadUsersFromFile(
    "/samples/clerk.json",
    "clerk",
  );

  expect(usersFromClerk).toMatchInlineSnapshot(`
    [
      {
        "backupCodesEnabled": false,
        "email": [
          "johndoe@gmail.com",
        ],
        "firstName": "John",
        "lastName": "Doe",
        "mfaEnabled": false,
        "userId": "user_2fT3OpCuU3elx0CXE3cNyStBC9u",
      },
      {
        "backupCodesEnabled": false,
        "email": [
          "janedoe@gmail.com",
        ],
        "firstName": "Jane",
        "lastName": "Doe",
        "mfaEnabled": false,
        "userId": "user_2fTPmPJJGj6SZV1e8xN7yapuoim",
      },
    ]
  `);
});

test("Auth.js - loadUsersFromFile - JSON", async () => {
  const usersFromAuthjs = await loadUsersFromFile(
    "/samples/authjs.json",
    "authjs",
  );

  expect(usersFromAuthjs.slice(0, 2)).toMatchInlineSnapshot(`
    [
      {
        "email": "john@example.com",
        "firstName": "John",
        "lastName": "Doe",
        "password": "$2a$12$9HhLqMJxqBKhlZasxjlhger67GFcC4aOAtpcU.THpcSLiQve4mq6.",
        "passwordHasher": "bcrypt",
        "userId": "1",
      },
      {
        "email": "alice@example.com",
        "firstName": "Alice",
        "lastName": "Smith",
        "password": "$2a$12$9HhLqMJxqBKhlZasxjlhger67GFcC4aOAtpcU.THpcSLiQve4mq6.",
        "passwordHasher": "bcrypt",
        "userId": "2",
      },
    ]
  `);
});

test("Supabase - loadUsersFromFile - JSON", async () => {
  const usersFromSupabase = await loadUsersFromFile(
    "/samples/supabase.json",
    "supabase",
  );

  expect(usersFromSupabase).toMatchInlineSnapshot(`
    [
      {
        "emailAddresses": "janedoe@clerk.dev",
        "password": "$2a$10$hg4EXrEHfcqoKhNtENsYCO5anpp/C9WCUAAAtXEqpZkdCcxL/hcGG",
        "passwordHasher": "bcrypt",
        "userId": "2971a33d-5b7c-4c11-b8fe-61b7f185f211",
      },
      {
        "emailAddresses": "johndoe@clerk.dev",
        "password": "$2a$10$hg4EXrEHfcqoKhNtENsYCO5anpp/C9WCUAAAtXEqpZkdCcxL/hcGG",
        "passwordHasher": "bcrypt",
        "userId": "2971a33d-5b7c-4c11-b8fe-61b7f185f234",
      },
    ]
  `);
});

test("Auth0 - loadUsersFromFile - JSON", async () => {
  const usersFromAuth0 = await loadUsersFromFile(
    "/samples/auth0.json",
    "auth0",
  );

  expect(usersFromAuth0).toMatchInlineSnapshot(`[]`);
});

// ============================================================================
// transformKeys tests
// ============================================================================

describe("transformKeys", () => {
  const clerkHandler = handlers.find((h) => h.key === "clerk")!;
  const supabaseHandler = handlers.find((h) => h.key === "supabase")!;
  const auth0Handler = handlers.find((h) => h.key === "auth0")!;

  describe("key transformation", () => {
    test("transforms keys according to handler config", () => {
      const data = {
        id: "user_123",
        first_name: "John",
        last_name: "Doe",
        primary_email_address: "john@example.com",
      };

      const result = transformKeys(data, clerkHandler);

      expect(result).toEqual({
        userId: "user_123",
        firstName: "John",
        lastName: "Doe",
        email: "john@example.com",
      });
    });

    test("transforms Clerk-specific keys", () => {
      const data = {
        id: "user_123",
        primary_email_address: "john@example.com",
        verified_email_addresses: ["john@example.com", "other@example.com"],
        password_digest: "$2a$10$hash",
        password_hasher: "bcrypt",
        mfa_enabled: true,
        totp_secret: "SECRET",
        backup_codes_enabled: false,
      };

      const result = transformKeys(data, clerkHandler);

      expect(result).toEqual({
        userId: "user_123",
        email: "john@example.com",
        emailAddresses: ["john@example.com", "other@example.com"],
        password: "$2a$10$hash",
        passwordHasher: "bcrypt",
        mfaEnabled: true,
        totpSecret: "SECRET",
        backupCodesEnabled: false,
      });
    });

    test("transforms Supabase-specific keys", () => {
      const data = {
        id: "uuid-123",
        email: "jane@example.com",
        first_name: "Jane",
        last_name: "Smith",
        encrypted_password: "$2a$10$hash",
        phone: "+1234567890",
      };

      const result = transformKeys(data, supabaseHandler);

      expect(result).toEqual({
        userId: "uuid-123",
        emailAddresses: "jane@example.com",
        firstName: "Jane",
        lastName: "Smith",
        password: "$2a$10$hash",
        phone: "+1234567890",
      });
    });

    test("transforms Auth0-specific keys", () => {
      const data = {
        id: "auth0|123",
        email: "user@example.com",
        given_name: "Bob",
        family_name: "Jones",
        phone_number: "+1987654321",
        passwordHash: "$2b$10$hash",
        user_metadata: { role: "admin" },
      };

      const result = transformKeys(data, auth0Handler);

      expect(result).toEqual({
        userId: "auth0|123",
        emailAddresses: "user@example.com",
        firstName: "Bob",
        lastName: "Jones",
        phone: "+1987654321",
        password: "$2b$10$hash",
        publicMetadata: { role: "admin" },
      });
    });

    test("keeps unmapped keys unchanged", () => {
      const data = {
        id: "user_123",
        customField: "custom value",
        anotherField: 42,
      };

      const result = transformKeys(data, clerkHandler);

      expect(result).toEqual({
        userId: "user_123",
        customField: "custom value",
        anotherField: 42,
      });
    });
  });

  describe("filtering empty values", () => {
    test("filters out empty strings", () => {
      const data = {
        id: "user_123",
        first_name: "John",
        last_name: "",
        primary_email_address: "john@example.com",
      };

      const result = transformKeys(data, clerkHandler);

      expect(result).toEqual({
        userId: "user_123",
        firstName: "John",
        email: "john@example.com",
      });
      expect(result).not.toHaveProperty("lastName");
    });

    test("filters out empty JSON string '{\"}'", () => {
      const data = {
        id: "user_123",
        first_name: "John",
        public_metadata: '"{}"',
        unsafe_metadata: '"{}"',
      };

      const result = transformKeys(data, clerkHandler);

      expect(result).toEqual({
        userId: "user_123",
        firstName: "John",
      });
      expect(result).not.toHaveProperty("publicMetadata");
      expect(result).not.toHaveProperty("unsafeMetadata");
    });

    test("filters out null values", () => {
      const data = {
        id: "user_123",
        first_name: "John",
        last_name: null,
        username: null,
      };

      const result = transformKeys(data, clerkHandler);

      expect(result).toEqual({
        userId: "user_123",
        firstName: "John",
      });
      expect(result).not.toHaveProperty("lastName");
      expect(result).not.toHaveProperty("username");
    });

    test("keeps falsy but valid values (false, 0)", () => {
      const data = {
        id: "user_123",
        mfa_enabled: false,
        backup_codes_enabled: false,
      };

      const result = transformKeys(data, clerkHandler);

      expect(result).toEqual({
        userId: "user_123",
        mfaEnabled: false,
        backupCodesEnabled: false,
      });
    });

    test("keeps undefined values (current behavior)", () => {
      const data = {
        id: "user_123",
        first_name: undefined,
      };

      const result = transformKeys(data, clerkHandler);

      // undefined is not filtered, only "", '"{}"', and null
      expect(result).toHaveProperty("firstName");
      expect(result.firstName).toBeUndefined();
    });
  });

  describe("edge cases", () => {
    test("handles empty object", () => {
      const result = transformKeys({}, clerkHandler);
      expect(result).toEqual({});
    });

    test("handles object with only filtered values", () => {
      const data = {
        first_name: "",
        last_name: null,
        username: '"{}"',
      };

      const result = transformKeys(data, clerkHandler);
      expect(result).toEqual({});
    });

    test("preserves array values", () => {
      const data = {
        id: "user_123",
        verified_email_addresses: ["a@example.com", "b@example.com"],
        verified_phone_numbers: ["+1111111111", "+2222222222"],
      };

      const result = transformKeys(data, clerkHandler);

      expect(result.emailAddresses).toEqual(["a@example.com", "b@example.com"]);
      expect(result.phoneNumbers).toEqual(["+1111111111", "+2222222222"]);
    });

    test("preserves object values", () => {
      const data = {
        id: "user_123",
        public_metadata: { role: "admin", tier: "premium" },
        private_metadata: { internalId: 456 },
      };

      const result = transformKeys(data, clerkHandler);

      expect(result.publicMetadata).toEqual({ role: "admin", tier: "premium" });
      expect(result.privateMetadata).toEqual({ internalId: 456 });
    });

    test("handles special characters in values", () => {
      const data = {
        id: "user_123",
        first_name: "José",
        last_name: "O'Brien",
        username: "user@special!",
      };

      const result = transformKeys(data, clerkHandler);

      expect(result).toEqual({
        userId: "user_123",
        firstName: "José",
        lastName: "O'Brien",
        username: "user@special!",
      });
    });
  });
});
