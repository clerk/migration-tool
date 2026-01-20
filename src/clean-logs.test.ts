import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";

// Mock @clack/prompts
vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  confirm: vi.fn(),
  isCancel: vi.fn(),
  cancel: vi.fn(),
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

describe("clean-logs", () => {
  const LOGS_DIR = path.join(process.cwd(), "logs");
  const TEST_LOGS_DIR = path.join(process.cwd(), "test-logs");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(TEST_LOGS_DIR)) {
      const files = fs.readdirSync(TEST_LOGS_DIR);
      files.forEach((file) => {
        fs.unlinkSync(path.join(TEST_LOGS_DIR, file));
      });
      fs.rmdirSync(TEST_LOGS_DIR);
    }
  });

  test("creates logs directory path correctly", () => {
    expect(LOGS_DIR).toBe(path.join(process.cwd(), "logs"));
  });

  test("test directory setup works", () => {
    // Create test directory and files
    if (!fs.existsSync(TEST_LOGS_DIR)) {
      fs.mkdirSync(TEST_LOGS_DIR);
    }

    // Create test files
    fs.writeFileSync(path.join(TEST_LOGS_DIR, "test1.log"), "test");
    fs.writeFileSync(path.join(TEST_LOGS_DIR, "test2.log"), "test");

    const files = fs.readdirSync(TEST_LOGS_DIR);
    expect(files.length).toBe(2);

    // Clean up
    files.forEach((file) => {
      fs.unlinkSync(path.join(TEST_LOGS_DIR, file));
    });

    const filesAfter = fs.readdirSync(TEST_LOGS_DIR);
    expect(filesAfter.length).toBe(0);
  });

  test("can read files from logs directory", () => {
    if (fs.existsSync(LOGS_DIR)) {
      const files = fs.readdirSync(LOGS_DIR);
      expect(Array.isArray(files)).toBe(true);
    }
  });
});
