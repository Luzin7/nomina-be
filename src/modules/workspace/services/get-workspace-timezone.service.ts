import { DEFAULT_TIMEZONE } from '@constants/timezone';
import { Injectable } from '@nestjs/common';
import { WorkspaceRepository } from '../repositories/contracts/WorkspaceRepository';

@Injectable()
export class GetWorkspaceTimezoneService {
  constructor(private readonly workspaceRepository: WorkspaceRepository) {}

  async execute(workspaceId: string): Promise<string> {
    const timezone =
      await this.workspaceRepository.findTimezoneById(workspaceId);

    return timezone ?? DEFAULT_TIMEZONE;
  }
}
