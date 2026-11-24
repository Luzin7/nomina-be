import { normalizeWorkspaceCycle } from '@constants/enums';
import * as schema from '@infra/databases/drizzle/schema';
import { Workspace } from '@modules/workspace/entities/Workspace';

type WorkspaceDrizzle = typeof schema.workspaces.$inferSelect;
type WorkspaceDrizzleInsert = typeof schema.workspaces.$inferInsert;

export class WorkspaceMapper {
  static toDomain(raw: WorkspaceDrizzle): Workspace {
    const result = Workspace.create(
      {
        name: raw.name,
        cycle: normalizeWorkspaceCycle(raw.cycle),
      },
      raw.id,
    );

    if (result.isLeft()) {
      throw result.value;
    }

    return result.value;
  }

  static toDatabase(entity: Workspace): WorkspaceDrizzleInsert {
    return {
      id: entity.id,
      name: entity.name,
    };
  }
}
