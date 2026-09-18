import { TransactionType } from '@constants/enums';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { Category } from '@modules/category/entities/Category';
import { CategoryRepository } from '@modules/category/repositories/contracts/CategoryRepository';
import { Injectable } from '@nestjs/common';
import { TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { Service } from '@shared/core/contracts/Service';
import { Either, right } from '@shared/core/errors/Either';
import { ListCategoriesRequest } from './list-categories.dto';

type Request = ListCategoriesRequest & Pick<TokenPayloadSchema, 'workspaceId'>;

type FlatResponse = {
  categories: Category[];
  total: number;
  hierarchy?: undefined;
};

type HierarchyResponse = {
  categories: Category[];
  total: number;
  hierarchy: Record<string, Category[]>;
};

type Response = FlatResponse | HierarchyResponse;

interface CategoryCacheData {
  id: string;
  workspaceId: string | null;
  name: string;
  type: string;
  parentId: string | null;
  isSystemCategory: boolean;
}

interface CachePayload {
  categories: CategoryCacheData[];
  total: number;
  hierarchy: Record<string, CategoryCacheData[]> | null;
}

const CACHE_TTL = 300;

@Injectable()
export class ListCategoriesService implements Service<
  Request,
  Error,
  Response
> {
  constructor(
    private readonly categoryRepository: CategoryRepository,
    private readonly redisService: CacheProvider,
  ) {}

  async execute(request: Request): Promise<Either<Error, Response>> {
    const cached = await this.redisService.get(this.buildCacheKey(request));
    if (cached) {
      return right(this.deserializeResponse(JSON.parse(cached)));
    }

    const response = await this.fetchAndProcess(request);
    if (response.isRight()) {
      await this.redisService.set(
        this.buildCacheKey(request),
        this.serializeResponse(response.value),
        CACHE_TTL,
      );
    }

    return response;
  }

  private async fetchAndProcess({
    workspaceId,
    page,
    pageSize,
    type,
    parentId,
  }: Request): Promise<Either<Error, Response>> {
    if (parentId !== undefined) {
      const result = await this.categoryRepository.findManyByWorkspaceId(
        workspaceId,
        {
          type,
          parentId: parentId === 'null' ? null : parentId,
        },
        page,
        pageSize,
      );

      return right(result);
    }

    const { categories, usageCounts } =
      await this.categoryRepository.findManyByWorkspaceId(workspaceId, {
        type,
      });

    const parents: Category[] = [];
    const childrenByParentId: Record<string, Category[]> = {};

    for (const category of categories) {
      if (!category.parentId) {
        parents.push(category);
        continue;
      }

      const parentKey = category.parentId;
      if (!childrenByParentId[parentKey]) {
        childrenByParentId[parentKey] = [];
      }
      childrenByParentId[parentKey].push(category);
    }

    for (const parentIdKey of Object.keys(childrenByParentId)) {
      childrenByParentId[parentIdKey].sort((a, b) => {
        const usageA = usageCounts[a.id] ?? 0;
        const usageB = usageCounts[b.id] ?? 0;
        return usageB !== usageA
          ? usageB - usageA
          : a.name.localeCompare(b.name);
      });
    }

    parents.sort((a, b) => {
      const sumA = (childrenByParentId[a.id] ?? []).reduce(
        (sum, c) => sum + (usageCounts[c.id] ?? 0),
        0,
      );
      const sumB = (childrenByParentId[b.id] ?? []).reduce(
        (sum, c) => sum + (usageCounts[c.id] ?? 0),
        0,
      );
      return sumB !== sumA ? sumB - sumA : a.name.localeCompare(b.name);
    });

    return right({
      categories: parents,
      total: parents.length,
      hierarchy: childrenByParentId,
    });
  }

  private buildCacheKey({
    workspaceId,
    type,
    parentId,
    page,
    pageSize,
  }: Request): string {
    return `categories:list:${workspaceId}:t=${type ?? ''}:p=${parentId ?? 'none'}:${page}:${pageSize}`;
  }

  private serializeResponse(response: Response): string {
    const toCache = (c: Category): CategoryCacheData => ({
      id: c.id,
      workspaceId: c.workspaceId,
      name: c.name,
      type: c.type,
      parentId: c.parentId,
      isSystemCategory: c.isSystemCategory,
    });

    const payload: CachePayload = {
      categories: response.categories.map(toCache),
      total: response.total,
      hierarchy: response.hierarchy
        ? Object.fromEntries(
            Object.entries(response.hierarchy).map(([key, children]) => [
              key,
              children.map(toCache),
            ]),
          )
        : null,
    };

    return JSON.stringify(payload);
  }

  private deserializeResponse(payload: CachePayload): Response {
    const reconstitute = (data: CategoryCacheData): Category =>
      Category.reconstitute(
        {
          workspaceId: data.workspaceId,
          name: data.name,
          type: data.type as TransactionType,
          parentId: data.parentId,
          isSystemCategory: data.isSystemCategory,
        },
        data.id,
      );

    const categories = payload.categories.map(reconstitute);

    if (!payload.hierarchy) {
      return { categories, total: payload.total };
    }

    const hierarchy: Record<string, Category[]> = {};
    for (const [key, children] of Object.entries(payload.hierarchy)) {
      hierarchy[key] = children.map(reconstitute);
    }

    return { categories, total: payload.total, hierarchy };
  }
}
