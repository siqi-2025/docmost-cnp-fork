import React from "react";
import {
  Badge,
  Box,
  Group,
  Loader,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconRefresh,
  IconSparkles,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import {
  AiReviewAccount,
  AiReviewSeverity,
  AiReviewStatus,
  AiReviewSuggestion,
  IComment,
} from "@/features/comment/types/comment.types";
import classes from "./comment-ai-badge.module.css";

interface CommentAiBadgeProps {
  comment: IComment;
  onOpenSuggestion?: (suggestion: AiReviewSuggestion) => void;
  onRetry?: (comment: IComment) => void;
}

/**
 * Defensive normaliser.
 *
 * The backend may serialise `ai_review_suggestion` as:
 *  - a single object:   { issue_type, severity, ... }
 *  - an array:          [ {...}, {...} ]
 *  - a JSON string:     "{...}" or "[...]"
 *  - null / undefined
 *
 * We pick the first (or only) suggestion to drive the badge UI.
 */
function normaliseSuggestion(
  raw: IComment["aiReviewSuggestion"],
): AiReviewSuggestion | null {
  if (raw == null) return null;

  let candidate: unknown = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      candidate = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }

  if (Array.isArray(candidate)) {
    const first = candidate.find(
      (c): c is AiReviewSuggestion => !!c && typeof c === "object",
    );
    return first ?? null;
  }

  if (
    typeof candidate === "object" &&
    candidate !== null &&
    "severity" in candidate
  ) {
    return candidate as AiReviewSuggestion;
  }
  return null;
}

function severityColor(severity: AiReviewSeverity | undefined): string {
  switch (severity) {
    case "critical":
      return "red";
    case "major":
      return "orange";
    case "minor":
      return "yellow";
    case "info":
    default:
      return "gray";
  }
}

function issueTypeLabel(issueType: AiReviewSuggestion["issue_type"]): string {
  return issueType;
}

function buildProviderText(
  account: AiReviewAccount | null | undefined,
): string | null {
  if (!account) return null;
  const provider = account.provider || "unknown";
  const model = account.model || "unknown";
  const idx =
    typeof account.account_index === "number" ? account.account_index : 0;
  return `by ${provider}-${model} via account #${idx + 1}`;
}

export function CommentAiBadge({
  comment,
  onOpenSuggestion,
  onRetry,
}: CommentAiBadgeProps) {
  const { t } = useTranslation();
  const status: AiReviewStatus | null | undefined = comment.aiReviewStatus;

  // `skipped` -> render nothing
  if (!status || status === "skipped") {
    return null;
  }

  // pending / reviewing -> loader + label
  if (status === "pending" || status === "reviewing") {
    return (
      <Group gap={6} wrap="nowrap" className={classes.row}>
        <Loader size="xs" color="violet" type="dots" />
        <Text size="xs" c="dimmed">
          {t("AI reviewing...")}
        </Text>
      </Group>
    );
  }

  // failed -> warning + retry button
  if (status === "failed") {
    return (
      <Group gap={6} wrap="nowrap" className={classes.row}>
        <Tooltip label={t("AI review failed")} withArrow>
          <Box className={classes.warnIcon}>
            <IconAlertTriangle size={14} stroke={1.8} />
          </Box>
        </Tooltip>
        <Text size="xs" c="dimmed">
          {t("AI review failed, retry?")}
        </Text>
        {onRetry && (
          <UnstyledButton
            onClick={() => onRetry(comment)}
            className={classes.retryBtn}
            aria-label={t("Retry AI review")}
          >
            <Group gap={4} wrap="nowrap">
              <IconRefresh size={12} stroke={1.8} />
              <Text size="xs" fw={500}>
                {t("Retry")}
              </Text>
            </Group>
          </UnstyledButton>
        )}
      </Group>
    );
  }

  // completed -> colored badge
  const suggestion = normaliseSuggestion(comment.aiReviewSuggestion);
  if (!suggestion) {
    // completed but payload is unusable -> degrade gracefully
    return (
      <Group gap={6} wrap="nowrap" className={classes.row}>
        <IconSparkles size={14} stroke={1.8} color="var(--mantine-color-violet-6)" />
        <Text size="xs" c="dimmed">
          {t("AI review completed")}
        </Text>
      </Group>
    );
  }

  const color = severityColor(suggestion.severity);
  const providerLabel = buildProviderText(comment.aiReviewAccount);

  const badge = (
    <Badge
      color={color}
      variant="light"
      radius="sm"
      size="sm"
      leftSection={<IconSparkles size={12} stroke={1.8} />}
      className={classes.badge}
      style={{ cursor: onOpenSuggestion ? "pointer" : "default" }}
    >
      <Text size="xs" fw={500} component="span">
        {issueTypeLabel(suggestion.issue_type)}
      </Text>
      <Text size="xs" c="dimmed" component="span" className={classes.summary}>
        {" "}
        {suggestion.summary}
      </Text>
    </Badge>
  );

  return (
    <Group gap={6} wrap="nowrap" className={classes.row}>
      {onOpenSuggestion ? (
        <UnstyledButton
          onClick={() => onOpenSuggestion(suggestion)}
          aria-label={t("View AI review details")}
        >
          {badge}
        </UnstyledButton>
      ) : (
        badge
      )}
      {providerLabel && (
        <Tooltip label={providerLabel} withArrow>
          <Text size="xs" c="dimmed" className={classes.provider}>
            {providerLabel}
          </Text>
        </Tooltip>
      )}
    </Group>
  );
}

export default CommentAiBadge;
