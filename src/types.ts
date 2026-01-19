import { ClerkAPIError } from "@clerk/types";
import { handlers } from "./handlers";
import { userSchema } from "./validators";
import * as z from "zod";

export type User = z.infer<typeof userSchema>;

// emulate what Clack CLI expects for an option in a Select / MultiSelect
export type OptionType = {
  value: string;
  label: string | undefined;
  hint?: string | undefined;
};

// create union of string literals from handlers transformer object keys
export type HandlerMapKeys = (typeof handlers)[number]["key"];

// create a union of all transformer objects in handlers array
export type HandlerMapUnion = (typeof handlers)[number];

export type ErrorPayload = {
  userId: string;
  status: string;
  errors: ClerkAPIError[];
};

export type ValidationErrorPayload = {
  error: string;
  path: (string | number)[];
  id: string;
  row: number;
};

export type ErrorLog = {
  type: string;
  userId: string;
  status: string;
  error: string | undefined;
};

export type ImportLogEntry = {
  userId: string;
  status: "success" | "error";
  error?: string;
};

export type ImportSummary = {
  totalProcessed: number;
  successful: number;
  failed: number;
  errorBreakdown: Map<string, number>;
};
