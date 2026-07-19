/**
 * CKP 评审 v3.0 — AI 微服务客户端
 *
 * 通过 HTTP 调 51AC:18028 的 ai_pool 微服务（4 个端点）。
 * 不可用时降级返回空结果，不阻塞业务（Docmost 评论/评审仍能正常工作）。
 *
 * 配置（环境变量）：
 *   AI_POC_URL    51AC AI 微服务地址，默认 http://116.204.12.137:18028
 *   AI_POC_TIMEOUT 请求超时（秒），默认 30
 *   AI_POC_ENABLED 全局开关，默认 true（缺省即开启）
 */

import { HttpService } from '@nestjs/axios';
import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom, timeout, catchError, of } from 'rxjs';
import { AxiosError } from 'axios';
import {
  AiHealthResponse,
  AiProviderInfo,
  AiReviewResponse,
  AiReviewStored,
  AiSummarizeResponse,
} from './ai.types';

export interface AiReviewCallResult {
  ok: boolean;
  stored?: AiReviewStored;       // 写回 DB 的 JSON
  provider?: AiProviderInfo;     // 写回 DB 的元数据
  errorMessage?: string;
}

@Injectable()
export class AiPocClient implements OnModuleInit {
  private readonly logger = new Logger(AiPocClient.name);

  private baseUrl: string;
  private timeoutMs: number;
  private enabled: boolean;
  private healthChecked = false;
  private lastHealth?: AiHealthResponse;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    this.baseUrl = (this.config.get<string>('AI_POC_URL')
      ?? 'http://116.204.12.137:18028').replace(/\/+$/, '');
    this.timeoutMs = Number(this.config.get<string>('AI_POC_TIMEOUT') ?? 30) * 1000;
    this.enabled = (this.config.get<string>('AI_POC_ENABLED') ?? 'true') !== 'false';
    this.logger.log(
      `AI POC client init: baseUrl=${this.baseUrl}, timeout=${this.timeoutMs}ms, enabled=${this.enabled}`,
    );
  }

  // ---------- 端点封装 ----------

  /**
   * 段落级 AI 评审（核心高频端点）。
   * 评论创建时异步调用，写回 comments.ai_review_* 字段。
   */
  async reviewSelection(
    selection: string,
    context: string,
    reviewMode: 'URS' | 'FRS' | 'TC' | 'GENERAL' = 'GENERAL',
  ): Promise<AiReviewCallResult> {
    if (!this.enabled) return this.disabled();
    const resp = await this.post<AiReviewResponse>('/api/ai/review', {
      selection,
      context,
      reviewMode,
    });
    if (!resp.success || !resp.review) {
      return { ok: false, errorMessage: resp.message || 'AI service returned no review' };
    }
    return {
      ok: true,
      stored: {
        issue_type: resp.review.issue_type,
        severity: resp.review.severity,
        summary: resp.review.summary,
        detail: resp.review.detail,
        suggestion: resp.review.suggestion,
        ref_standards: resp.review.ref_standards ?? [],
        confidence: resp.review.confidence,
      },
      provider: {
        provider: resp.provider_used ?? null,
        model: resp.model_used ?? null,
        account_index: resp.account_used ?? null,
        input_tokens: resp.usage?.input_tokens ?? null,
        output_tokens: resp.usage?.output_tokens ?? null,
      },
    };
  }

  /**
   * 评审批 AI 总结（review session 关闭时调用）。
   */
  async summarizeReviewSession(
    title: string,
    comments: Array<{ state: string; author: string; section: string; text: string }>,
  ): Promise<{
    ok: boolean;
    markdown?: string;
    provider?: AiProviderInfo;
    errorMessage?: string;
  }> {
    if (!this.enabled) return { ok: false, errorMessage: 'AI service disabled' };
    const resp = await this.post<AiSummarizeResponse>('/api/ai/summarize', {
      title,
      comments,
    });
    if (!resp.success) {
      return { ok: false, errorMessage: resp.message || 'AI summary failed' };
    }
    return {
      ok: true,
      markdown: resp.summary,
      provider: {
        provider: resp.provider_used ?? null,
        model: resp.model_used ?? null,
        account_index: resp.account_used ?? null,
        input_tokens: resp.usage?.input_tokens ?? null,
        output_tokens: resp.usage?.output_tokens ?? null,
      },
    };
  }

  /**
   * 健康检查（队列 Listener / cron 探活用）。
   * 不抛异常；返回真实结果（包括 failed/unconfigured）。
   */
  async health(): Promise<AiHealthResponse | null> {
    try {
      const resp = await this.http.axiosRef.get<AiHealthResponse>(
        `${this.baseUrl}/healthz`,
        { timeout: 5000 },
      );
      this.healthChecked = true;
      this.lastHealth = resp.data;
      return resp.data;
    } catch (e) {
      this.logger.warn(`AI POC healthz unreachable: ${(e as Error).message}`);
      return null;
    }
  }

  isHealthy(): boolean {
    return !!this.lastHealth?.pool_configured && this.lastHealth.available_count > 0;
  }

  // ---------- 内部 ----------

  private async post<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    try {
      const obs$ = this.http
        .post<T>(url, body, { timeout: this.timeoutMs })
        .pipe(
          timeout(this.timeoutMs),
          catchError((err: AxiosError) => {
            this.logger.warn(
              `AI POC POST ${path} failed: ${err.message} (status=${err.response?.status})`,
            );
            throw new ServiceUnavailableException(
              `AI POC unreachable: ${err.message}`,
            );
          }),
        );
      const resp = await firstValueFrom(obs$);
      return resp.data;
    } catch (e) {
      throw e;
    }
  }

  private disabled(): AiReviewCallResult {
    return { ok: false, errorMessage: 'AI service disabled by AI_POC_ENABLED=false' };
  }
}
