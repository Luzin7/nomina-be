import { Controller, Get, HttpCode, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { TopExpensesByCategoryPresenter } from '@modules/report/presenters/TopExpensesByCategory.presenter';
import { CurrentLoggedUser } from '@providers/auth/decorators/CurrentLoggedUser.decorator';
import { type TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { statusCode } from '@shared/core/types/statusCode';
import {
  GetExpensesByCategoryPipe,
  type GetExpensesByCategoryRequest,
} from './get-expenses-by-category.dto';
import { GetExpensesByCategoryService } from './get-expenses-by-category.handler';

@ApiTags('Report')
@Controller('report')
export class GetExpensesByCategoryController {
  constructor(private readonly service: GetExpensesByCategoryService) {}

  @Get('expenses-by-category')
  @HttpCode(statusCode.OK)
  async handle(
    @CurrentLoggedUser() { workspaceId }: TokenPayloadSchema,
    @Query(GetExpensesByCategoryPipe) query: GetExpensesByCategoryRequest,
  ) {
    const data = await this.service.execute({
      ...query,
      workspaceId,
    });

    return { data: TopExpensesByCategoryPresenter.toHTTP(data) };
  }
}
