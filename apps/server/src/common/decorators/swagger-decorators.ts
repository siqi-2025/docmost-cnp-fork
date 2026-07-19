import { SetMetadata } from '@nestjs/common';

/**
 * CKP 评审 v3.0 — Swagger 装饰器本地 shim
 *
 * Docmost fork 当前未安装 @nestjs/swagger，CKP 项目铁律要求 Swagger 注解。
 * 此模块用 SetMetadata 提供与 @nestjs/swagger 同名 API，等真正接入 swagger 时
 * 全局替换为 `import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'`
 * 即可，业务代码无需改动。
 *
 * 仅提供 controller 上需要的最小子集：
 *   - ApiTags(tags)
 *   - ApiOperation({ operationId, summary })
 *   - ApiResponse({ status, description })
 */

export interface ApiOperationOptions {
  operationId?: string;
  summary?: string;
  description?: string;
  deprecated?: boolean;
}

export interface ApiResponseOptions {
  status: number;
  description?: string;
}

export const CKP_API_TAGS = 'ckp:api:tags';
export const CKP_API_OPERATION = 'ckp:api:operation';
export const CKP_API_RESPONSE = 'ckp:api:response';

/**
 * 等价于 @ApiTags('xxx')
 */
export function ApiTags(tags: string | string[]): MethodDecorator & ClassDecorator {
  const list = Array.isArray(tags) ? tags : [tags];
  return (target: any, key?: any, descriptor?: any) => {
    if (key === undefined) {
      // 类装饰器
      Reflect.defineMetadata(CKP_API_TAGS, list, target);
    } else {
      Reflect.defineMetadata(CKP_API_TAGS, list, descriptor.value);
    }
  };
}

/**
 * 等价于 @ApiOperation({ operationId, summary, description })
 */
export function ApiOperation(options: ApiOperationOptions): MethodDecorator {
  return (target: any, key: string | symbol, descriptor: PropertyDescriptor) => {
    Reflect.defineMetadata(CKP_API_OPERATION, options, descriptor.value);
  };
}

/**
 * 等价于 @ApiResponse({ status, description }) —— 可重复使用，每个 status 一条
 */
export function ApiResponse(options: ApiResponseOptions): MethodDecorator {
  return (target: any, key: string | symbol, descriptor: PropertyDescriptor) => {
    const existing: ApiResponseOptions[] =
      Reflect.getMetadata(CKP_API_RESPONSE, descriptor.value) ?? [];
    existing.push(options);
    Reflect.defineMetadata(CKP_API_RESPONSE, existing, descriptor.value);
  };
}