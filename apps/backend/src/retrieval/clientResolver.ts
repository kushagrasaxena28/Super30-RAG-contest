import { prisma } from "../db/prisma.js";
import type { Client } from "@prisma/client";

/** Case-insensitive lookup - used by query analysis to resolve an entity
 * name the model extracted into a real Client row (see plan/05). */
export async function findClientByName(name: string): Promise<Client | null> {
  return prisma.client.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
}

export async function listClientNames(): Promise<string[]> {
  const clients = await prisma.client.findMany({ select: { name: true }, orderBy: { name: "asc" } });
  return clients.map((c) => c.name);
}

/**
 * Case-insensitive resolve-or-create, used during ingestion identity
 * resolution (see plan/02-ingestion.md). clientId is the join key
 * everywhere; the name string is display only.
 */
export async function resolveOrCreateClient(name: string): Promise<string> {
  const existing = await findClientByName(name);
  if (existing) return existing.id;
  const created = await prisma.client.create({ data: { name } });
  return created.id;
}
