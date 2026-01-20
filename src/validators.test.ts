import { describe, expect, test } from "vitest";
import { userSchema } from "./validators";
import { PASSWORD_HASHERS } from "./types";

describe("userSchema", () => {
  describe("userId (required)", () => {
    test("passes with userId and email", () => {
      const result = userSchema.safeParse({ userId: "user_123", email: "test@example.com" });
      expect(result.success).toBe(true);
    });

    test("passes with userId and phone", () => {
      const result = userSchema.safeParse({ userId: "user_123", phone: "+1234567890" });
      expect(result.success).toBe(true);
    });

    test("fails when userId is missing", () => {
      const result = userSchema.safeParse({ email: "test@example.com" });
      expect(result.success).toBe(false);
    });

    test("fails with only userId (no email or phone)", () => {
      const result = userSchema.safeParse({ userId: "user_123" });
      expect(result.success).toBe(false);
    });
  });

  describe("email or phone requirement", () => {
    test("passes with email only", () => {
      const result = userSchema.safeParse({
        userId: "user_123",
        email: "test@example.com",
      });
      expect(result.success).toBe(true);
    });

    test("passes with phone only", () => {
      const result = userSchema.safeParse({
        userId: "user_123",
        phone: "+1234567890",
      });
      expect(result.success).toBe(true);
    });

    test("passes with emailAddresses only", () => {
      const result = userSchema.safeParse({
        userId: "user_123",
        emailAddresses: "test@example.com",
      });
      expect(result.success).toBe(true);
    });

    test("passes with phoneNumbers only", () => {
      const result = userSchema.safeParse({
        userId: "user_123",
        phoneNumbers: "+1234567890",
      });
      expect(result.success).toBe(true);
    });

    test("fails without email or phone", () => {
      const result = userSchema.safeParse({
        userId: "user_123",
        firstName: "John",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("email field", () => {
    test("passes with email as string", () => {
      const result = userSchema.safeParse({
        userId: "user_123",
        email: "test@example.com",
      });
      expect(result.success).toBe(true);
    });

    test("passes with email as array", () => {
      const result = userSchema.safeParse({
        userId: "user_123",
        email: ["test@example.com", "other@example.com"],
      });
      expect(result.success).toBe(true);
    });

    test("fails with invalid email string", () => {
      const result = userSchema.safeParse({
        userId: "user_123",
        email: "not-an-email",
        phone: "+1234567890", // need valid contact method
      });
      expect(result.success).toBe(false);
    });

    test("fails with invalid email in array", () => {
      const result = userSchema.safeParse({
        userId: "user_123",
        email: ["valid@example.com", "not-an-email"],
        phone: "+1234567890", // need valid contact method
      });
      expect(result.success).toBe(false);
    });
  });

  describe("passwordHasher enum", () => {
    test.each(PASSWORD_HASHERS)("passes with valid hasher: %s", (hasher) => {
      const result = userSchema.safeParse({
        userId: "user_123",
        email: "test@example.com",
        password: "hashed_password",
        passwordHasher: hasher,
      });
      expect(result.success).toBe(true);
    });

    test("fails with invalid passwordHasher", () => {
      const result = userSchema.safeParse({
        userId: "user_123",
        email: "test@example.com",
        password: "hashed_password",
        passwordHasher: "invalid_hasher",
      });
      expect(result.success).toBe(false);
    });

    test("fails when password provided without passwordHasher", () => {
      const result = userSchema.safeParse({
        userId: "user_123",
        email: "test@example.com",
        password: "hashed_password",
      });
      expect(result.success).toBe(false);
    });

    test("passes without password or passwordHasher (with email)", () => {
      const result = userSchema.safeParse({
        userId: "user_123",
        email: "test@example.com",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("phone fields", () => {
    test("passes with phone as array", () => {
      const result = userSchema.safeParse({
        userId: "user_123",
        phone: ["+1234567890"],
      });
      expect(result.success).toBe(true);
    });

    test("passes with phone as string", () => {
      const result = userSchema.safeParse({
        userId: "user_123",
        phone: "+1234567890",
      });
      expect(result.success).toBe(true);
    });

    test("passes with phoneNumbers as array", () => {
      const result = userSchema.safeParse({
        userId: "user_123",
        phoneNumbers: ["+1234567890", "+0987654321"],
      });
      expect(result.success).toBe(true);
    });

    test("passes without phone when email provided", () => {
      const result = userSchema.safeParse({
        userId: "user_123",
        email: "test@example.com",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("boolean fields", () => {

    test("passes with backupCodesEnabled boolean", () => {
      const result = userSchema.safeParse({
        userId: "user_123",
        email: "test@example.com",
        backupCodesEnabled: false,
      });
      expect(result.success).toBe(true);
    });
  });

  describe("full user object", () => {
    test("passes with all valid fields", () => {
      const result = userSchema.safeParse({
        userId: "user_123",
        email: ["primary@example.com", "secondary@example.com"],
        username: "johndoe",
        firstName: "John",
        lastName: "Doe",
        password: "$2a$10$hashedpassword",
        passwordHasher: "bcrypt",
        phone: ["+1234567890"],
        totpSecret: "JBSWY3DPEHPK3PXP",
        backupCodesEnabled: true,
        backupCodes: "code1,code2,code3",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.userId).toBe("user_123");
        expect(result.data.email).toEqual(["primary@example.com", "secondary@example.com"]);
      }
    });
  });
});
