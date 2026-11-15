import { UserRole } from '@constants/enums';
import { ErrorPresenter } from '@infra/presenters/ErrorPresenter';
import { Controller, Delete, HttpCode, Param, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentLoggedUser } from '@providers/auth/decorators/CurrentLoggedUser.decorator';
import { Roles } from '@providers/auth/decorators/Roles.decorator';
import { RolesGuard } from '@providers/auth/guards/Roles.guard';
import { type TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { statusCode } from '@shared/core/types/statusCode';
import {
  DeleteCategoryPipe,
  type DeleteCategoryRequest,
} from './delete-category.dto';
import { DeleteCategoryService } from './delete-category.handler';

@ApiTags('Category')
@Controller('category')
@UseGuards(RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.USER)
export class DeleteCategoryController {
  constructor(private readonly service: DeleteCategoryService) {}

  @Delete(':id')
  @HttpCode(statusCode.OK)
  async handle(
    @CurrentLoggedUser() { workspaceId }: TokenPayloadSchema,
    @Param(DeleteCategoryPipe) { id }: DeleteCategoryRequest,
  ) {
    const data = await this.service.execute({ id, workspaceId });

    if (data.isLeft()) {
      return ErrorPresenter.toHTTP(data.value);
    }
  }
}
