import { describe, expect, test, vi, beforeEach, beforeAll } from "vitest";

// Mock @clerk/backend before importing the module
const mockGetUserList = vi.fn();
const mockDeleteUser = vi.fn();
vi.mock("@clerk/backend", () => ({
  createClerkClient: vi.fn(() => ({
    users: {
      getUserList: mockGetUserList,
      deleteUser: mockDeleteUser,
    },
  })),
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
}));

// Mock picocolors
vi.mock("picocolors", () => ({
  default: {
    bgCyan: vi.fn((s) => s),
    black: vi.fn((s) => s),
  },
}));

// Mock cooldown to speed up tests
vi.mock("./utils", async () => {
  const actual = await vi.importActual("./utils");
  return {
    ...actual,
    cooldown: vi.fn(() => Promise.resolve()),
  };
});

// Mock env constants
vi.mock("./envs-constants", () => ({
  env: {
    CLERK_SECRET_KEY: "test_secret_key",
  },
}));

// NOTE: delete-users.ts calls processUsers() at module level (line 63),
// which makes isolated testing difficult. These tests verify the module
// loads correctly with mocks and the basic structure is testable.
// For full integration testing, the auto-execution should be removed
// from the module and called explicitly from the CLI entry point.

describe("delete-users module", () => {
  beforeAll(() => {
    // Setup default mock responses before module loads
    mockGetUserList.mockResolvedValue({
      data: [
        { id: "user_1", firstName: "John" },
        { id: "user_2", firstName: "Jane" },
      ],
      totalCount: 2,
    });
    mockDeleteUser.mockResolvedValue({});
  });

  test("module exports processUsers function", async () => {
    const module = await import("./delete-users");
    expect(module.processUsers).toBeDefined();
    expect(typeof module.processUsers).toBe("function");
  });

  test("getUserList is called when module executes", async () => {
    // Module auto-executes processUsers() on import
    await import("./delete-users");

    // Wait for async operations to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(mockGetUserList).toHaveBeenCalled();
    expect(mockGetUserList).toHaveBeenCalledWith(
      expect.objectContaining({
        offset: 0,
        limit: 500,
      })
    );
  });

  test("deleteUser is called for fetched users", async () => {
    await import("./delete-users");

    // Wait for async operations to complete
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Should attempt to delete the users returned by getUserList
    expect(mockDeleteUser).toHaveBeenCalled();
  });
});

describe("delete-users behavior documentation", () => {
  // These tests document expected behavior for when the module
  // is refactored to not auto-execute

  test.todo("fetchUsers should paginate when users exceed LIMIT (500)");
  // Implementation: getUserList should be called multiple times
  // with increasing offsets until all users are fetched

  test.todo("fetchUsers should include cooldown between pagination requests");
  // Implementation: cooldown(1000) should be called between pages

  test.todo("deleteUsers should delete all users sequentially");
  // Implementation: deleteUser should be called for each user
  // with cooldown between each deletion

  test.todo("deleteUsers should update progress counter correctly");
  // Implementation: spinner.message should show progress [count/total]
});
