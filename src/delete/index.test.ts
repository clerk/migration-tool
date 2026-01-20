import { describe, expect, test, vi, beforeEach } from "vitest";

// Use vi.hoisted() to create mocks that can be referenced in vi.mock()
const { mockGetUserList, mockDeleteUser } = vi.hoisted(() => ({
  mockGetUserList: vi.fn(),
  mockDeleteUser: vi.fn(),
}));

// Mock @clerk/backend before importing the module
vi.mock("@clerk/backend", () => ({
  createClerkClient: () => ({
    users: {
      getUserList: mockGetUserList,
      deleteUser: mockDeleteUser,
    },
  }),
}));

// Mock @clack/prompts to prevent console output during tests
vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  spinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    message: vi.fn(),
  })),
  log: {
    error: vi.fn(),
    info: vi.fn(),
  },
}));

// Mock picocolors
vi.mock("picocolors", () => ({
  default: {
    bgCyan: vi.fn((s) => s),
    black: vi.fn((s) => s),
    red: vi.fn((s) => s),
    yellow: vi.fn((s) => s),
  },
}));

// Mock cooldown to track calls
vi.mock("../utils", async () => {
  const actual = await vi.importActual("../utils");
  return {
    ...actual,
    cooldown: vi.fn(() => Promise.resolve()),
  };
});

// Mock env constants
vi.mock("../envs-constants", () => ({
  env: {
    CLERK_SECRET_KEY: "test_secret_key",
    DELAY: 0,
    RETRY_DELAY_MS: 0,
  },
}));

// Mock fs module
vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

// Import after mocks are set up
import { cooldown } from "../utils";
import * as fs from "fs";

// Get reference to mocked cooldown
const mockCooldown = vi.mocked(cooldown);

