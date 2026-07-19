/**
 * CKP 评审 v3.0 — AI 模块类型契约
 *
 * 与 51AC:18028 ai_pool 微服务返回的 JSON 完全对齐。
 * 调用前先调 /healthz 看 accounts[]，失败时降级（不阻塞业务）。
 */

// -------- /api/ai/review --------

export interface AiReviewRequest {
  selection: string;        // 用户选中的文本
  context: string;          // 文档上下文
  reviewMode?: 'URS' | 'FRS' | 'TC' | 'GENERAL';
}

export interface AiReviewItem {
  issue_type: '必改' | '建议' | '通过' | '疑问';
  severity: 'critical' | 'major' | 'minor' | 'info';
  summary: string;
  detail: string;
  suggestion: string;
  ref_standards: string[];
  confidence: number;       // 0.0 - 1.0
}

export interface AiReviewUsage {
  input_tokens: number;
  output_tokens: number;
}

export interface AiReviewResponse {
  success: boolean;
  review?: AiReviewItem;
  message?: string;
  usage?: AiReviewUsage;
  provider_used?: string;
  account_used?: number;
  model_used?: string;
}

// -------- /api/ai/summarize --------

export interface AiSummarizeRequest {
  title: string;
  comments: Array<{
    state: string;
    author: string;
    section: string;
    text: string;
  }>;
}

export interface AiSummarizeResponse {
  success: boolean;
  summary?: string;          // Markdown 格式
  message?: string;
  usage?: AiReviewUsage;
  provider_used?: string;
  account_used?: number;
  model_used?: string;
}

// -------- /api/ai/healthz --------

export interface AiHealthAccount {
  index: number;
  provider: string;
  model: string;
  available: boolean;
  fail_count: number;
  total_requests: number;
  total_failures: number;
}

export interface AiHealthResponse {
  status: 'ok' | 'unconfigured' | string;
  pool_configured: boolean;
  account_count: number;
  available_count: number;
  accounts: AiHealthAccount[];
}

// -------- 写回数据库的结构 --------

export interface AiReviewStored {
  issue_type: AiReviewItem['issue_type'];
  severity: AiReviewItem['severity'];
  summary: AiReviewItem['summary'];
  detail: AiReviewItem['detail'];
  suggestion: AiReviewItem['suggestion'];
  ref_standards: AiReviewItem['ref_standards'];
  confidence: AiReviewItem['confidence'];
}

export interface AiProviderInfo {
  provider?: string;
  model?: string;
  account_index?: number;
  input_tokens?: number;
  output_tokens?: number;
}
