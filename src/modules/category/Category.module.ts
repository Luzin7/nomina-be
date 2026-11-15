import { DatabaseModule } from '@infra/databases/Database.module';
import { Module } from '@nestjs/common';
import { CreateCategoryController } from './features/create-category/create-category.controller';
import { CreateCategoryService } from './features/create-category/create-category.handler';
import { DeleteCategoryController } from './features/delete-category/delete-category.controller';
import { DeleteCategoryService } from './features/delete-category/delete-category.handler';
import { ListCategoriesController } from './features/list-categories/list-categories.controller';
import { ListCategoriesService } from './features/list-categories/list-categories.handler';
import { UpdateCategoryController } from './features/update-category/update-category.controller';
import { UpdateCategoryService } from './features/update-category/update-category.handler';

@Module({
  imports: [DatabaseModule],
  controllers: [
    ListCategoriesController,
    CreateCategoryController,
    UpdateCategoryController,
    DeleteCategoryController,
  ],
  providers: [
    ListCategoriesService,
    CreateCategoryService,
    UpdateCategoryService,
    DeleteCategoryService,
  ],
  exports: [ListCategoriesService],
})
export class CategoryModule {}
