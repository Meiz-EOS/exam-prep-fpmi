import { BuiltPackSchema, type BuiltPack } from "./schema.ts";

export function loadPack(json: unknown): BuiltPack {
  return BuiltPackSchema.parse(json);
}
