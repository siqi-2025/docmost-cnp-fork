import { IUser } from "@/features/user/types/user.types";
import { QueryParams } from "@/lib/types.ts";

// --- AI review (cnp review enhancement) -------------------------------

export type AiReviewStatus =
  | "pending"
  | "reviewing"
  | "completed"
  | "failed"
  | "skipped";

export type AiReviewIssueType = "必改" | "建议" | "通过" | "疑问";

export type AiReviewSeverity = "critical" | "major" | "minor" | "info";

export interface AiReviewSuggestion {
  issue_type: AiReviewIssueType;
  severity: AiReviewSeverity;
  summary: string;
  detail: string;
  suggestion: string;
  ref_standards: string[];
  confidence: number; // 0-1
}

export interface AiReviewAccount {
  provider: string;
  model: string;
  account_index: number;
  input_tokens?: number;
  output_tokens?: number;
}

export interface IComment {
  id: string;
  content: string;
  selection?: string;
  type?: string;
  creatorId: string;
  pageId: string;
  parentCommentId?: string;
  resolvedById?: string;
  resolvedAt?: Date;
  workspaceId: string;
  createdAt: Date;
  editedAt?: Date;
  deletedAt?: Date;
  creator: IUser;
  resolvedBy?: IUser;
  yjsSelection?: {
    anchor: any;
    head: any;
  };
  // AI review fields (cnp review enhancement)
  aiReviewStatus?: AiReviewStatus | null;
  aiReviewSuggestion?: AiReviewSuggestion | AiReviewSuggestion[] | string | null;
  aiReviewAccount?: AiReviewAccount | null;
  aiReviewedAt?: Date | string | null;
  aiReviewHash?: string | null;
}

export interface ICommentData {
  id: string;
  pageId: string;
  parentCommentId?: string;
  content: any;
  selection?: string;
}

export interface IResolveComment {
  commentId: string;
  pageId: string;
  resolved: boolean;
}

export interface ICommentParams extends QueryParams {
  pageId: string;
}
