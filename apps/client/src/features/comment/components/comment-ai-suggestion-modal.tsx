import React, { useState } from "react";
import {
  Badge,
  Box,
  Button,
  Code,
  Divider,
  Group,
  List,
  Modal,
  Progress,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { IconCheck, IconCopy, IconSparkles } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import {
  AiReviewAccount,
  AiReviewSeverity,
  AiReviewSuggestion,
} from "@/features/comment/types/comment.types";
import classes from "./comment-ai-suggestion-modal.module.css";

interface CommentAiSuggestionModalProps {
  opened: boolean;
  onClose: () => void;
  suggestion: AiReviewSuggestion | null;
  account?: AiReviewAccount | null;
  reviewedAt?: Date | string | null;
  commentId: string;
}

function severityColor(severity: AiReviewSeverity): string {
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

function confidencePercent(value: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  if (value <= 1) return Math.round(value * 100);
  return Math.round(value);
}

function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

function buildMarkdown(
  suggestion: AiReviewSuggestion,
  account: AiReviewAccount | null | undefined,
  reviewedAt: Date | string | null | undefined,
): string {
  const lines: string[] = [];
  lines.push(`# ${suggestion.issue_type} · ${suggestion.severity}`);
  lines.push("");
  lines.push(`**${suggestion.summary}**`);
  lines.push("");
  lines.push("## Detail");
  lines.push(suggestion.detail || "_(empty)_");
  lines.push("");
  lines.push("## Suggestion");
  lines.push(suggestion.suggestion || "_(empty)_");
  lines.push("");
  if (suggestion.ref_standards?.length) {
    lines.push("## Reference standards");
    for (const ref of suggestion.ref_standards) {
      lines.push(`- ${ref}`);
    }
    lines.push("");
  }
  lines.push(
    `**Confidence:** ${(suggestion.confidence * 100).toFixed(0)}% (${suggestion.confidence})`,
  );
  if (account) {
    lines.push(
      `**Reviewed by:** ${account.provider}-${account.model} (account #${(account.account_index ?? 0) + 1})`,
    );
  }
  if (reviewedAt) {
    lines.push(`**Reviewed at:** ${formatDateTime(reviewedAt)}`);
  }
  return lines.join("\n");
}

export function CommentAiSuggestionModal({
  opened,
  onClose,
  suggestion,
  account,
  reviewedAt,
  commentId,
}: CommentAiSuggestionModalProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  if (!suggestion) {
    return null;
  }

  const color = severityColor(suggestion.severity);
  const confidence = confidencePercent(suggestion.confidence);
  const md = buildMarkdown(suggestion, account, reviewedAt);

  async function handleCopy() {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(md);
      } else {
        // Fallback for very old browsers
        const ta = document.createElement("textarea");
        ta.value = md;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (err) {
      console.error("Failed to copy AI review markdown:", err);
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs" wrap="nowrap">
          <IconSparkles size={18} stroke={1.8} color="var(--mantine-color-violet-6)" />
          <Text fw={600}>{t("AI review")}</Text>
          <Badge color={color} variant="light" size="sm" radius="sm">
            {suggestion.issue_type} · {suggestion.severity}
          </Badge>
        </Group>
      }
      size="lg"
      centered
      overlayProps={{ backgroundOpacity: 0.45, blur: 2 }}
    >
      <Stack gap="md" data-comment-id={commentId}>
        <Box>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            {t("Summary")}
          </Text>
          <Text size="sm" mt={4}>
            {suggestion.summary || t("(no summary)")}
          </Text>
        </Box>

        <Box>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            {t("Detail")}
          </Text>
          <Text size="sm" mt={4} className={classes.blockText}>
            {suggestion.detail || t("(no detail)")}
          </Text>
        </Box>

        <Box>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            {t("Suggestion")}
          </Text>
          <Text size="sm" mt={4} className={classes.blockText}>
            {suggestion.suggestion || t("(no suggestion)")}
          </Text>
        </Box>

        {suggestion.ref_standards && suggestion.ref_standards.length > 0 && (
          <Box>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
              {t("Reference standards")}
            </Text>
            <List size="sm" mt={4} withPadding>
              {suggestion.ref_standards.map((ref) => (
                <List.Item key={ref}>{ref}</List.Item>
              ))}
            </List>
          </Box>
        )}

        <Box>
          <Group justify="space-between" mb={4}>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
              {t("Confidence")}
            </Text>
            <Text size="xs" c="dimmed">
              {confidence}%
            </Text>
          </Group>
          <Progress value={confidence} color={color} size="sm" radius="xl" />
        </Box>

        {(account || reviewedAt) && (
          <>
            <Divider />
            <Group gap="xl" wrap="wrap">
              {account && (
                <Box>
                  <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                    {t("Model")}
                  </Text>
                  <Code mt={4}>
                    {account.provider}-{account.model} ·{" "}
                    {t("account #{{idx}}", {
                      idx: (account.account_index ?? 0) + 1,
                    })}
                  </Code>
                </Box>
              )}
              {reviewedAt && (
                <Box>
                  <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                    {t("Reviewed at")}
                  </Text>
                  <Text size="sm" mt={4}>
                    {formatDateTime(reviewedAt)}
                  </Text>
                </Box>
              )}
            </Group>
          </>
        )}

        <Group justify="flex-end" gap="xs">
          <Tooltip
            label={copied ? t("Copied!") : t("Copy as Markdown")}
            withArrow
          >
            <Button
              variant="light"
              leftSection={
                copied ? <IconCheck size={14} /> : <IconCopy size={14} />
              }
              onClick={handleCopy}
              size="xs"
            >
              {copied ? t("Copied") : t("Copy as Markdown")}
            </Button>
          </Tooltip>
          <Button variant="default" onClick={onClose} size="xs">
            {t("Close")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export default CommentAiSuggestionModal;
