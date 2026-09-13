import { UserRole } from '@constants/enums';
import { ErrorPresenter } from '@infra/presenters/ErrorPresenter';
import { CategoryPresenter } from '@modules/category/presenters/Category.presenter';
import { Controller, Get, HttpCode, Query, UseGuards } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentLoggedUser } from '@providers/auth/decorators/CurrentLoggedUser.decorator';
import { Roles } from '@providers/auth/decorators/Roles.decorator';
import { RolesGuard } from '@providers/auth/guards/Roles.guard';
import { type TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { statusCode } from '@shared/core/types/statusCode';
import {
  ListCategoriesPipe,
  type ListCategoriesRequest,
} from './list-categories.dto';
import { ListCategoriesService } from './list-categories.handler';

@ApiTags('Category')
@Controller('category')
@UseGuards(RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.USER, UserRole.VIEWER)
export class ListCategoriesController {
  constructor(private readonly service: ListCategoriesService) {}

  @Get()
  @HttpCode(statusCode.OK)
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, example: 20 })
  @ApiQuery({
    name: 'type',
    required: false,
    enum: ['INCOME', 'EXPENSE', 'TRANSFER'],
  })
  @ApiQuery({
    name: 'parentId',
    required: false,
    type: String,
    description:
      'Filtrar por categoria pai. "null" retorna raízes. Omite para listagem hierárquica completa.',
  })
  async handle(
    @CurrentLoggedUser() { workspaceId }: TokenPayloadSchema,
    @Query(ListCategoriesPipe) query: ListCategoriesRequest,
  ) {
    const data = await this.service.execute({
      ...query,
      workspaceId,
    });

    if (data.isLeft()) {
      return ErrorPresenter.toHTTP(data.value);
    }

    if (data.value.hierarchy) {
      const hierarchy = data.value.hierarchy;

      return {
        data: {
          categories: data.value.categories.map((parent) =>
            CategoryPresenter.toHTTPHierarchy(
              parent,
              hierarchy[parent.id] ?? [],
            ),
          ),
          total: data.value.total,
        },
      };
    }

    return {
      data: {
        categories: data.value.categories.map(CategoryPresenter.toHTTP),
        total: data.value.total,
      },
    };
  }
}
