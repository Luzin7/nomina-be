import { UserRole } from '@constants/enums';
import { ErrorPresenter } from '@infra/presenters/ErrorPresenter';
import { CategoryPresenter } from '@modules/category/presenters/Category.presenter';
import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentLoggedUser } from '@providers/auth/decorators/CurrentLoggedUser.decorator';
import { Idempotent } from '@providers/auth/decorators/Idempotency.decorator';
import { Roles } from '@providers/auth/decorators/Roles.decorator';
import { RolesGuard } from '@providers/auth/guards/Roles.guard';
import { type TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { statusCode } from '@shared/core/types/statusCode';
import {
  CreateCategoryPipe,
  type CreateCategoryRequest,
} from './create-category.dto';
import { CreateCategoryService } from './create-category.handler';

@ApiTags('Category')
@Controller('category')
@UseGuards(RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.USER)
export class CreateCategoryController {
  constructor(private readonly service: CreateCategoryService) {}

  @Post()
  @Idempotent()
  @HttpCode(statusCode.CREATED)
  async handle(
    @CurrentLoggedUser() { workspaceId }: TokenPayloadSchema,
    @Body(CreateCategoryPipe) body: CreateCategoryRequest,
  ) {
    const data = await this.service.execute({ ...body, workspaceId });

    if (data.isLeft()) {
      return ErrorPresenter.toHTTP(data.value);
    }

    return { data: CategoryPresenter.toHTTP(data.value) };
  }
}
