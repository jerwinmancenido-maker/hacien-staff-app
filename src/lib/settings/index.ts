// Prisma wiring for the versioned settings service.

import type { Prisma } from "@prisma/client";
import { db, type Db, type Tx } from "../db";
import { writeAudit } from "../audit";
import {
  getSettingsSnapshot as getSnapshotFromStore,
  getSettingsVersion as getVersionFromStore,
  saveSettingsSection as saveSectionToStore,
  type SettingsStore,
  type SettingsVersionRecord,
  type SaveSectionInput,
} from "./service";
import type { Settings, SettingsKey } from "./schema";

type Row = {
  id: string;
  version: number;
  data: Prisma.JsonValue;
  changedKey: string | null;
  before: Prisma.JsonValue;
  after: Prisma.JsonValue;
  effectiveFrom: Date;
  createdById: string | null;
};

const toRecord = (r: Row): SettingsVersionRecord => ({ ...r, data: r.data as unknown as Settings });

export function prismaSettingsStore(client: Db | Tx): SettingsStore {
  return {
    async latest() {
      const r = await client.settingsVersion.findFirst({ orderBy: { version: "desc" } });
      return r ? toRecord(r) : null;
    },
    async byId(id) {
      const r = await client.settingsVersion.findUnique({ where: { id } });
      return r ? toRecord(r) : null;
    },
    async create(input) {
      const r = await client.settingsVersion.create({
        data: {
          version: input.version,
          data: input.data as unknown as Prisma.InputJsonValue,
          changedKey: input.changedKey,
          before: (input.before ?? undefined) as Prisma.InputJsonValue | undefined,
          after: (input.after ?? undefined) as Prisma.InputJsonValue | undefined,
          createdById: input.createdById,
        },
      });
      return toRecord(r);
    },
  };
}

/** Current settings (latest version). New documents store `versionId` and keep using it. */
export function getSettingsSnapshot() {
  return getSnapshotFromStore(prismaSettingsStore(db));
}

/** Settings as they were in a given version (for documents created under it). */
export function getSettingsVersion(versionId: string) {
  return getVersionFromStore(prismaSettingsStore(db), versionId);
}

/** Save one section as a new version and write the audit row in the same transaction. */
export async function saveSettings<K extends SettingsKey>(input: SaveSectionInput<K>) {
  return db.$transaction(async (tx) => {
    const result = await saveSectionToStore(prismaSettingsStore(tx), input);
    if (result.ok && result.changed) {
      await writeAudit(tx, {
        userId: input.userId,
        entityType: "Settings",
        entityId: result.version.id,
        action: "settings_change",
        before: { [input.key]: result.version.before },
        after: { [input.key]: result.version.after },
        diff: false,
      });
    }
    return result;
  });
}
