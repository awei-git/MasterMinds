import { readFileSync, readdirSync } from "fs";
import { join } from "path";

export type RoleName =
  | "idea"
  | "architect"
  | "character"
  | "writer"
  | "editor"
  | "continuity"
  | "reader"
  | "worldbuilder";

export interface Role {
  name: RoleName;
  systemPrompt: string;
}

const ROLES_DIR = join(process.cwd(), "agents", "roles");

const roleCache = new Map<string, Role>();

export function loadRole(name: RoleName): Role {
  const cached = roleCache.get(name);
  if (cached) return cached;

  const filePath = join(ROLES_DIR, `${name}.md`);
  const systemPrompt = readFileSync(filePath, "utf-8");
  const role: Role = { name, systemPrompt };
  roleCache.set(name, role);
  return role;
}

export function listRoles(): RoleName[] {
  return readdirSync(ROLES_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(".md", "") as RoleName);
}
