import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as { footballVisionPrisma?: PrismaClient };

export function getPrisma(): PrismaClient {
  if (!globalForPrisma.footballVisionPrisma) {
    globalForPrisma.footballVisionPrisma = new PrismaClient();
  }
  return globalForPrisma.footballVisionPrisma;
}
