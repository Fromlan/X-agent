/**
 * Vitest 套件 —— ComposerAttachments 渲染 / 移除 / 4 张上限计数.
 *
 * 锁住 3 个不变量 (#42 composer attachments):
 * 1. 空数组 → 返回 null (不渲染空容器)
 * 2. 多个 attachment → 渲染对应数量的 chip + count "N/4"
 * 3. 移除按钮回调时传正确的 index
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ComposerAttachments } from "./ComposerAttachments";
import type { ImageContent } from "../../shared/ipc";

function pngAttachment(): ImageContent {
  return {
    type: "image",
    data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    mimeType: "image/png",
  };
}

describe("ComposerAttachments 渲染", () => {
  it("空数组 → 不渲染容器", () => {
    const { container } = render(
      <ComposerAttachments
        attachments={[]}
        onRemove={vi.fn()}
        maxCount={4}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("1 个 attachment → 1 个 chip + 计数 1/4", () => {
    render(
      <ComposerAttachments
        attachments={[pngAttachment()]}
        onRemove={vi.fn()}
        maxCount={4}
      />,
    );
    expect(screen.getByRole("list")).toBeTruthy();
    expect(screen.getByRole("listitem")).toBeTruthy();
    expect(screen.getByText("1/4")).toBeTruthy();
  });

  it("3 个 attachment → 3 个 chip + 计数 3/4", () => {
    const imgs = [pngAttachment(), pngAttachment(), pngAttachment()];
    render(
      <ComposerAttachments
        attachments={imgs}
        onRemove={vi.fn()}
        maxCount={4}
      />,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("3/4")).toBeTruthy();
  });

  it("maxCount 自定义 (比如 8 张实验性模式) → 计数显示 2/8", () => {
    render(
      <ComposerAttachments
        attachments={[pngAttachment(), pngAttachment()]}
        onRemove={vi.fn()}
        maxCount={8}
      />,
    );
    expect(screen.getByText("2/8")).toBeTruthy();
  });
});

describe("ComposerAttachments 移除按钮", () => {
  it("点 X 调 onRemove(index)", () => {
    const onRemove = vi.fn();
    render(
      <ComposerAttachments
        attachments={[pngAttachment(), pngAttachment()]}
        onRemove={onRemove}
        maxCount={4}
      />,
    );
    const removeButtons = screen.getAllByRole("button", { name: "移除附件" });
    expect(removeButtons).toHaveLength(2);
    removeButtons[1]?.click();
    expect(onRemove).toHaveBeenCalledWith(1);
  });
});
