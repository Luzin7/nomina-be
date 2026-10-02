import { setRefreshTokenCookie } from '@infra/http/cookies/authCookie';
import { ErrorPresenter } from '@infra/presenters/ErrorPresenter';
import { Body, Controller, HttpCode, Patch, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentLoggedUser } from '@providers/auth/decorators/CurrentLoggedUser.decorator';
import { type TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { statusCode } from '@shared/core/types/statusCode';
import type { Response } from 'express';
import {
  SwitchWorkspacePipe,
  type SwitchWorkspaceRequest,
} from './switch-workspace.dto';
import { SwitchWorkspaceService } from './switch-workspace.service';

@ApiTags('Workspace')
@Controller('workspace')
export class SwitchWorkspaceController {
  constructor(private readonly service: SwitchWorkspaceService) {}

  @Patch('switch')
  @HttpCode(statusCode.OK)
  @ApiOperation({
    summary: 'Trocar de workspace ativo',
    description:
      'Gera um novo par de tokens JWT (access + refresh) com o workspaceId atualizado, permitindo alternar entre workspaces sem fazer login novamente.',
  })
  @ApiResponse({
    status: statusCode.OK,
    description: 'Tokens gerados com sucesso',
  })
  @ApiResponse({
    status: statusCode.NOT_FOUND,
    description: 'Workspace não encontrado',
  })
  @ApiResponse({
    status: statusCode.FORBIDDEN,
    description: 'Usuário não tem acesso ao workspace',
  })
  async handle(
    @CurrentLoggedUser() { sub }: TokenPayloadSchema,
    @Body(SwitchWorkspacePipe) body: SwitchWorkspaceRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.service.execute({
      ...body,
      sub,
    });

    if (data.isLeft()) {
      return ErrorPresenter.toHTTP(data.value);
    }

    setRefreshTokenCookie(res, data.value.refreshToken);

    return {
      data: { accessToken: data.value.accessToken },
    };
  }
}
