import { TransactionType } from '@constants/enums';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { Category } from '@modules/category/entities/Category';
import {
  CategoryRepository,
  CategoryVisibility,
} from '@modules/category/repositories/contracts/CategoryRepository';
import {
  CATEGORIES_CACHE_TTL_SECONDS,
  buildCategoryListCacheKey,
  readCategoryGeneration,
} from '@modules/category/services/category-list-cache';
import { Injectable } from '@nestjs/common';
import { TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { readThrough } from '@shared/cache/read-through';
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
  isHidden: boolean;
}

interface CachePayload {
  categories: CategoryCacheData[];
  total: number;
  hierarchy: Record<string, CategoryCacheData[]> | null;
}

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
    const generation = await readCategoryGeneration(
      this.redisService,
      request.workspaceId,
    );
    const cacheKey =
      generation === null
        ? null
        : buildCategoryListCacheKey(request, generation);

    return readThrough({
      cache: this.redisService,
      key: cacheKey,
      ttlSeconds: CATEGORIES_CACHE_TTL_SECONDS,
      codec: {
        encode: (value) => this.serializeResponse(value),
        decode: (raw) => this.deserializeResponse(JSON.parse(raw)),
      },
      load: () => this.fetchAndProcess(request),
    });
  }

  private async fetchAndProcess({
    workspaceId,
    page,
    pageSize,
    type,
    parentId,
    hidden,
  }: Request): Promise<Either<Error, Response>> {
    const visibility = toVisibility(hidden);

    if (parentId !== undefined) {
      const { categories, total } =
        await this.categoryRepository.findManyByWorkspaceId(
          workspaceId,
          {
            type,
            parentId: parentId === 'null' ? null : parentId,
            visibility,
          },
          page,
          pageSize,
        );

      return right({ categories, total });
    }

    const { categories, usageCounts } =
      await this.categoryRepository.findManyByWorkspaceId(workspaceId, {
        type,
        visibility,
      });

    return right(this.buildHierarchy(categories, usageCounts));
  }

  private buildHierarchy(
    categories: Category[],
    usageCounts: Record<string, number>,
  ): HierarchyResponse {
    const rootIds = new Set(
      categories
        .filter((category) => !category.parentId)
        .map((category) => category.id),
    );

    const parents: Category[] = [];
    const childrenByParentId: Record<string, Category[]> = {};

    for (const category of categories) {
      if (category.parentId !== null && rootIds.has(category.parentId)) {
        childrenByParentId[category.parentId] ??= [];
        childrenByParentId[category.parentId].push(category);
        continue;
      }

      parents.push(category);
    }

    for (const parentId of Object.keys(childrenByParentId)) {
      childrenByParentId[parentId].sort((a, b) => {
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

    return {
      categories: parents,
      total: parents.length,
      hierarchy: childrenByParentId,
    };
  }

  private serializeResponse(response: Response): string {
    const toCache = (c: Category): CategoryCacheData => ({
      id: c.id,
      workspaceId: c.workspaceId,
      name: c.name,
      type: c.type,
      parentId: c.parentId,
      isSystemCategory: c.isSystemCategory,
      isHidden: c.isHidden,
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
          isHidden: data.isHidden ?? false,
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

function toVisibility(
  hidden: ListCategoriesRequest['hidden'],
): CategoryVisibility {
  return hidden === 'all' ? 'all' : 'visible';
}