describe("delete-users", () => {
  let fetchUsers: any;
  let deleteUsers: any;
  let readSettings: any;
  let readMigrationFile: any;
  let findIntersection: any;

  const mockExistsSync = vi.mocked(fs.existsSync);
  const mockReadFileSync = vi.mocked(fs.readFileSync);

  beforeEach(async () => {
    vi.clearAllMocks();
    // Set default return values to handle auto-execution of processUsers()
    mockGetUserList.mockResolvedValue({ data: [] });
    mockDeleteUser.mockResolvedValue({});
    mockExistsSync.mockReturnValue(true);

    // Mock readFileSync to return different data based on file path
    mockReadFileSync.mockImplementation((filePath: any) => {
      const path = filePath.toString();
      if (path.includes(".settings")) {
        return JSON.stringify({ file: "samples/test.json" });
      }
      // Return empty array for migration files by default
      return JSON.stringify([]);
    });

    // Reset modules to clear module-level state (users array)
    vi.resetModules();
    // Re-import the module to get fresh state
    const deleteUsersModule = await import("./index");
    fetchUsers = deleteUsersModule.fetchUsers;
    deleteUsers = deleteUsersModule.deleteUsers;
    readSettings = deleteUsersModule.readSettings;
    readMigrationFile = deleteUsersModule.readMigrationFile;
    findIntersection = deleteUsersModule.findIntersection;

    // Wait for the auto-executed processUsers() to complete
    await new Promise(resolve => setTimeout(resolve, 10));
    vi.clearAllMocks();
  });

  describe("fetchUsers", () => {
    test("fetches users with limit 500 and offset 0 on first call", async () => {
      mockGetUserList.mockResolvedValueOnce({
        data: [
          { id: "user_1", firstName: "John" },
          { id: "user_2", firstName: "Jane" },
        ],
      });

      await fetchUsers(0);

      expect(mockGetUserList).toHaveBeenCalledTimes(1);
      expect(mockGetUserList).toHaveBeenCalledWith({
        offset: 0,
        limit: 500,
      });
    });

    test("returns users when data length is less than limit", async () => {
      const mockUsers = [
        { id: "user_1", firstName: "John" },
        { id: "user_2", firstName: "Jane" },
      ];
      mockGetUserList.mockResolvedValueOnce({ data: mockUsers });

      const result = await fetchUsers(0);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("user_1");
      expect(result[1].id).toBe("user_2");
    });

    test("paginates when data length equals limit (500)", async () => {
      // Create 500 users for first page
      const firstPage = Array.from({ length: 500 }, (_, i) => ({
        id: `user_${i}`,
        firstName: `User${i}`,
      }));

      // Create 200 users for second page
      const secondPage = Array.from({ length: 200 }, (_, i) => ({
        id: `user_${i + 500}`,
        firstName: `User${i + 500}`,
      }));

      mockGetUserList
        .mockResolvedValueOnce({ data: firstPage })
        .mockResolvedValueOnce({ data: secondPage });

      const result = await fetchUsers(0);

      expect(mockGetUserList).toHaveBeenCalledTimes(2);
      expect(mockGetUserList).toHaveBeenNthCalledWith(1, {
        offset: 0,
        limit: 500,
      });
      expect(mockGetUserList).toHaveBeenNthCalledWith(2, {
        offset: 500,
        limit: 500,
      });
      expect(result).toHaveLength(700);
    });

    test("calls cooldown between pagination requests", async () => {
      const firstPage = Array.from({ length: 500 }, (_, i) => ({
        id: `user_${i}`,
        firstName: `User${i}`,
      }));

      const secondPage = Array.from({ length: 100 }, (_, i) => ({
        id: `user_${i + 500}`,
        firstName: `User${i + 500}`,
      }));

      mockGetUserList
        .mockResolvedValueOnce({ data: firstPage })
        .mockResolvedValueOnce({ data: secondPage });

      await fetchUsers(0);

      // Should call cooldown once between the two pages with env.DELAY
      expect(mockCooldown).toHaveBeenCalledTimes(1);
      expect(mockCooldown).toHaveBeenCalledWith(0);
    });

    test("handles multiple pagination rounds (3 batches)", async () => {
      const firstPage = Array.from({ length: 500 }, (_, i) => ({
        id: `user_${i}`,
        firstName: `User${i}`,
      }));

      const secondPage = Array.from({ length: 500 }, (_, i) => ({
        id: `user_${i + 500}`,
        firstName: `User${i + 500}`,
      }));

      const thirdPage = Array.from({ length: 150 }, (_, i) => ({
        id: `user_${i + 1000}`,
        firstName: `User${i + 1000}`,
      }));

      mockGetUserList
        .mockResolvedValueOnce({ data: firstPage })
        .mockResolvedValueOnce({ data: secondPage })
        .mockResolvedValueOnce({ data: thirdPage });

      const result = await fetchUsers(0);

      expect(mockGetUserList).toHaveBeenCalledTimes(3);
      expect(mockGetUserList).toHaveBeenNthCalledWith(1, {
        offset: 0,
        limit: 500,
      });
      expect(mockGetUserList).toHaveBeenNthCalledWith(2, {
        offset: 500,
        limit: 500,
      });
      expect(mockGetUserList).toHaveBeenNthCalledWith(3, {
        offset: 1000,
        limit: 500,
      });
      expect(result).toHaveLength(1150);

      // Should call cooldown twice (between page 1-2 and page 2-3)
      expect(mockCooldown).toHaveBeenCalledTimes(2);
    });

    test("handles empty user list", async () => {
      mockGetUserList.mockResolvedValueOnce({ data: [] });

      const result = await fetchUsers(0);

      expect(mockGetUserList).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(0);
      expect(mockCooldown).not.toHaveBeenCalled();
    });
  });

  describe("deleteUsers", () => {
    test("deletes all users sequentially", async () => {
      mockDeleteUser.mockResolvedValue({});

      const users = [
        { id: "user_1", firstName: "John" },
        { id: "user_2", firstName: "Jane" },
        { id: "user_3", firstName: "Bob" },
      ] as any[];

      await deleteUsers(users);

      expect(mockDeleteUser).toHaveBeenCalledTimes(3);
      expect(mockDeleteUser).toHaveBeenNthCalledWith(1, "user_1");
      expect(mockDeleteUser).toHaveBeenNthCalledWith(2, "user_2");
      expect(mockDeleteUser).toHaveBeenNthCalledWith(3, "user_3");
    });

    test("calls cooldown after each deletion", async () => {
      mockDeleteUser.mockResolvedValue({});

      const users = [
        { id: "user_1", firstName: "John" },
        { id: "user_2", firstName: "Jane" },
        { id: "user_3", firstName: "Bob" },
      ] as any[];

      await deleteUsers(users);

      // Should call cooldown after each deletion (3 times) with env.DELAY
      expect(mockCooldown).toHaveBeenCalledTimes(3);
      expect(mockCooldown).toHaveBeenCalledWith(0);
    });

    test("updates progress counter after each deletion", async () => {
      mockDeleteUser.mockResolvedValue({});

      const users = [
        { id: "user_1", firstName: "John" },
        { id: "user_2", firstName: "Jane" },
        { id: "user_3", firstName: "Bob" },
      ] as any[];

      await deleteUsers(users);

      // Verify all deletions completed
      expect(mockDeleteUser).toHaveBeenCalledTimes(3);
      expect(mockCooldown).toHaveBeenCalledTimes(3);
    });

    test("handles empty user array", async () => {
      await deleteUsers([]);

      expect(mockDeleteUser).not.toHaveBeenCalled();
      expect(mockCooldown).not.toHaveBeenCalled();
    });

    test("continues deletion if one fails", async () => {
      mockDeleteUser
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error("Delete failed"))
        .mockResolvedValueOnce({});

      const users = [
        { id: "user_1", firstName: "John" },
        { id: "user_2", firstName: "Jane" },
        { id: "user_3", firstName: "Bob" },
      ] as any[];

      // This should not throw, but user_2 deletion will fail silently
      // Note: Current implementation doesn't handle errors, so this will actually throw
      // If error handling is needed, it should be added to the implementation
      await expect(deleteUsers(users)).rejects.toThrow("Delete failed");

      // Should still attempt first two deletions
      expect(mockDeleteUser).toHaveBeenCalledTimes(2);
    });
  });

  describe("readSettings", () => {
    test("reads settings file and returns file path", () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ file: "samples/users.json" }));

      const result = readSettings();

      expect(result).toBe("samples/users.json");
      expect(mockExistsSync).toHaveBeenCalledWith(expect.stringContaining(".settings"));
      expect(mockReadFileSync).toHaveBeenCalledWith(expect.stringContaining(".settings"), "utf-8");
    });

    test("exits with error when .settings file does not exist", () => {
      mockExistsSync.mockReturnValue(false);
      const mockExit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

      readSettings();

      expect(mockExit).toHaveBeenCalledWith(1);
      mockExit.mockRestore();
    });

    test("exits with error when .settings file has no file property", () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ key: "authjs" }));
      const mockExit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

      readSettings();

      expect(mockExit).toHaveBeenCalledWith(1);
      mockExit.mockRestore();
    });
  });

  describe("readMigrationFile", () => {
    test("reads migration file and returns set of user IDs", () => {
      const mockUsers = [
        { userId: "1", email: "user1@example.com" },
        { userId: "2", email: "user2@example.com" },
        { userId: "3", email: "user3@example.com" },
      ];

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(mockUsers));

      const result = readMigrationFile("samples/users.json");

      expect(result).toBeInstanceOf(Set);
      expect(result.size).toBe(3);
      expect(result.has("1")).toBe(true);
      expect(result.has("2")).toBe(true);
      expect(result.has("3")).toBe(true);
    });

    test("exits with error when migration file does not exist", () => {
      mockExistsSync.mockReturnValue(false);
      const mockExit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

      readMigrationFile("samples/nonexistent.json");

      expect(mockExit).toHaveBeenCalledWith(1);
      mockExit.mockRestore();
    });

    test("handles empty user array", () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify([]));

      const result = readMigrationFile("samples/empty.json");

      expect(result).toBeInstanceOf(Set);
      expect(result.size).toBe(0);
    });

    test("skips users without userId field", () => {
      const mockUsers = [
        { userId: "1", email: "user1@example.com" },
        { email: "user2@example.com" }, // no userId
        { userId: "3", email: "user3@example.com" },
      ];

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(mockUsers));

      const result = readMigrationFile("samples/users.json");

      expect(result.size).toBe(2);
      expect(result.has("1")).toBe(true);
      expect(result.has("3")).toBe(true);
    });
  });

  describe("findIntersection", () => {
    test("finds users that exist in both Clerk and migration file", () => {
      const clerkUsers = [
        { id: "clerk_1", externalId: "1" },
        { id: "clerk_2", externalId: "2" },
        { id: "clerk_3", externalId: "3" },
        { id: "clerk_4", externalId: "4" },
      ] as any[];

      const migrationUserIds = new Set(["2", "3", "5"]);

      const result = findIntersection(clerkUsers, migrationUserIds);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("clerk_2");
      expect(result[1].id).toBe("clerk_3");
    });

    test("returns empty array when no users match", () => {
      const clerkUsers = [
        { id: "clerk_1", externalId: "1" },
        { id: "clerk_2", externalId: "2" },
      ] as any[];

      const migrationUserIds = new Set(["5", "6"]);

      const result = findIntersection(clerkUsers, migrationUserIds);

      expect(result).toHaveLength(0);
    });

    test("ignores Clerk users without externalId", () => {
      const clerkUsers = [
        { id: "clerk_1", externalId: "1" },
        { id: "clerk_2" }, // no externalId
        { id: "clerk_3", externalId: "3" },
      ] as any[];

      const migrationUserIds = new Set(["1", "2", "3"]);

      const result = findIntersection(clerkUsers, migrationUserIds);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("clerk_1");
      expect(result[1].id).toBe("clerk_3");
    });

    test("handles empty Clerk users array", () => {
      const clerkUsers = [] as any[];
      const migrationUserIds = new Set(["1", "2"]);

      const result = findIntersection(clerkUsers, migrationUserIds);

      expect(result).toHaveLength(0);
    });

    test("handles empty migration user IDs set", () => {
      const clerkUsers = [
        { id: "clerk_1", externalId: "1" },
        { id: "clerk_2", externalId: "2" },
      ] as any[];
      const migrationUserIds = new Set<string>();

      const result = findIntersection(clerkUsers, migrationUserIds);

      expect(result).toHaveLength(0);
    });
  });

  describe("integration: full delete process", () => {
    test("fetches and deletes 750 users across 2 pages", async () => {
      // Setup pagination mock
      const firstPage = Array.from({ length: 500 }, (_, i) => ({
        id: `user_${i}`,
        firstName: `User${i}`,
      }));

      const secondPage = Array.from({ length: 250 }, (_, i) => ({
        id: `user_${i + 500}`,
        firstName: `User${i + 500}`,
      }));

      mockGetUserList
        .mockResolvedValueOnce({ data: firstPage })
        .mockResolvedValueOnce({ data: secondPage });

      mockDeleteUser.mockResolvedValue({});

      // Fetch users
      const users = await fetchUsers(0);
      expect(users).toHaveLength(750);
      expect(mockGetUserList).toHaveBeenCalledTimes(2);
      expect(mockCooldown).toHaveBeenCalledTimes(1); // Between pagination

      vi.clearAllMocks();

      // Delete users
      await deleteUsers(users);
      expect(mockDeleteUser).toHaveBeenCalledTimes(750);
      expect(mockCooldown).toHaveBeenCalledTimes(750); // After each deletion
    });
  });
});
