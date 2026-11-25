import { UserRole } from '@constants/enums';
import { ErrorPresenter } from '@infra/presenters/ErrorPresenter';
import { WorkspacePresenter } from '@modules/workspace/presenters/Workspace.presenter';
import {
  Body,
  Controller,
  HttpCode,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentLoggedUser } from '@providers/auth/decorators/CurrentLoggedUser.decorator';
import { Roles } from '@providers/auth/decorators/Roles.decorator';
import { RolesGuard } from '@providers/auth/guards/Roles.guard';
import type { TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { statusCode } from '@shared/core/types/statusCode';
import {
  UpdateWorkspaceBodyPipe,
  type UpdateWorkspaceBodyRequest,
} from './update-workspace.dto';
import { UpdateWorkspaceService } from './update-workspace.service';

@ApiTags('Workspace')
@Controller('workspace')
@UseGuards(RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN)
export class UpdateWorkspaceController {
  constructor(private readonly service: UpdateWorkspaceService) {}

  @Put(':workspaceId')
  @HttpCode(statusCode.OK)
  async handle(
    @CurrentLoggedUser() user: TokenPayloadSchema,
    @Param('workspaceId') workspaceId: string,
    @Body(UpdateWorkspaceBodyPipe) body: UpdateWorkspaceBodyRequest,
  ) {
    const data = await this.service.execute({
      ...body,
      workspaceId,
      sub: user.sub,
    });

    if (data.isLeft()) {
      return ErrorPresenter.toHTTP(data.value);
    }

    return {
      data: WorkspacePresenter.toHTTP(data.value),
    };
  }
}
