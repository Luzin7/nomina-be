import { UserRole } from '@constants/enums';
import { ErrorPresenter } from '@infra/presenters/ErrorPresenter';
import { CategoryPresenter } from '@modules/category/presenters/Category.presenter';
import {
  Body,
  Controller,
  HttpCode,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentLoggedUser } from '@providers/auth/decorators/CurrentLoggedUser.decorator';
import { Idempotent } from '@providers/auth/decorators/Idempotency.decorator';
import { Roles } from '@providers/auth/decorators/Roles.decorator';
import { RolesGuard } from '@providers/auth/guards/Roles.guard';
import { type TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { statusCode } from '@shared/core/types/statusCode';
import {
  UpdateCategoryParamsPipe,
  UpdateCategoryPipe,
  type UpdateCategoryParams,
  type UpdateCategoryRequest,
} from './update-category.dto';
import { UpdateCategoryService } from './update-category.handler';

@ApiTags('Category')
@Controller('category')
@UseGuards(RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.USER)
export class UpdateCategoryController {
  constructor(private readonly service: UpdateCategoryService) {}

  @Patch(':id')
  @Idempotent()
  @HttpCode(statusCode.OK)
  async handle(
    @CurrentLoggedUser() { workspaceId }: TokenPayloadSchema,
    @Param(UpdateCategoryParamsPipe) { id }: UpdateCategoryParams,
    @Body(UpdateCategoryPipe) body: UpdateCategoryRequest,
  ) {
    const data = await this.service.execute({ ...body, id, workspaceId });

    if (data.isLeft()) {
      return ErrorPresenter.toHTTP(data.value);
    }

    return { data: CategoryPresenter.toHTTP(data.value) };
  }
}
