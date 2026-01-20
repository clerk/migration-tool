import { describe, expect, test } from "vitest";
import { detectInstanceType, getDefaultDelay, getDefaultRetryDelay, createEnvSchema } from "./envs-constants";

describe("envs-constants", () => {
  describe("detectInstanceType", () => {
    test("returns 'prod' for sk_live_ prefix", () => {
      expect(detectInstanceType("sk_live_abcdefghijklmnopqrstuvwxyz123456")).toBe("prod");
    });

    test("returns 'dev' for sk_test_ prefix", () => {
      expect(detectInstanceType("sk_test_abcdefghijklmnopqrstuvwxyz123456")).toBe("dev");
    });

    test("returns 'dev' for other prefixes", () => {
      expect(detectInstanceType("sk_prod_abcdefghijklmnopqrstuvwxyz123456")).toBe("dev");
      expect(detectInstanceType("sk_abcdefghijklmnopqrstuvwxyz123456")).toBe("dev");
    });

    test("returns 'dev' for keys without underscore", () => {
      expect(detectInstanceType("somekey")).toBe("dev");
    });

    test("returns 'dev' for empty string", () => {
      expect(detectInstanceType("")).toBe("dev");
    });
  });

  describe("getDefaultDelay", () => {
    test("returns 100 for production", () => {
      expect(getDefaultDelay("prod")).toBe(100);
    });

    test("returns 10 for dev", () => {
      expect(getDefaultDelay("dev")).toBe(10);
    });
  });

  describe("getDefaultRetryDelay", () => {
    test("returns 100 for production", () => {
      expect(getDefaultRetryDelay("prod")).toBe(100);
    });

    test("returns 1000 for dev", () => {
      expect(getDefaultRetryDelay("dev")).toBe(1000);
    });
  });

  describe("createEnvSchema", () => {
    test("returns a Zod schema object", () => {
      const schema = createEnvSchema(10, 1000);
      expect(schema).toBeDefined();
      expect(typeof schema.safeParse).toBe("function");
      expect(typeof schema.parse).toBe("function");
    });

    test("creates schema with custom default values", () => {
      const customDelay = 42;
      const customRetryDelay = 500;
      const schema = createEnvSchema(customDelay, customRetryDelay);

      const result = schema.safeParse({ CLERK_SECRET_KEY: "test" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.DELAY).toBe(customDelay);
        expect(result.data.RETRY_DELAY_MS).toBe(customRetryDelay);
      }
    });
  });

  describe("exported env object", () => {
    test("env object exists", async () => {
      const envModule = await import("./envs-constants");
      expect(envModule.env).toBeDefined();
    });

    test("env object has required fields with correct types", async () => {
      const envModule = await import("./envs-constants");

      expect(typeof envModule.env.CLERK_SECRET_KEY).toBe("string");
      expect(typeof envModule.env.DELAY).toBe("number");
      expect(typeof envModule.env.RETRY_DELAY_MS).toBe("number");
      expect(typeof envModule.env.OFFSET).toBe("number");
    });
  });

  describe("integration: instance type determines defaults", () => {
    test("production instance uses production defaults", () => {
      const secretKey = "sk_live_abcdefghijklmnopqrstuvwxyz123456";
      const instanceType = detectInstanceType(secretKey);
      const delay = getDefaultDelay(instanceType);
      const retryDelay = getDefaultRetryDelay(instanceType);

      expect(instanceType).toBe("prod");
      expect(delay).toBe(100);
      expect(retryDelay).toBe(100);

      const schema = createEnvSchema(delay, retryDelay);
      const result = schema.safeParse({ CLERK_SECRET_KEY: secretKey });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.DELAY).toBe(100);
        expect(result.data.RETRY_DELAY_MS).toBe(100);
      }
    });

    test("dev instance uses dev defaults", () => {
      const secretKey = "sk_test_abcdefghijklmnopqrstuvwxyz123456";
      const instanceType = detectInstanceType(secretKey);
      const delay = getDefaultDelay(instanceType);
      const retryDelay = getDefaultRetryDelay(instanceType);

      expect(instanceType).toBe("dev");
      expect(delay).toBe(10);
      expect(retryDelay).toBe(1000);

      const schema = createEnvSchema(delay, retryDelay);
      const result = schema.safeParse({ CLERK_SECRET_KEY: secretKey });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.DELAY).toBe(10);
        expect(result.data.RETRY_DELAY_MS).toBe(1000);
      }
    });
  });
});
